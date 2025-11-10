/* ======================================================
   KPI2 • Palliative Care Monitor
   File: analytics.js (EN version)
   - Floating button to open "Analytics & Results" panel
   - Fetches data from Google Sheets via GAS (pullAll) using JSONP
   - Analytics: Overview, Team members, Interventions, Departments, Trends, Response Times
   - CSV export for current tab
   ====================================================== */

import { KEYS, DEFAULT_GAS_URL, buildJsonpUrl } from "./schema.js";

/* ============== UI IDs / Settings ============== */
const ui = {
  fabId: "fab-analytics",
  panelId: "analytics-panel",
  contentId: "an-content",
  canvasHeight: 220,
};

/* ============== Preferences / GAS helpers ============== */
function getPrefs() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.prefs) || "null") || {};
  } catch {
    return {};
  }
}
function getGasBase() {
  const p = getPrefs();
  return (p.gasUrlOverride && p.gasUrlOverride.trim()) || DEFAULT_GAS_URL;
}

/* ============== JSONP helper ============== */
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = "__jsonp_cb_" + Math.random().toString(36).slice(2);
    const cleanup = () => {
      try { delete window[cb]; } catch {}
      script.remove();
    };
    const script = document.createElement("script");
    window[cb] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("JSONP failed")); };
    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}callback=${cb}`;
    document.body.appendChild(script);
  });
}

/* ============== Fetch from Google Sheets ============== */
async function fetchAllFromSheet() {
  const gas = getGasBase();
  const url = buildJsonpUrl(gas, { action: "pullAll" });
  const res = await jsonp(url);
  if (!res || !Array.isArray(res.records)) throw new Error("No records");
  return res.records.map((r) => ({
    id: r.id || "",
    date: (r.date || "").slice(0, 10),
    name: r.name || "",
    code: r.code || "",
    inout: r.inout || "",
    outtype: r.outtype || "",
    dept: r.dept || "",
    intervention: r.intervention || "",
    member: r.member || "",
    response_time: r.response_time || "",
    delay_reason: r.delay_reason || "",
    notes: r.notes || "",
  }));
}

/* ============== Analysis helpers ============== */
const parseISO = (s) => {
  const [y, m, d] = (s || "0000-01-01").split("-").map((x) => +x);
  return new Date(y || 0, (m || 1) - 1, d || 1);
};
const fmtMonth = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const fmtDate = (d) => d.toISOString().slice(0, 10);
const startOfWeek = (d) => { const x = new Date(d); const day = x.getDay(); x.setDate(x.getDate() - day); x.setHours(0,0,0,0); return x; };
const fmtWeek = (d) => fmtDate(startOfWeek(d));
const groupBy = (arr, keyFn) => arr.reduce((acc, x) => { const k = keyFn(x); (acc[k] ||= []).push(x); return acc; }, {});
const countBy = (arr, keyFn) => arr.reduce((acc, x) => { const k = keyFn(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
const sortEntriesDesc = (obj) => Object.entries(obj).sort((a,b)=>b[1]-a[1]);

/* ============== Inline styles for the panel ============== */
function ensureStyles() {
  if (document.getElementById("analytics-inline-style")) return;
  const css = `
