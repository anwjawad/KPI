/* =========================================================
   js/ui-view.js
   العرض، عناصر DOM، الإشعارات، الفلاتر، الاستيراد، التفضيلات
   ========================================================= */

(function (global) {
  "use strict";

  // عناصر DOM
  const els = {
    tableBody: null,
    filterDepartment: null,
    filterIntervention: null,
    filterMember: null,
    filterDate: null,
    teamCounters: null,
    csvInput: null,
    importBtn: null,
    preferencesBtn: null,
    notification: null,
  };

  // ------------------------------------------------------
  // أدوات DOM مساعدة
  // ------------------------------------------------------
  function qs(sel) { return document.querySelector(sel); }
  function ce(tag, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  // ------------------------------------------------------
  // إشعارات
  // ------------------------------------------------------
  function notify(msg, type = "info") {
    if (!els.notification) return;
    els.notification.textContent = msg;
    els.notification.classList.remove("hidden", "error", "info", "success");
    els.notification.classList.add(type === "error" ? "error" : (type === "success" ? "success" : "info"));

    // تأثير بسيط + إخفاء تلقائي
    els.notification.style.opacity = "1";
    setTimeout(() => {
      els.notification.style.opacity = "0";
      setTimeout(() => els.notification.classList.add("hidden"), 500);
    }, 2800);
  }

  // ------------------------------------------------------
  // تهيئة عناصر DOM والربط
  // ------------------------------------------------------
  function initDom() {
    els.tableBody = qs("#patientTable tbody");
    els.filterDepartment = qs("#filterDepartment");
    els.filterIntervention = qs("#filterIntervention");
    els.filterMember = qs("#filterMember");
    els.filterDate = qs("#filterDate");
    els.teamCounters = qs("#teamCounters");
    els.csvInput = qs("#csvImport");
    els.importBtn = qs("#importBtn");
    els.preferencesBtn = qs("#preferencesBtn");
    els.notification = qs("#notification");

    // فلاتر
    els.filterDepartment.addEventListener("change", (e) => App.setFilter("department", e.target.value));
    els.filterIntervention.addEventListener("change", (e) => App.setFilter("intervention", e.target.value));
    els.filterMember.addEventListener("change", (e) => App.setFilter("member", e.target.value));
    els.filterDate.addEventListener("change", (e) => App.setFilter("date", e.target.value));

    // استيراد
    els.importBtn.addEventListener("click", onImportClick);

    // تفضيلات
    els.preferencesBtn.addEventListener("click", openPreferences);
  }

  // ------------------------------------------------------
  // تعبئة خيارات الفلاتر ديناميكيًا
  // ------------------------------------------------------
  function populateFilters({ departments = [], members = [], interventions = [] }) {
    // department
    fillSelect(els.filterDepartment, [""].concat(departments), (v) => v || "كل الأقسام");

    // intervention (ثابتة مبدئيًا لكن نضمنها هنا)
    if (interventions && interventions.length) {
      fillSelect(els.filterIntervention, [""].concat(interventions), (v) => v || "كل التدخلات");
    }

    // members
    if (members && members.length) {
      fillSelect(els.filterMember, [""].concat(members), (v) => v || "كل الأعضاء");
    }
  }

  function fillSelect(selectEl, values, labelFn) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = "";
    values.forEach((val) => {
      const opt = ce("option");
      opt.value = val;
      opt.textContent = labelFn ? labelFn(val) : val;
      selectEl.appendChild(opt);
    });
    // الحفاظ على الاختيار إن أمكن
    if ([...selectEl.options].some((o) => o.value === current)) {
      selectEl.value = current;
    } else if (selectEl.options.length) {
      selectEl.selectedIndex = 0;
    }
  }

  // ------------------------------------------------------
  // رسم الجدول
  // ------------------------------------------------------
  function renderTable(list) {
    if (!els.tableBody) return;
    els.tableBody.innerHTML = "";

    (list || []).forEach((r) => {
      const tr = ce("tr", "row");
      const tds = [
        r["Patient Name"] || "",
        r["Patient Code"] || "",
        r["Intervention"] || "",
        r["Department"] || "",
        r["Palliative Member"] || "",
        r["Date"] || "",
      ];
      tds.forEach((txt) => {
        const td = ce("td");
        td.textContent = txt;
        tr.appendChild(td);
      });
      els.tableBody.appendChild(tr);
    });

    // تأثير بسيط (fade-in)
    try {
      const rows = els.tableBody.querySelectorAll("tr");
      rows.forEach((row, i) => {
        row.style.opacity = "0";
        row.style.transform = "translateY(6px)";
        setTimeout(() => {
          row.style.transition = "opacity 220ms ease, transform 220ms ease";
          row.style.opacity = "1";
          row.style.transform = "translateY(0)";
        }, 12 * i);
      });
    } catch {}
  }

  // ------------------------------------------------------
  // عدّادات الفريق في أعلى الصفحة
  // ------------------------------------------------------
  function renderCounters(counterMap) {
    if (!els.teamCounters) return;
    els.teamCounters.innerHTML = "";

    Object.keys(counterMap).forEach((member) => {
      const card = ce("div", "counter-card");
      const name = ce("div", "counter-name");
      const val = ce("div", "counter-val");
      name.textContent = member;
      val.textContent = counterMap[member] || 0;
      card.appendChild(name);
      card.appendChild(val);
      els.teamCounters.appendChild(card);
    });
  }

  // ------------------------------------------------------
  // استيراد CSV
  // ------------------------------------------------------
  async function onImportClick() {
    const file = els.csvInput && els.csvInput.files && els.csvInput.files[0];
    if (!file) {
      notify("اختر ملف CSV أولاً.", "error");
      return;
    }

    // نافذة سريعة لتعيين قسم افتراضي وعضو افتراضي (اختياري)
    const defaults = await quickDefaultsPrompt();
    try {
      await App.importCsvFile(file, defaults);
      notify("تم الاستيراد بنجاح.", "success");
    } catch (e) {
      console.error(e);
      notify("فشل الاستيراد. تأكد من التمبليت والملف.", "error");
    } finally {
      els.csvInput.value = "";
    }
  }

  function quickDefaultsPrompt() {
    return new Promise((resolve) => {
      // بناء مودال بسيط جدًا (لا يتطلب CSS إضافي)
      const modal = ce("div", "modal");
      modal.innerHTML = `
        <div class="modal-inner">
          <h3>خيارات افتراضية للاستيراد</h3>
          <label>القسم الافتراضي (اختياري)</label>
          <input type="text" id="impDefaultDept" placeholder="مثال: Internal Medicine" />
          <label>عضو الفريق الافتراضي (اختياري)</label>
          <input type="text" id="impDefaultMem" placeholder="مثال: جواد ابو صبحة" />
          <div class="modal-actions">
            <button id="impConfirm">استمرار</button>
            <button id="impCancel" class="ghost">إلغاء</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const close = () => {
        document.body.removeChild(modal);
      };

      modal.querySelector("#impCancel").addEventListener("click", () => {
        close();
        resolve({}); // لا شيء افتراضي
      });
      modal.querySelector("#impConfirm").addEventListener("click", () => {
        const defaultDepartment = modal.querySelector("#impDefaultDept").value.trim();
        const defaultMember = modal.querySelector("#impDefaultMem").value.trim();
        close();
        resolve({
          defaultDepartment: defaultDepartment || "",
          defaultMember: defaultMember || "",
        });
      });
    });
  }

  // ------------------------------------------------------
  // تفضيلات (نافذة مصغّرة)
  // ------------------------------------------------------
  function openPreferences() {
    const prefs = App.getState().preferences;
    const modal = ce("div", "modal");
    modal.innerHTML = `
      <div class="modal-inner">
        <h3>الإعدادات</h3>

        <label>الثيم</label>
        <select id="prefTheme">
          <option value="ocean">ocean</option>
          <option value="glow">glow</option>
          <option value="mint">mint</option>
          <option value="rose">rose</option>
          <option value="down">down</option>
          <option value="upper">upper</option>
          <option value="dark">dark</option>
          <option value="light-blue">light blue</option>
          <option value="dark-blue">dark blue</option>
          <option value="tirkwaz">tirkwaz</option>
          <option value="gradient">gradient</option>
        </select>

        <label>شكل الحركة (Transition)</label>
        <select id="prefTransStyle">
          <option value="fade">Fade</option>
          <option value="slide">Slide</option>
          <option value="glow">Glow</option>
        </select>

        <label>سرعة الحركة (ms)</label>
        <input type="number" id="prefTransSpeed" min="80" max="2000" step="20" />

        <label>GAS URL (رابط الويب آب)</label>
        <input type="text" id="prefGasUrl" placeholder="https://script.google.com/macros/s/....../exec" />

        <div class="modal-actions">
          <button id="prefSave">حفظ</button>
          <button id="prefCancel" class="ghost">إغلاق</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // قيم أولية
    modal.querySelector("#prefTheme").value = prefs.theme || "ocean";
    modal.querySelector("#prefTransStyle").value = prefs.transitionStyle || "fade";
    modal.querySelector("#prefTransSpeed").value = prefs.transitionSpeed || 300;
    modal.querySelector("#prefGasUrl").value = prefs.gasUrl || "";

    const close = () => document.body.removeChild(modal);

    modal.querySelector("#prefCancel").addEventListener("click", close);
    modal.querySelector("#prefSave").addEventListener("click", () => {
      const theme = modal.querySelector("#prefTheme").value;
      const style = modal.querySelector("#prefTransStyle").value;
      const speed = parseInt(modal.querySelector("#prefTransSpeed").value, 10) || 300;
      const gasUrl = modal.querySelector("#prefGasUrl").value.trim();

      App.setPreference("theme", theme);
      App.setPreference("transitionStyle", style);
      App.setPreference("transitionSpeed", speed);
      if (gasUrl) App.setPreference("gasUrl", gasUrl);

      notify("تم حفظ الإعدادات.", "success");
      close();
    });
  }

  // ------------------------------------------------------
  // تطبيق تفضيلات الحركة بصيغة عامة (تُستَخدم في app-core أيضًا)
  // ------------------------------------------------------
  function applyTransitionPrefs(style, speed) {
    document.documentElement.style.setProperty("--transition-speed", `${speed}ms`);
    document.documentElement.setAttribute("data-transition", style || "fade");
  }

  // ------------------------------------------------------
  // تصدير UI API
  // ------------------------------------------------------
  const UI = {
    initDom,
    renderTable,
    renderCounters,
    notify,
    populateFilters,
    applyTransitionPrefs,
  };

  global.UI = UI;

  // عند تحميل DOM
  document.addEventListener("DOMContentLoaded", () => {
    initDom();
  });

})(window);
