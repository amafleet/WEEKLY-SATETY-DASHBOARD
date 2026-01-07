/* =========================
   Weekly dashboard config
   - Put weekly JSON files in /data/
   - Create /data/manifest.json listing filenames
========================= */
const MANIFEST_FILE = "./data/manifest.json";

/* =========================
   Violation rules
========================= */
function isViolation(review) {
  return review === "None" || review === "Dispute Denied" || review === "Dispute Closed";
}

function reviewLabel(review) {
  if (review === "Dispute Approved") return "No - Violation (Dispute Approved)";
  return "Yes - Violation";
}

/* =========================
   Parse week from filename:
   Example: amft-safety-2025-w01.json
========================= */
function parseWeekInfo(filename) {
  const lower = filename.toLowerCase();
  const m = lower.match(/(\d{4}).*?w(\d{1,2})/);
  if (!m) return null;

  const year = Number(m[1]);
  const week = Number(m[2]);
  if (!year || week < 1 || week > 53) return null;

  return { year, week };
}

function weekLabel(filename) {
  const info = parseWeekInfo(filename);
  if (!info) return `Unknown Week (${filename})`;
  const wk = String(info.week).padStart(2, "0");
  return `Week ${wk} — ${info.year}`;
}

function sortKeyForWeek(filename) {
  const info = parseWeekInfo(filename);
  if (!info) return Number.POSITIVE_INFINITY;
  return info.year * 100 + info.week;
}

/* =========================
   DOM
========================= */
const weekSelect = document.getElementById("weekSelect");

/* =========================
   Init
========================= */
init();

async function init() {
  try {
    const files = await loadManifest();
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("manifest.json is empty or invalid");
    }

    const datasets = files
      .map(file => ({ file, label: weekLabel(file), sortKey: sortKeyForWeek(file) }))
      .sort((a, b) => a.sortKey - b.sortKey);

    populateDropdown(datasets);

    // default to latest week
    weekSelect.value = datasets[datasets.length - 1].file;
    await loadWeek(weekSelect.value, datasets);

    weekSelect.addEventListener("change", () => {
      loadWeek(weekSelect.value, datasets);
    });

    wireUpExpandCollapseAll();
    wireUpExcelExport();

  } catch (err) {
    showError(MANIFEST_FILE, err);
    console.error(err);
  }
}

async function loadManifest() {
  const res = await fetch(MANIFEST_FILE);
  if (!res.ok) throw new Error(`HTTP ${res.status} when loading ${MANIFEST_FILE}`);
  const json = await res.json();

  // manifest.json can be:
  // ["file1.json","file2.json"] OR { "files": [...] }
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.files)) return json.files;

  throw new Error("manifest.json must be an array OR { files: [...] }");
}

function populateDropdown(datasets) {
  weekSelect.innerHTML = "";
  datasets.forEach(ds => {
    const opt = document.createElement("option");
    opt.value = ds.file;
    opt.textContent = ds.label;
    weekSelect.appendChild(opt);
  });
}

/* =========================
   Load selected week file
========================= */
async function loadWeek(fileName, datasets) {
  const DATA_FILE = `./data/${fileName}`;
  hideError();

  const ds = datasets.find(d => d.file === fileName);
  const label = ds ? ds.label : fileName;

  document.getElementById("fileTitle").textContent = `Data Source: ${label} (${fileName})`;

  try {
    const res = await fetch(DATA_FILE);
    if (!res.ok) throw new Error(`HTTP ${res.status} when loading ${DATA_FILE}`);
    let data = await res.json();
    if (!Array.isArray(data)) data = [data];

    buildSummaryAndCharts(data, fileName);
    buildViolationTable(data);

  } catch (err) {
    showError(DATA_FILE, err);
    console.error(err);
  }
}

/* =========================
   Summary + Charts
========================= */
function buildSummaryAndCharts(data, fileLabel) {
  let violations = 0;
  let nonViolations = 0;

  const daCounts = {};
  const metricCounts = {};

  data.forEach(row => {
    const review = row["Review Details"] ?? "None";
    const v = isViolation(review);

    if (v) {
      violations++;
      const da = row["Delivery Associate"] || "(Unknown)";
      const mt = row["Metric Type"] || "(Unknown)";
      daCounts[da] = (daCounts[da] || 0) + 1;
      metricCounts[mt] = (metricCounts[mt] || 0) + 1;
    } else {
      nonViolations++;
    }
  });

  document.getElementById("totalEvents").textContent = data.length;
  document.getElementById("violations").textContent = violations;
  document.getElementById("nonViolations").textContent = nonViolations;

  buildDAChart(daCounts, fileLabel);
  buildMetricChart(metricCounts, fileLabel);
}

function buildDAChart(counts, fileLabel) {
  const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));
  const values = names.map(n => counts[n]);

  Plotly.newPlot("daChart", [{
    x: names,
    y: values,
    type: "bar"
  }], {
    title: `Violation Count per Delivery Associate – ${fileLabel}`,
    xaxis: { tickangle: -45, tickfont: { size: 10 }, automargin: true },
    yaxis: { title: "Violations" },
    margin: { t: 60, l: 60, r: 20, b: 160 }
  }, { responsive: true });
}