#${ui.fabId}{
  position: fixed; inset-inline-end: 18px; inset-block-end: 18px; z-index: 60;
  border-radius: 999px; padding: 12px 16px; font-weight: 700;
  box-shadow: 0 10px 30px rgba(2,6,23,.35);
}
#${ui.panelId}{
  position: fixed; inset: 0; z-index: 70; display:none;
}
#${ui.panelId}.open{ display:block; }
#${ui.panelId} .backdrop{
  position:absolute; inset:0; background: rgba(0,0,0,.55);
}
#${ui.panelId} .sheet{
  position:absolute; inset-inline: max(8px, 4dvw); inset-block-start: max(8px, 4dvh);
  inset-block-end: max(8px, 4dvh);
  background: var(--card); border:1px solid rgba(255,255,255,.1); border-radius: 18px;
  box-shadow: var(--shadow); padding: 12px; display:flex; flex-direction:column; gap: 10px;
}
#${ui.panelId} .header{
  display:flex; align-items:center; justify-content:space-between; gap:10px; padding-bottom:8px;
  border-bottom:1px solid rgba(255,255,255,.06);
}
#${ui.panelId} .tabs{ display:flex; gap:8px; flex-wrap:wrap; }
#${ui.panelId} .tab{ padding:8px 10px; border:1px solid rgba(255,255,255,.08); border-radius: 12px; cursor:pointer; }
#${ui.panelId} .tab.active{ border-color: var(--primary); }
#${ui.panelId} .content{ flex:1; overflow:auto; }
.an-grid{ display:grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.an-card{
  background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.12));
  border:1px solid rgba(255,255,255,.08); border-radius:16px; padding:10px;
}
.an-title{ font-weight:600; margin:0 0 8px; }
.an-kpi{ font-size:28px; font-weight:700; }
.an-table{ width:100%; border-collapse:separate; border-spacing:0; }
.an-table th, .an-table td{ text-align:start; padding:8px 10px; border-bottom:1px dashed rgba(255,255,255,.08); }
.an-actions{ display:flex; gap:8px; align-items:center; }
canvas.an-chart{ width: 100%; height: ${ui.canvasHeight}px; }
@media (max-width: 880px){ .an-grid{ grid-template-columns: 1fr; } }
`;
  const style = document.createElement("style");
  style.id = "analytics-inline-style";
  style.textContent = css;
  document.head.appendChild(style);
}

/* ============== UI: Floating button & Panel skeleton ============== */
function createFab() {
  if (document.getElementById(ui.fabId)) return;
  const btn = document.createElement("button");
  btn.id = ui.fabId;
  btn.className = "btn btn-primary";
  btn.textContent = "📊 Analytics";
  btn.title = "View analytics from Google Sheets";
  btn.addEventListener("click", openPanel);
  document.body.appendChild(btn);
}

function createPanel() {
  if (document.getElementById(ui.panelId)) return;
  const wrap = document.createElement("div");
  wrap.id = ui.panelId;
  wrap.innerHTML = `
    <div class="backdrop"></div>
    <div class="sheet">
      <div class="header">
        <div class="an-actions">
          <strong>Analytics & Results</strong>
          <button class="btn btn-ghost" id="an-refresh">⟳ Refresh</button>
          <button class="btn" id="an-export">⤓ Export CSV</button>
        </div>
        <div class="tabs">
          <button class="tab active" data-tab="overview">Overview</button>
          <button class="tab" data-tab="members">Team Members</button>
          <button class="tab" data-tab="interventions">Interventions</button>
          <button class="tab" data-tab="departments">Departments</button>
          <button class="tab" data-tab="response">Response Times</button>
          <button class="tab" data-tab="trends">Trends</button>
          <button class="btn btn-ghost" id="an-close">×</button>
        </div>
      </div>
      <div class="content" id="${ui.contentId}"></div>
    </div>
  `;
  wrap.querySelector(".backdrop").addEventListener("click", closePanel);
  wrap.querySelector("#an-close").addEventListener("click", closePanel);
  wrap.querySelector("#an-refresh").addEventListener("click", () => refresh(true));
  wrap.querySelector("#an-export").addEventListener("click", exportCurrentCsv);
  wrap.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => switchTab(t.getAttribute("data-tab")))
  );
  document.body.appendChild(wrap);
}

function openPanel() {
  document.getElementById(ui.panelId).classList.add("open");
  if (!state.records.length) refresh(true);
}
function closePanel() {
  document.getElementById(ui.panelId).classList.remove("open");
}
function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll(`#${ui.panelId} .tab`).forEach((t) =>
    t.classList.toggle("active", t.getAttribute("data-tab") === name)
  );
  renderActive();
}

/* ============== State ============== */
const state = {
  records: [],
  activeTab: "overview",
  lastCsv: { filename: "analytics.csv", content: "type,value\n" },
};

/* ============== Simple bar chart (no libs) ============== */
function barChart(canvas, labels, values) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.clientWidth || 600;
  const H = canvas.clientHeight || ui.canvasHeight;
  canvas.width = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0, 0, W, H);
  ctx.font = "12px Cairo, system-ui";
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text") || "#fff";

  const max = Math.max(1, ...values);
  const pad = 28;
  const gap = 10;
  const barW = Math.max(6, (W - pad * 2) / Math.max(1, values.length) - gap);

  // baseline
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(pad, H - pad);
  ctx.lineTo(W - pad, H - pad);
  ctx.strokeStyle = "#999";
  ctx.stroke();
  ctx.globalAlpha = 1;

  values.forEach((v, i) => {
    const x = pad + i * (barW + gap);
    const h = Math.round(((H - pad * 2) * v) / max);
    const y = H - pad - h;
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = "#e5f2ff";
    ctx.fillText(String(v), x, y - 4);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.translate(x + barW / 2, H - pad + 12);
    ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = "#b6c7d8";
    ctx.textAlign = "center";
    ctx.fillText(String(labels[i] ?? "").slice(0, 12), 0, 0);
    ctx.restore();
  });
}

