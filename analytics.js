/* ======================================================
   KPI2 • Palliative Care Monitor
   ملف: analytics.js (ES Module)
   - زر عائم لفتح لوحة "النتائج والتحليلات"
   - يسحب البيانات من Google Sheets عبر GAS (pullAll) باستخدام JSONP
   - تحليلات: إجماليات، أعضاء الفريق، التدخلات، الأقسام، الترند
   - تصدير CSV للنتائج
   ====================================================== */

import { KEYS, DEFAULT_GAS_URL, buildJsonpUrl } from "./schema.js";

/* ============== إعدادات عامة ============== */
const ui = {
  fabId: "fab-analytics",
  panelId: "analytics-panel",
  canvasHeight: 220,
};

/* ============== أدوات قراءة التفضيلات/GAS ============== */
function getPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEYS.prefs) || "null") || {};
    return p;
  } catch {
    return {};
  }
}
function getGasBase() {
  const p = getPrefs();
  return (p.gasUrlOverride && p.gasUrlOverride.trim()) || DEFAULT_GAS_URL;
}

/* ============== JSONP خفيف ============== */
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

/* ============== جلب البيانات من Google Sheets ============== */
async function fetchAllFromSheet() {
  const gas = getGasBase();
  const url = buildJsonpUrl(gas, { action: "pullAll" });
  const res = await jsonp(url);
  if (!res || !Array.isArray(res.records)) throw new Error("No records");
  // تنظيف/تطبيع بسيط
  return res.records.map((r) => ({
    id: r.id || "",
    date: (r.date || "").slice(0, 10), // YYYY-MM-DD
    name: r.name || "",
    code: r.code || "",
    inout: r.inout || "",
    outtype: r.outtype || "",
    dept: r.dept || "",
    intervention: r.intervention || "",
    member: r.member || "",
    notes: r.notes || "",
  }));
}