function buildMetricChart(counts, fileLabel) {
  const metrics = Object.keys(counts).sort((a, b) => a.localeCompare(b));
  const values = metrics.map(m => counts[m]);

  Plotly.newPlot("metricChart", [{
    x: metrics,
    y: values,
    type: "bar"
  }], {
    title: `Violation Count per Metric Type – ${fileLabel}`,
    xaxis: { tickangle: -30, tickfont: { size: 11 }, automargin: true },
    yaxis: { title: "Violations" },
    margin: { t: 60, l: 60, r: 20, b: 130 }
  }, { responsive: true });
}

/* =========================
   Violation Details Table
========================= */
function buildViolationTable(data) {
  const tbody = document.getElementById("detailsBody");
  const tfoot = document.getElementById("grandTotalFoot");
  tbody.innerHTML = "";
  tfoot.innerHTML = "";

  const grouped = {};
  data.forEach(row => {
    const da = row["Delivery Associate"] || "(Unknown)";
    (grouped[da] ||= []).push(row);
  });

  const sortedDAs = Object.keys(grouped).sort((a, b) => {
    const av = grouped[a].filter(r => isViolation((r["Review Details"] ?? "None"))).length;
    const bv = grouped[b].filter(r => isViolation((r["Review Details"] ?? "None"))).length;
    return bv - av;
  });

  let grandTotal = 0;

  sortedDAs.forEach((da, idx) => {
    const groupId = `grp_${idx}`;
    const rows = grouped[da];

    const subtotal = rows.reduce((acc, r) => {
      const review = r["Review Details"] ?? "None";
      return acc + (isViolation(review) ? 1 : 0);
    }, 0);

    grandTotal += subtotal;

    const headerTr = document.createElement("tr");
    headerTr.className = "group-header";
    headerTr.innerHTML = `
      <td class="toggle" data-group-id="${groupId}">▼</td>
      <td colspan="5">${da} — Violations: ${subtotal}</td>
    `;
    tbody.appendChild(headerTr);

    rows.forEach(r => {
      const review = r["Review Details"] ?? "None";
      const tr = document.createElement("tr");
      tr.className = `group-row ${groupId}`;
      tr.innerHTML = `
        <td></td>
        <td>${r["Date"] ?? ""}</td>
        <td>${da}</td>
        <td>${r["Metric Type"] ?? ""}</td>
        <td>${r["Metric Subtype"] ?? ""}</td>
        <td>${reviewLabel(review)}</td>
      `;
      tbody.appendChild(tr);
    });

    const subtotalTr = document.createElement("tr");
    subtotalTr.className = `subtotal group-row ${groupId}`;
    subtotalTr.innerHTML = `
      <td></td>
      <td colspan="4">Subtotal – ${da} (counts Yes - Violation only)</td>
      <td>${subtotal}</td>
    `;
    tbody.appendChild(subtotalTr);
  });

  const gt = document.createElement("tr");
  gt.innerHTML = `
    <td colspan="5">GRAND TOTAL (Yes - Violation only)</td>
    <td>${grandTotal}</td>
  `;
  tfoot.appendChild(gt);

  wireUpToggles();
}

function wireUpToggles() {
  const tbody = document.getElementById("detailsBody");

  const newTbody = tbody.cloneNode(true);
  tbody.parentNode.replaceChild(newTbody, tbody);

  newTbody.addEventListener("click", (e) => {
    const toggleCell = e.target.closest(".toggle");
    if (!toggleCell) return;

    const groupId = toggleCell.dataset.groupId;
    const rows = newTbody.querySelectorAll(`.group-row.${groupId}`);

    const allHidden = Array.from(rows).every(r => r.classList.contains("hidden-row"));
    rows.forEach(r => r.classList.toggle("hidden-row", !allHidden));
    toggleCell.textContent = allHidden ? "▼" : "▶";
  });
}

function setAllGroups(expand) {
  const tbody = document.getElementById("detailsBody");
  const toggles = tbody.querySelectorAll(".group-header .toggle");

  toggles.forEach(t => {
    const groupId = t.dataset.groupId;
    const rows = tbody.querySelectorAll(`.group-row.${groupId}`);
    rows.forEach(r => r.classList.toggle("hidden-row", !expand));
    t.textContent = expand ? "▼" : "▶";
  });
}

function wireUpExpandCollapseAll() {
  document.getElementById("expandAllBtn").onclick = () => setAllGroups(true);
  document.getElementById("collapseAllBtn").onclick = () => setAllGroups(false);
}

function wireUpExcelExport() {
  document.getElementById("downloadExcelBtn").onclick = () => {
    const table = document.getElementById("violationTable");
    const wb = XLSX.utils.table_to_book(table, { sheet: "Violations" });
    XLSX.writeFile(wb, "Weekly_Safety_Violations.xlsx");
  };
}

/* =========================
   Error helpers
========================= */
function showError(path, err) {
  const box = document.getElementById("errorBox");
  box.style.display = "block";
  box.innerHTML = `
    <b>Dashboard could not load a required file.</b><br><br>
    Tried to load: <code>${path}</code><br>
    Error: <code>${err.message}</code><br><br>
    <b>Fix checklist:</b>
    <ul>
      <li>Create <code>data/manifest.json</code> listing the 52 weekly JSON filenames</li>
      <li>Confirm weekly JSON files exist inside <code>/data/</code></li>
      <li>File names are case-sensitive and must include <code>.json</code></li>
    </ul>
  `;
}

function hideError() {
  const box = document.getElementById("errorBox");
  box.style.display = "none";
  box.innerHTML = "";
}
