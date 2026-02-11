(() => {
  const PAGE_SIZE = 10;
  const CSV_CANDIDATES = [
    "mob_violence_cleaned.csv",
    "mob_violence_cleaned",
    "./mob_violence_cleaned.csv",
    "./mob_violence_cleaned"
  ];
  const DISTRICT_GEOJSON_CANDIDATES = [
    "bangladesh-districts.json",
    "./bangladesh-districts.json",
    "bangladesh-districts.geojson",
    "./bangladesh-districts.geojson"
  ];
  const DISTRICT_ALIASES = {
    chittagong: "chattogram",
    comilla: "cumilla",
    barisal: "barishal",
    jessore: "jashore",
    bogra: "bogura",
    coxsbazar: "coxsbazar",
    coxbazar: "coxsbazar",
    bagerhat: "bagerhat",
    brahmanbaria: "brahmanbaria",
    nator: "natore",
    gaibanda: "gaibandha"
  };

  const REQUIRED_COLUMNS = [
    "district",
    "date",
    "name",
    "age",
    "accused_of",
    "cause_of_death",
    "source_url_1",
    "source_url_2",
    "year_sheet",
    "spontaneous_mob"
  ];

  let rows = [];
  let currentPage = 1;
  let activeYear = "all"; // "all" | "2023" | "2025"

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function normalizeDistrictName(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z]/g, "");
  }

  function canonicalDistrict(value) {
    const normalized = normalizeDistrictName(value);
    if (!normalized) {
      return "";
    }
    return DISTRICT_ALIASES[normalized] || normalized;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function parseCSV(text) {
    const output = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === "\"") {
        if (inQuotes && next === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === "," && !inQuotes) {
        row.push(field);
        field = "";
        continue;
      }

      if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") {
          i += 1;
        }
        row.push(field);
        output.push(row);
        row = [];
        field = "";
        continue;
      }

      field += ch;
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      output.push(row);
    }

    return output.filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
  }

  async function loadCsvText() {
    for (const filename of CSV_CANDIDATES) {
      try {
        const response = await fetch(filename, { cache: "no-store" });
        if (!response.ok) continue;
        const text = await response.text();
        if (text.trim()) return text;
      } catch (error) {
        continue;
      }
    }
    throw new Error("Could not load mob_violence_cleaned CSV data");
  }

  function mapRows(csvText) {
    const raw = parseCSV(csvText);
    if (raw.length < 2) return [];

    const headers = raw[0].map(normalizeHeader);
    const missing = REQUIRED_COLUMNS.filter((key) => !headers.includes(key));
    if (missing.length) {
      throw new Error(`Missing CSV columns: ${missing.join(", ")}`);
    }
    if (!headers.includes("news_brief") && !headers.includes("new_brief")) {
      throw new Error("Missing CSV columns: news_brief (or new_brief)");
    }

    const rowsOnly = raw.slice(1);
    return rowsOnly.map((cells) => {
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = String(cells[idx] || "").trim();
      });
      return {
        district: obj.district,
        date: obj.date,
        name: obj.name,
        age: obj.age,
        accused_of: obj.accused_of,
        cause_of_death: obj.cause_of_death,
        news_brief: obj.news_brief || obj.new_brief || "",
        source_url_1: obj.source_url_1,
        source_url_2: obj.source_url_2,
        year_sheet: obj.year_sheet,
        spontaneous_mob: obj.spontaneous_mob,
        spontaneous_yes: /^yes$/i.test(String(obj.spontaneous_mob || "").trim()),
        spontaneous_no: /^no$/i.test(String(obj.spontaneous_mob || "").trim())
      };
    });
  }

  function safeUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    try {
      const parsed = new URL(value, window.location.href);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
      return "";
    } catch (error) {
      return "";
    }
  }

  function newsSourcesHtml(item) {
    const links = [];
    const sourceOne = safeUrl(item.source_url_1);
    const sourceTwo = safeUrl(item.source_url_2);

    if (sourceOne) {
      links.push(`<a href="${escapeHtml(sourceOne)}" target="_blank" rel="noopener noreferrer">1</a>`);
    }
    if (sourceTwo) {
      links.push(`<a href="${escapeHtml(sourceTwo)}" target="_blank" rel="noopener noreferrer">2</a>`);
    }

    if (!links.length) return "N/A";
    return links.join('<span class="divider">|</span>');
  }

  function getFilteredRows() {
    if (activeYear === "all") return rows;
    return rows.filter((r) => String(r.year_sheet || "").trim() === activeYear);
  }

  function getRowsByYear(year) {
    return rows.filter((r) => String(r.year_sheet || "").trim() === String(year));
  }

  function getFeatureDistrictName(properties) {
    const props = properties || {};
    const explicitKeys = [
      "district",
      "DISTRICT",
      "District",
      "district_name",
      "DIST_NAME",
      "name",
      "NAME_2",
      "NAME_1",
      "ADM2_EN",
      "adm2_en",
      "shapeName",
      "zila",
      "ZILA"
    ];

    for (const key of explicitKeys) {
      if (props[key]) {
        return String(props[key]);
      }
    }

    const districtLike = Object.keys(props).find((key) => /dist|zila/i.test(key) && props[key]);
    if (districtLike) {
      return String(props[districtLike]);
    }

    const nameLike = Object.keys(props).find((key) => /name/i.test(key) && props[key]);
    if (nameLike) {
      return String(props[nameLike]);
    }

    return "";
  }

  async function loadDistrictGeoJson() {
    for (const url of DISTRICT_GEOJSON_CANDIDATES) {
      try {
        const response = await fetch(url, { cache: "force-cache" });
        if (!response.ok) {
          continue;
        }
        const json = await response.json();
        if (!json || !Array.isArray(json.features) || !json.features.length) {
          continue;
        }

        const hasPolygon = json.features.some((f) => f && f.geometry && /Polygon/i.test(String(f.geometry.type || "")));
        if (hasPolygon) {
          return json;
        }
      } catch (error) {
        continue;
      }
    }
    throw new Error("Could not load Bangladesh district polygon GeoJSON");
  }

  function renderDistrictMapError(message) {
    const container = document.getElementById("district-map");
    if (!container) {
      return;
    }
    container.innerHTML = "";
    const el = document.createElement("p");
    el.className = "district-map-error";
    el.textContent = message;
    container.appendChild(el);
  }

  async function renderDistrictMap() {
    const containerNode = document.getElementById("district-map");
    if (!containerNode) {
      return;
    }
    if (!window.d3) {
      renderDistrictMapError("Map library is unavailable.");
      return;
    }

    const d3Ref = window.d3;
    const root = d3Ref.select(containerNode);
    root.selectAll("*").remove();

    let geoJson;
    try {
      geoJson = await loadDistrictGeoJson();
    } catch (error) {
      renderDistrictMapError("District map could not be loaded in this environment.");
      return;
    }

    const polygonFeatures = (geoJson.features || []).filter((f) => {
      if (!f || !f.geometry || !f.geometry.type) {
        return false;
      }
      return /Polygon/i.test(f.geometry.type);
    });

    if (!polygonFeatures.length) {
      renderDistrictMapError("District polygon boundaries were not found in the map file.");
      return;
    }
    const features = polygonFeatures;

    const rows2025 = rows.filter((row) => String(row.year_sheet || "").trim() === "2025");
    const countsByDistrict = new Map();
    rows2025.forEach((row) => {
      const key = canonicalDistrict(row.district);
      if (!key) {
        return;
      }
      countsByDistrict.set(key, (countsByDistrict.get(key) || 0) + 1);
    });

    features.forEach((feature) => {
      const districtName = getFeatureDistrictName(feature.properties);
      const districtKey = canonicalDistrict(districtName);
      feature.__districtName = districtName || "Unknown";
      feature.__districtKey = districtKey;
      feature.__count = countsByDistrict.get(districtKey) || 0;
    });

    const measuredWidth = containerNode.clientWidth || 760;
    const width = Math.max(340, measuredWidth);
    const height = Math.round(width * 0.9);
    const mapCollection = { type: "FeatureCollection", features };
    const projection = d3Ref.geoMercator().fitSize([width, height], mapCollection);
    const path = d3Ref.geoPath(projection);

    const ramp = ["#ecebe7", "#dcd9d2", "#cac6bf", "#b2ada5", "#948f86", "#6d6961", "#222222"];
    const choropleth = d3Ref.scaleQuantize().domain([1, 19]).range(ramp);
    const noDataFill = "#f1f1ee";

    function fillByCount(count) {
      if (!count || count < 1) {
        return noDataFill;
      }
      return choropleth(Math.min(19, count));
    }

    const svg = root
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("aria-hidden", "true");

    const tooltip = root.append("div").attr("class", "district-tooltip");

    function showTooltip(text, x, y) {
      tooltip
        .style("left", `${x}px`)
        .style("top", `${y}px`)
        .style("opacity", 1)
        .text(text);
    }

    function hideTooltip() {
      tooltip.style("opacity", 0);
    }

    svg
      .append("g")
      .selectAll("path")
      .data(features)
      .join("path")
      .attr("class", "district-region")
      .attr("d", path)
      .attr("fill", (d) => fillByCount(d.__count))
      .attr("tabindex", 0)
      .attr("aria-label", (d) => `${d.__districtName}: ${d.__count} case${d.__count === 1 ? "" : "s"}`)
      .on("mouseenter", function onMouseEnter(event, d) {
        const [x, y] = d3Ref.pointer(event, containerNode);
        showTooltip(`${d.__districtName}: ${d.__count}`, x, y);
      })
      .on("mousemove", function onMouseMove(event, d) {
        const [x, y] = d3Ref.pointer(event, containerNode);
        showTooltip(`${d.__districtName}: ${d.__count}`, x, y);
      })
      .on("mouseleave", hideTooltip)
      .on("focus", function onFocus(event, d) {
        const centroid = path.centroid(d);
        const cx = Number.isFinite(centroid[0]) ? centroid[0] : width * 0.5;
        const cy = Number.isFinite(centroid[1]) ? centroid[1] : height * 0.5;
        showTooltip(`${d.__districtName}: ${d.__count}`, cx, cy);
      })
      .on("blur", hideTooltip);
  }

  function renderTablePage() {
    const $tbody = $("#mob-table-body");
    $tbody.empty();

    const filtered = getFilteredRows();

    if (!filtered.length) {
      $tbody.html('<tr class="status-row"><td colspan="6">No rows found for this filter.</td></tr>');
      return;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    pageRows.forEach((item, idx) => {
      const detailId = `detail-${start + idx}`;

      const mainRow = `
        <tr class="primary-row" tabindex="0" role="button" aria-expanded="false" data-target="${detailId}">
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.age)}</td>
          <td>${escapeHtml(item.accused_of)}</td>
          <td>${escapeHtml(item.cause_of_death)}</td>
          <td class="toggle-cell"><span class="toggle-icon">+</span></td>
        </tr>
      `;

      const detailRow = `
        <tr class="detail-row" id="${detailId}" hidden>
          <td colspan="6">
            <div class="detail-content">
              <p>${escapeHtml(item.news_brief)}</p>
              <p class="news-source">News Source: ${newsSourcesHtml(item)}</p>
            </div>
          </td>
        </tr>
      `;

      $tbody.append(mainRow);
      $tbody.append(detailRow);
    });
  }

  function pageTokens(totalPages, page) {
    if (totalPages <= 8) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (page <= 4) {
      return [1, 2, 3, 4, "...", totalPages - 1, totalPages];
    }
    if (page >= totalPages - 3) {
      return [1, 2, "...", totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, 2, "...", page - 1, page, page + 1, "...", totalPages - 1, totalPages];
  }

  function renderPagination() {
    const $pager = $("#table-pagination");
    $pager.empty();

    const filtered = getFilteredRows();
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    if (totalPages <= 1) return;

    const prevDisabled = currentPage === 1 ? "disabled" : "";
    $pager.append(
      `<button type="button" class="pager-prev" ${prevDisabled} data-page="${currentPage - 1}">&lt;</button>`
    );

    const tokens = pageTokens(totalPages, currentPage);
    tokens.forEach((token) => {
      if (token === "...") {
        $pager.append('<span class="ellipsis">...</span>');
        return;
      }
      const currentClass = token === currentPage ? "current" : "";
      $pager.append(
        `<button type="button" class="pager-number ${currentClass}" data-page="${token}">${token}</button>`
      );
    });

    const nextDisabled = currentPage === totalPages ? "disabled" : "";
    $pager.append(
      `<button type="button" class="pager-next" ${nextDisabled} data-page="${currentPage + 1}">&gt;</button>`
    );
  }

  function closeOpenRows($scope) {
    $scope.find(".primary-row.open").each(function closeEach() {
      const $row = $(this);
      const target = $row.attr("data-target");
      $row.removeClass("open").attr("aria-expanded", "false");
      $row.find(".toggle-icon").text("+");
      $(`#${target}`).attr("hidden", true);
    });
  }

  function toggleRow($row) {
    const target = $row.attr("data-target");
    const $detail = $(`#${target}`);
    const expanded = $row.attr("aria-expanded") === "true";

    closeOpenRows($row.closest("tbody"));
    if (expanded) return;

    $row.addClass("open").attr("aria-expanded", "true");
    $row.find(".toggle-icon").text("-");
    $detail.attr("hidden", false);
  }

  function updateYearToggleUI() {
    const $buttons = $(".table-toolbar .year-btn");
    $buttons.each(function eachBtn() {
      const $btn = $(this);
      const year = String($btn.attr("data-year") || "all");
      const isActive = year === activeYear;

      $btn.toggleClass("is-active", isActive);
      $btn.attr("aria-pressed", isActive ? "true" : "false");
    });
  }

  function bindTableEvents() {
    $(document).on("click", ".primary-row", function onClick() {
      toggleRow($(this));
    });

    $(document).on("keydown", ".primary-row", function onKeydown(event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleRow($(this));
    });

    $(document).on("click", "#table-pagination button[data-page]", function onPagerClick() {
      const requested = Number($(this).attr("data-page"));
      const totalPages = Math.ceil(getFilteredRows().length / PAGE_SIZE);

      if (!requested || requested < 1 || requested > totalPages || requested === currentPage) return;

      currentPage = requested;
      renderTablePage();
      renderPagination();
    });

    $(document).on("click", ".table-toolbar .year-btn[data-year]", function onYearClick() {
      const year = String($(this).attr("data-year") || "all");
      if (year === activeYear) return;

      activeYear = year;
      currentPage = 1;

      updateYearToggleUI();
      closeOpenRows($("#mob-table-body"));
      renderTablePage();
      renderPagination();
    });
  }

  function updateVizSummary(count2023, count2025) {
    const deaths2023 = `${count2023} Death${count2023 === 1 ? "" : "s"}`;
    const deaths2025 = `${count2025} Death${count2025 === 1 ? "" : "s"}`;
    $("#viz-count-2023").text(deaths2023);
    $("#viz-count-2025").text(deaths2025);
    $("#circle-grid").attr("aria-label", `${count2023} deaths in 2023 and ${count2025} deaths in 2025`);
  }

  function renderCircleGrid() {
    const $grid = $("#circle-grid");
    $grid.empty();
    const rows2023 = getRowsByYear("2023");
    const rows2025 = getRowsByYear("2025");

    rows2023.forEach((item) => {
      const personName = item.name || "Unknown";
      const safeName = escapeHtml(personName);
      const marker = item.spontaneous_no ? '<span class="circle-mark" aria-hidden="true"></span>' : "";
      const spontaneousClass = item.spontaneous_no ? " spontaneous-no" : "";
      const spontaneousLabel = item.spontaneous_no ? "No" : (item.spontaneous_yes ? "Yes" : "Unavailable");
      $grid.append(
        `<span class="circle baseline${spontaneousClass}" data-name="${safeName}" data-year="2023" title="${safeName}" tabindex="0" aria-label="${safeName}, 2023, spontaneous mob: ${spontaneousLabel}">${marker}</span>`
      );
    });

    rows2025.forEach((item) => {
      const personName = item.name || "Unknown";
      const safeName = escapeHtml(personName);
      const marker = item.spontaneous_no ? '<span class="circle-mark" aria-hidden="true"></span>' : "";
      const spontaneousClass = item.spontaneous_no ? " spontaneous-no" : "";
      const spontaneousLabel = item.spontaneous_no ? "No" : (item.spontaneous_yes ? "Yes" : "Unavailable");
      $grid.append(
        `<span class="circle increase${spontaneousClass}" data-name="${safeName}" data-year="2025" title="${safeName}" tabindex="0" aria-label="${safeName}, 2025, spontaneous mob: ${spontaneousLabel}">${marker}</span>`
      );
    });

    updateVizSummary(rows2023.length, rows2025.length);
  }

  async function initTable() {
    try {
      const csvText = await loadCsvText();
      rows = mapRows(csvText);
      currentPage = 1;
      await renderDistrictMap();
      renderCircleGrid();
      renderTablePage();
      renderPagination();
    } catch (error) {
      const msg = `${error.message}. Run this from a local server and ensure mob_violence_cleaned.csv is next to index.html.`;
      $("#mob-table-body").html(`<tr class="status-row"><td colspan="6">${escapeHtml(msg)}</td></tr>`);
      $("#table-pagination").empty();
      renderDistrictMapError("District map unavailable until CSV is loaded.");
      renderCircleGrid();
    }
  }

  function bindImageFallback() {
    const media = document.querySelector(".hero-media");
    const image = media ? media.querySelector("img") : null;
    if (!media || !image) {
      return;
    }

    image.addEventListener("error", () => {
      media.classList.add("missing");
      image.remove();
    });
  }

  $(function init() {
    bindImageFallback();
    bindTableEvents();
    initTable();
  });
})();
