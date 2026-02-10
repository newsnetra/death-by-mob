(() => {
  const PAGE_SIZE = 10;
  const CSV_CANDIDATES = [
    "mob_violence_cleaned.csv",
    "mob_violence_cleaned",
    "./mob_violence_cleaned.csv",
    "./mob_violence_cleaned"
  ];

  const REQUIRED_COLUMNS = [
    "date",
    "name",
    "age",
    "accused_of",
    "cause_of_death",
    "source_url_1",
    "source_url_2",
    "year_sheet"
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
        date: obj.date,
        name: obj.name,
        age: obj.age,
        accused_of: obj.accused_of,
        cause_of_death: obj.cause_of_death,
        news_brief: obj.news_brief || obj.new_brief || "",
        source_url_1: obj.source_url_1,
        source_url_2: obj.source_url_2,
        year_sheet: obj.year_sheet
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

    function renderCircleGrid() {
    const baseline = 38;
    const total = 139;
    const $grid = $("#circle-grid");
    $grid.empty();

    for (let i = 0; i < total; i += 1) {
      const cls = i < baseline ? "baseline" : "increase";
      $grid.append(`<span class="circle ${cls}" aria-hidden="true"></span>`);
    }
  }

  async function initTable() {
    try {
      const csvText = await loadCsvText();
      rows = mapRows(csvText);
      currentPage = 1;
      renderTablePage();
      renderPagination();
    } catch (error) {
      const msg = `${error.message}. Run this from a local server and ensure mob_violence_cleaned.csv is next to index.html.`;
      $("#mob-table-body").html(`<tr class="status-row"><td colspan="6">${escapeHtml(msg)}</td></tr>`);
      $("#table-pagination").empty();
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
    renderCircleGrid();
    bindTableEvents();
    initTable();
  });
})();