/* ============== CSV helpers ============== */
function csvCell(v) {
  const s = `${v ?? ""}`;
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function exportCurrentCsv() {
  downloadCsv(state.lastCsv.filename, state.lastCsv.content);
}

/* ============== Generic render pieces ============== */
function tableify(headers, rows) {
  const head = `<thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${(rows||[]).map(r=>`<tr>${r.map(c=>`<td>${c ?? ""}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table class="an-table">${head}${body}</table>`;
}

/* ============== Render per tab ============== */
function renderActive() {
  const c = document.getElementById(ui.contentId);
  if (!c) return;
  if (state.activeTab === "overview") renderOverview(c);
  else if (state.activeTab === "members") renderMembers(c);
  else if (state.activeTab === "interventions") renderInterventions(c);
  else if (state.activeTab === "departments") renderDepartments(c);
  else if (state.activeTab === "response") renderResponseTimes(c);
  else if (state.activeTab === "trends") renderTrends(c);
}

/* --- Overview --- */
function renderOverview(container) {
  const list = state.records;
  const total = list.length;
  const inCount = list.filter(r=>r.inout==="in").length;
  const outCount = list.filter(r=>r.inout==="out").length;

  const byDept = sortEntriesDesc(countBy(list, r => (r.dept||"—")));
  const byOutType = sortEntriesDesc(countBy(list.filter(r=>r.inout==="out"), r => (r.outtype||"—")));

  container.innerHTML = `
    <div class="an-grid">
      <div class="an-card">
        <h3 class="an-title">Total Records</h3>
        <div class="an-kpi">${total}</div>
        <div class="muted">All patient records in the sheet</div>
      </div>
      <div class="an-card">
        <h3 class="an-title">In/Out Ratio</h3>
        <div class="an-kpi">${outCount} Out / ${inCount} In</div>
      </div>
      <div class="an-card">
        <h3 class="an-title">Top Departments</h3>
        ${tableify(["Department","Count"], byDept.slice(0,8))}
      </div>
      <div class="an-card">
        <h3 class="an-title">Top Out Types (Out only)</h3>
        ${tableify(["Out Type","Count"], byOutType.slice(0,8))}
      </div>
    </div>
  `;
  const csv = [
    "metric,value",
    `total,${total}`,
    `out,${outCount}`,
    `in,${inCount}`,
    "",
    "Top Departments,count",
    ...byDept.map(([k,v]) => `${csvCell(k)},${v}`),
    "",
    "Top Out Types,count",
    ...byOutType.map(([k,v]) => `${csvCell(k)},${v}`),
  ].join("\n");
  state.lastCsv = { filename: "overview.csv", content: csv };
}

/* --- Members --- */
function renderMembers(container) {
  const list = state.records.map(r => ({...r, d: parseISO(r.date)}));
  const byMember = groupBy(list, r => r.member || "—");
  const rows = [];
  Object.entries(byMember).forEach(([mem, arr]) => {
    const today = fmtDate(new Date());
    const todayCount = arr.filter(r => r.date === today).length;
    const wKey = fmtWeek(new Date());
    const weekCount = arr.filter(r => fmtWeek(r.d) === wKey).length;
    const mKey = fmtMonth(new Date());
    const monthCount = arr.filter(r => fmtMonth(r.d) === mKey).length;
    const y = new Date().getFullYear();
    const yearCount = arr.filter(r => (r.d.getFullYear() === y)).length;
    rows.push([mem, todayCount, weekCount, monthCount, yearCount, arr.length]);
  });
  rows.sort((a,b)=>b[5]-a[5]);
  container.innerHTML = `
    <div class="an-card">
      <h3 class="an-title">Team productivity (Today / Week / Month / Year / Total)</h3>
      ${tableify(["Member","Today","Week","Month","Year","Total"], rows)}
    </div>
  `;
  const csv = ["member,today,week,month,year,total", ...rows.map(r=>r.map(csvCell).join(","))].join("\n");
  state.lastCsv = { filename: "members.csv", content: csv };
}

/* --- Interventions --- */
function renderInterventions(container) {
  const list = state.records;
  const byInterv = sortEntriesDesc(countBy(list, r=>r.intervention||"—"));
  const labels = byInterv.map(([k])=>k);
  const values = byInterv.map(([,v])=>v);
  container.innerHTML = `
    <div class="an-grid">
      <div class="an-card">
        <h3 class="an-title">Intervention Counts</h3>
        ${tableify(["Intervention","Count"], byInterv)}
      </div>
      <div class="an-card">
        <h3 class="an-title">Bar Chart</h3>
        <canvas class="an-chart" id="an-int-chart" height="${ui.canvasHeight}"></canvas>
      </div>
    </div>`;
  barChart(document.getElementById("an-int-chart"), labels, values);
  const csv = ["intervention,count", ...byInterv.map(([k,v])=>`${csvCell(k)},${v}`)].join("\n");
  state.lastCsv = { filename: "interventions.csv", content: csv };
}

/* --- Departments --- */
function renderDepartments(container) {
  const list = state.records;
  const byDept = sortEntriesDesc(countBy(list, r=>r.dept||"—"));
  const labels = byDept.map(([k])=>k);
  const values = byDept.map(([,v])=>v);
  container.innerHTML = `
    <div class="an-grid">
      <div class="an-card">
        <h3 class="an-title">Records by Department</h3>
        ${tableify(["Department","Count"], byDept)}
      </div>
      <div class="an-card">
        <h3 class="an-title">Bar Chart</h3>
        <canvas class="an-chart" id="an-dept-chart" height="${ui.canvasHeight}"></canvas>
      </div>
    </div>`;
  barChart(document.getElementById("an-dept-chart"), labels, values);
  const csv = ["department,count", ...byDept.map(([k,v])=>`${csvCell(k)},${v}`)].join("\n");
  state.lastCsv = { filename: "departments.csv", content: csv };
}

/* --- Response Times --- */
function renderResponseTimes(container) {
  const list = state.records;
  const counts = sortEntriesDesc(countBy(list, r => r.response_time || "—"));
  const delayed = list.filter(r => r.response_time === "more than hour");
  const topReasons = sortEntriesDesc(countBy(delayed, r => r.delay_reason || "—"));

  const labels = counts.map(([k])=>k);
  const values = counts.map(([,v])=>v);

  container.innerHTML = `
    <div class="an-grid">
      <div class="an-card">
        <h3 class="an-title">Response Time Distribution</h3>
        ${tableify(["Response Time","Count"], counts)}
      </div>
      <div class="an-card">
        <h3 class="an-title">Bar Chart</h3>
        <canvas class="an-chart" id="an-rt-chart" height="${ui.canvasHeight}"></canvas>
      </div>
      <div class="an-card">
        <h3 class="an-title">Delay Reasons (when &gt; 1 hour)</h3>
        ${tableify(["Reason","Count"], topReasons)}
      </div>
    </div>
  `;
  barChart(document.getElementById("an-rt-chart"), labels, values);

  const csv = [
    "response_time,count",
    ...counts.map(([k,v])=>`${csvCell(k)},${v}`),
    "",
    "delay_reason,count",
    ...topReasons.map(([k,v])=>`${csvCell(k)},${v}`),
  ].join("\n");
  state.lastCsv = { filename: "response_times.csv", content: csv };
}

/* --- Trends (by month) --- */
function renderTrends(container) {
  const list = state.records.map(r => ({...r, d: parseISO(r.date)})).filter(r=>!isNaN(r.d));
  const byMonth = sortEntriesDesc(countBy(list, r=>fmtMonth(r.d))).sort((a,b)=>a[0].localeCompare(b[0]));
  const labels = byMonth.map(([k])=>k);
  const values = byMonth.map(([,v])=>v);

  container.innerHTML = `
    <div class="an-grid">
      <div class="an-card">
        <h3 class="an-title">Monthly Trend (all records)</h3>
        <canvas class="an-chart" id="an-trend-chart" height="${ui.canvasHeight}"></canvas>
      </div>
      <div class="an-card">
        <h3 class="an-title">Monthly Summary</h3>
        ${tableify(["Month","Count"], byMonth)}
      </div>
    </div>
  `;
  barChart(document.getElementById("an-trend-chart"), labels, values);
  const csv = ["month,count", ...byMonth.map(([k,v])=>`${csvCell(k)},${v}`)].join("\n");
  state.lastCsv = { filename: "trends.csv", content: csv };
}

/* ============== Data refresh ============== */
async function refresh(force = false) {
  try {
    const data = await fetchAllFromSheet();
    state.records = Array.isArray(data) ? data : [];
    renderActive();
  } catch (e) {
    console.error(e);
    const c = document.getElementById(ui.contentId);
    if (c) c.innerHTML = `<div class="an-card"><h3 class="an-title">Error</h3><p>Could not load data from Google Sheets. Check GAS URL in Preferences.</p></div>`;
  }
}

/* ============== Boot ============== */
document.addEventListener("DOMContentLoaded", () => {
  ensureStyles();
  createFab();
  createPanel();
});