/* ============== أدوات تحليل ============== */
const parseISO = (s) => {
  const [y, m, d] = (s || "0000-01-01").split("-").map((x) => +x);
  return new Date(y, (m || 1) - 1, d || 1);
};
const fmtMonth = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const fmtDate = (d) => d.toISOString().slice(0,10);
const startOfWeek = (d) => { const x = new Date(d); const day = x.getDay(); x.setDate(x.getDate() - day); x.setHours(0,0,0,0); return x; }; // الأحد بداية
const fmtWeek = (d) => fmtDate(startOfWeek(d));
const groupBy = (arr, keyFn) => arr.reduce((acc, x) => { const k = keyFn(x); (acc[k] ||= []).push(x); return acc; }, {});
const countBy = (arr, keyFn) => arr.reduce((acc, x) => { const k = keyFn(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
const sortEntriesDesc = (obj) => Object.entries(obj).sort((a,b)=>b[1]-a[1]);

/* ============== UI بناء الزر واللوحة ============== */
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
  animation: fadein var(--speed) var(--ease) both;
}
#${ui.panelId} .sheet{
  position:absolute; inset-inline: max(8px, 4dvw); inset-block-start: max(8px, 4dvh);
  inset-block-end: max(8px, 4dvh);
  background: var(--card); border:1px solid rgba(255,255,255,.1); border-radius: 18px;
  box-shadow: var(--shadow); padding: 12px; display:flex; flex-direction:column; gap: 10px;
  animation: var(--motion-in);
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

function createFab() {
  if (document.getElementById(ui.fabId)) return;
  const btn = document.createElement("button");
  btn.id = ui.fabId;
  btn.className = "btn btn-primary";
  btn.textContent = "📊 التحليلات";
  btn.title = "عرض النتائج والتحليلات من Google Sheets";
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
          <strong>النتائج والتحليلات</strong>
          <button class="btn btn-ghost" id="an-refresh">⟳ تحديث من الشيت</button>
          <button class="btn" id="an-export">⤓ تصدير CSV</button>
        </div>
        <div class="tabs">
          <button class="tab active" data-tab="overview">نظرة عامة</button>
          <button class="tab" data-tab="members">أعضاء الفريق</button>
          <button class="tab" data-tab="interventions">التدخلات</button>
          <button class="tab" data-tab="departments">الأقسام</button>
          <button class="tab" data-tab="trends">الترند</button>
          <button class="btn btn-ghost" id="an-close">×</button>
        </div>
      </div>
      <div class="content" id="an-content"></div>
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
  // أول فتح: تحميل إن لم تُحمّل
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

/* ============== حالة التحليل ============== */
const state = {
  records: [],
  activeTab: "overview",
  lastCsv: { filename: "analytics.csv", content: "type,value\n" },
};

/* ============== رسم بسيط على Canvas ============== */
function barChart(canvas, labels, values) {
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
  const barW = Math.max(6, (W - pad * 2) / values.length - 10);

  // axis
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(pad, H - pad);
  ctx.lineTo(W - pad, H - pad);
  ctx.strokeStyle = "#999";
  ctx.stroke();
  ctx.globalAlpha = 1;

  // bars
  values.forEach((v, i) => {
    const x = pad + i * (barW + 10);
    const h = Math.round(((H - pad * 2) * v) / max);
    const y = H - pad - h;
    // bar
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(x, y, barW, h);
    // value
    ctx.fillStyle = "#e5f2ff";
    ctx.fillText(String(v), x, y - 4);
    // label
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.translate(x + barW / 2, H - pad + 12);
    ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = "#b6c7d8";
    ctx.textAlign = "center";
    ctx.fillText(labels[i]?.toString().slice(0, 12), 0, 0);
    ctx.restore();
  });
}

/* ============== تصدير CSV ============== */
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

/* ============== رندرة التبويبات ============== */
function renderActive() {
  const c = document.getElementById("an-content");
  if (!c) return;
  if (state.activeTab === "overview") renderOverview(c);
  else if (state.activeTab === "members") renderMembers(c);
  else if (state.activeTab === "interventions") renderInterventions(c);
  else if (state.activeTab === "departments") renderDepartments(c);
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
        <h3 class="an-title">إجمالي السجلات</h3>
        <div class="an-kpi">${total}</div>
        <div class="muted">عدد المرضى عبر كامل التاريخ بالشيت</div>
      </div>

      <div class="an-card">
        <h3 class="an-title">In/Out Ratio</h3>
        <div class="an-kpi">${outCount} Out / ${inCount} In</div>
        <div class="muted">تمييز طابع العمل اليومي</div>
      </div>

      <div class="an-card">
        <h3 class="an-title">Top Departments</h3>
        ${tableify(["القسم","العدد"], byDept.slice(0,8))}
      </div>

      <div class="an-card">
        <h3 class="an-title">Top Out Types (Out only)</h3>
        ${tableify(["Out Type","العدد"], byOutType.slice(0,8))}
      </div>
    </div>
  `;

  // CSV
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

  // اليوم/الأسبوع/الشهر/السنة لكل عضو
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
      <h3 class="an-title">إنتاجية أعضاء الفريق (اليوم/الأسبوع/الشهر/السنة/الإجمالي)</h3>
      ${tableify(["العضو","اليوم","الأسبوع","الشهر","السنة","الإجمالي"], rows)}
    </div>
  `;

  const csv = [
    "member,today,week,month,year,total",
    ...rows.map(r=>r.map(csvCell).join(",")),
  ].join("\n");
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
        <h3 class="an-title">عدد السجلات لكل نوع تدخل</h3>
        ${tableify(["التدخل","العدد"], byInterv)}
      </div>
      <div class="an-card">
        <h3 class="an-title">رسم عمودي</h3>
        <canvas class="an-chart" id="an-int-chart" height="${ui.canvasHeight}"></canvas>
      </div>
    </div>
  `;
  const cv = document.getElementById("an-int-chart");
  barChart(cv, labels, values);

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
        <h3 class="an-title">سجلات حسب القسم</h3>
        ${tableify(["القسم","العدد"], byDept)}
      </div>
      <div class="an-card">
        <h3 class="an-title">رسم عمودي</h3>
        <canvas class="an-chart" id="an-dept-chart" height="${ui.canvasHeight}"></canvas>
      </div>
    </div>
  `;
  barChart(document.getElementById("an-dept-chart"), labels, values);

  const csv = ["department,count", ...byDept.map(([k,v])=>`${csvCell(k)},${v}`)].join("\n");
  state.lastCsv = { filename: "departments.csv", content: csv };
}

/* --- Trends --- */
function renderTrends(container) {
  const list = state.records.map(r => ({...r, d: parseISO(r.date)}));
  // ترند يومي (آخر 30 يوم)
  const today = new Date(); today.setHours(0,0,0,0);
  const back = new Date(today); back.setDate(today.getDate()-29);

  const byDay = countBy(list.filter(r => r.d >= back), r => fmtDate(r.d));
  const dayKeys = [];
  for (let x = new Date(back); x <= today; x.setDate(x.getDate()+1)) dayKeys.push(fmtDate(new Date(x)));
  const dayVals = dayKeys.map(k => byDay[k] || 0);

  // ترند أسبوعي (آخر 12 أسبوع)
  const wToday = startOfWeek(new Date());
  const wStart = new Date(wToday); wStart.setDate(wToday.getDate() - 7*11);
  const byWeek = countBy(list.filter(r => r.d >= wStart), r => fmtWeek(r.d));
  const weekKeys = [];
  for (let x = new Date(wStart); x <= wToday; x.setDate(x.getDate()+7)) weekKeys.push(fmtDate(startOfWeek(new Date(x))));
  const weekVals = weekKeys.map(k => byWeek[k] || 0);

  container.innerHTML = `
    <div class="an-grid">
      <div class="an-card">
        <h3 class="an-title">ترند يومي (آخر 30 يوم)</h3>
        <canvas class="an-chart" id="an-day-chart" height="${ui.canvasHeight}"></canvas>
      </div>
      <div class="an-card">
        <h3 class="an-title">ترند أسبوعي (آخر 12 أسبوع)</h3>
        <canvas class="an-chart" id="an-week-chart" height="${ui.canvasHeight}"></canvas>
      </div>
    </div>
  `;
  barChart(document.getElementById("an-day-chart"), dayKeys.map(k=>k.slice(5)), dayVals);
  barChart(document.getElementById("an-week-chart"), weekKeys.map(k=>k.slice(5)), weekVals);

  // CSV
  const csv = [
    "date,count",
    ...dayKeys.map((k,i)=>`${k},${dayVals[i]}`),
    "",
    "week_start,count",
    ...weekKeys.map((k,i)=>`${k},${weekVals[i]}`),
  ].join("\n");
  state.lastCsv = { filename: "trends.csv", content: csv };
}

/* ============== عناصر مساعدة للعرض ============== */
function tableify(headers, rows) {
  const th = `<tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const tr = rows.map(r => `<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("");
  return `<table class="an-table"><thead>${th}</thead><tbody>${tr}</tbody></table>`;
}
function escapeHtml(v) {
  v = (v ?? "").toString();
  return v.replace(/[&<>"']/g, (m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
}
function csvCell(v){
  const s = (v ?? "").toString();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

/* ============== تحديث البيانات ============== */
async function refresh(showToast = false) {
  try {
    setBusy(true);
    const recs = await fetchAllFromSheet();
    state.records = recs;
    renderActive();
    if (showToast) showInfo("تم التحديث من Google Sheets.");
  } catch (e) {
    console.error(e);
    showInfo("تعذر تحديث البيانات من Google Sheets.", "danger");
  } finally {
    setBusy(false);
  }
}

/* ============== رسائل صغيرة (تستخدم toast الموجود إذا وُجد) ============== */
function showInfo(msg, type="info") {
  const toast = document.getElementById("toast");
  const text = document.getElementById("toast-text");
  if (toast && text) {
    toast.classList.remove("toast-hidden","toast-success","toast-danger","toast-info");
    toast.classList.add(`toast-${type}`);
    text.textContent = msg;
    return;
  }
  // fallback
  console.log(`[${type}] ${msg}`);
}
function setBusy(b){
  const btn = document.getElementById(ui.fabId);
  if (btn) btn.disabled = !!b;
}

/* ============== إقلاع ============== */
(function boot(){
  ensureStyles();
  createFab();
  createPanel();
  // تحميل أولي صامت في الخلفية عند أول فتح للوحة
})();
