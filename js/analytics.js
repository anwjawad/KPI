/* =========================================================
   js/analytics.js
   التحليلات: تقارير أسبوعية/شهرية/سنوية لكل عضو،
   تجميع حسب التاريخ/القسم/التدخل، وتصدير CSV.
   ========================================================= */

(function (global) {
  "use strict";

  // أدوات تواريخ
  function parseYMD(ymd) {
    // "2025-11-04" -> Date (local)
    if (!ymd) return null;
    const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function startOfISOWeek(d) {
    const date = new Date(d);
    const day = (date.getDay() + 6) % 7; // Monday=0 .. Sunday=6
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - day);
    return date;
  }

  function endOfISOWeek(d) {
    const s = startOfISOWeek(d);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
  }

  function startOfMonth(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), 1);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function endOfMonth(d) {
    const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  function startOfYear(d) {
    const x = new Date(d.getFullYear(), 0, 1);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function endOfYear(d) {
    const x = new Date(d.getFullYear(), 11, 31);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  function inRange(dateYMD, rangeStart, rangeEnd) {
    const dt = parseYMD(dateYMD);
    if (!dt) return false;
    return dt >= rangeStart && dt <= rangeEnd;
  }

  // أدوات تجميع
  function groupBy(list, keyFn) {
    const map = new Map();
    (list || []).forEach((item) => {
      const k = keyFn(item);
      const arr = map.get(k) || [];
      arr.push(item);
      map.set(k, arr);
    });
    return map;
  }

  function countBy(list, keyFn) {
    const counts = {};
    (list || []).forEach((item) => {
      const k = keyFn(item);
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }

  // استخراج YMD المجهّز في app-core
  function ensureYMD(list) {
    return (list || []).map((r) => {
      if (r.__ymd) return r;
      const ymd = (r.Date && typeof r.Date === "string" && r.Date.includes("/"))
        ? fromDdMmYyyyToYmd(r.Date) : "";
      return { ...r, __ymd: ymd };
    });
  }

  function fromDdMmYyyyToYmd(ddmmyyyy) {
    if (!ddmmyyyy || !ddmmyyyy.includes("/")) return "";
    const [dd, mm, yyyy] = ddmmyyyy.split("/");
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // تقارير لكل عضو
  function perMemberSummary(list) {
    const byMember = countBy(list, (r) => (r["Palliative Member"] || "").trim() || "غير محدد");
    return byMember;
  }

  function perInterventionSummary(list) {
    const byIntervention = countBy(list, (r) => (r["Intervention"] || "").trim() || "غير محدد");
    return byIntervention;
  }

  function perDepartmentSummary(list) {
    const byDep = countBy(list, (r) => (r["Department"] || "").trim() || "غير محدد");
    return byDep;
  }

  // نافذة زمنية
  function filterByRange(list, startDate, endDate) {
    const arr = ensureYMD(list);
    return arr.filter((r) => inRange(r.__ymd, startDate, endDate));
  }

  // تقارير أسبوعية/شهرية/سنوية
  function weeklyReport(dateInWeekYMD) {
    const ref = parseYMD(dateInWeekYMD) || new Date();
    const s = startOfISOWeek(ref);
    const e = endOfISOWeek(ref);
    const data = App.getState().data || [];
    const week = filterByRange(data, s, e);

    return {
      range: { start: s, end: e },
      byMember: perMemberSummary(week),
      byIntervention: perInterventionSummary(week),
      byDepartment: perDepartmentSummary(week),
      total: week.length,
      raw: week,
    };
  }

  function monthlyReport(year, month1to12) {
    const d = new Date(year, month1to12 - 1, 15);
    const s = startOfMonth(d);
    const e = endOfMonth(d);
    const data = App.getState().data || [];
    const month = filterByRange(data, s, e);

    return {
      range: { start: s, end: e },
      byMember: perMemberSummary(month),
      byIntervention: perInterventionSummary(month),
      byDepartment: perDepartmentSummary(month),
      total: month.length,
      raw: month,
    };
  }

  function yearlyReport(year) {
    const d = new Date(year, 6, 1);
    const s = startOfYear(d);
    const e = endOfYear(d);
    const data = App.getState().data || [];
    const yr = filterByRange(data, s, e);

    return {
      range: { start: s, end: e },
      byMember: perMemberSummary(yr),
      byIntervention: perInterventionSummary(yr),
      byDepartment: perDepartmentSummary(yr),
      total: yr.length,
      raw: yr,
    };
  }

  // تصدير CSV بسيط لأي مجموعة سجلات
  function toCSV(rows, headers) {
    const hdrs = headers || [
      "Patient Name",
      "Patient Code",
      "Intervention",
      "Department",
      "Palliative Member",
      "Date",
    ];
    const esc = (v) => {
      const s = (v === undefined || v === null) ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = hdrs.map(esc).join(",");
    const body = (rows || []).map((r) => hdrs.map((h) => esc(r[h])).join(",")).join("\n");
    return head + "\n" + body;
  }

  function downloadCSV(filename, rows, headers) {
    const csv = toCSV(rows, headers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "report.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  // ربط سريع مع الواجهة (اختياري: زر تنزيل تقارير)
  function attachQuickExportButtons() {
    // يمكن لاحقًا إضافة أزرار في index.html واستدعاء هذه الدوال
    // مثال:
    // const weeklyBtn = document.getElementById("exportWeekly");
    // if (weeklyBtn) weeklyBtn.onclick = () => {
    //   const rep = weeklyReport(App.getState().todayKey);
    //   downloadCSV("weekly.csv", rep.raw);
    // };
  }

  const Analytics = {
    weeklyReport,
    monthlyReport,
    yearlyReport,
    perMemberSummary,
    perInterventionSummary,
    perDepartmentSummary,
    toCSV,
    downloadCSV,
    attachQuickExportButtons,
  };

  global.Analytics = Analytics;

})(window);
