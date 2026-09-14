/* =========================================================
   CLOrad — Risks / Warnings
   EMS / CSF source selector
   ========================================================= */

(() => {
  "use strict";

  const nav = document.getElementById("nav");
  if (!nav) return;

  // Находим кнопку «Предупр.»
  const warningButton = [...nav.querySelectorAll(".n")].find(
    el => el.textContent.trim() === "Предупр."
  );

  if (!warningButton) return;

  let currentSource = "EMS";
  let panel = null;

  /* =========================================================
     CSS
     ========================================================= */

  const style = document.createElement("style");

  style.textContent = `
    #risksSourcePanel {
      position: fixed;
      z-index: 99999;

      width: 150px;
      box-sizing: border-box;

      padding: 8px;

      border: 1px solid rgba(255,255,255,.09);
      border-radius: 11px;

      background: rgba(25,25,28,.96);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);

      box-shadow:
        0 8px 24px rgba(0,0,0,.35),
        0 1px 3px rgba(0,0,0,.25);

      opacity: 0;
      transform: translateY(-4px) scale(.98);
      pointer-events: none;

      transition:
        opacity .16s ease,
        transform .16s ease;
    }

    #risksSourcePanel.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    #risksSourcePanel .risksSources {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }

    #risksSourcePanel .riskSource {
      flex: 1;

      height: 30px;
      min-width: 0;

      padding: 0 7px;

      border: 1px solid rgba(255,255,255,.08);
      border-radius: 7px;

      background: rgba(255,255,255,.045);
      color: rgba(255,255,255,.72);

      font-family: inherit;
      font-size: 11px;
      font-weight: 600;

      cursor: pointer;

      transition:
        background .14s ease,
        color .14s ease,
        border-color .14s ease,
        transform .1s ease;
    }

    #risksSourcePanel .riskSource:active {
      transform: scale(.96);
    }

    #risksSourcePanel .riskSource.active {
      background: rgba(255,255,255,.13);
      border-color: rgba(255,255,255,.17);
      color: #fff;
    }

    /* =====================================================
       Нижний переключатель
       ===================================================== */

    #risksSourcePanel .risksToggleRow {
      display: flex;
      align-items: center;
      justify-content: center;

      margin-top: 8px;
      padding-top: 7px;

      border-top: 1px solid rgba(255,255,255,.07);
    }

    #risksSourcePanel .risksToggle {
      position: relative;

      width: 54px;
      height: 24px;

      border-radius: 999px;

      background: rgba(255,255,255,.10);
      border: 1px solid rgba(255,255,255,.08);

      cursor: pointer;

      transition: background .18s ease;
    }

    #risksSourcePanel .risksToggleKnob {
      position: absolute;

      top: 3px;
      left: 3px;

      width: 18px;
      height: 18px;

      border-radius: 50%;

      background: #fff;

      box-shadow: 0 2px 6px rgba(0,0,0,.35);

      transition:
        transform .18s ease,
        background .18s ease;
    }

    #risksSourcePanel .risksToggle.csF {
      background: rgba(255,255,255,.16);
    }

    #risksSourcePanel .risksToggle.csF .risksToggleKnob {
      transform: translateX(30px);
    }

    #risksSourcePanel .risksToggleLabels {
      display: flex;
      align-items: center;

      margin-left: 7px;

      font-size: 9px;
      font-weight: 600;

      line-height: 1;
    }

    #risksSourcePanel .risksToggleLabel {
      color: rgba(255,255,255,.38);
      transition: color .16s ease;
    }

    #risksSourcePanel .risksToggleLabel.active {
      color: rgba(255,255,255,.85);
    }

    /* =====================================================
       Светлая тема
       ===================================================== */

    body.light #risksSourcePanel,
    body[data-theme="light"] #risksSourcePanel {
      background: rgba(245,245,247,.97);
      border-color: rgba(0,0,0,.09);

      box-shadow:
        0 8px 24px rgba(0,0,0,.15),
        0 1px 3px rgba(0,0,0,.10);
    }

    body.light #risksSourcePanel .riskSource,
    body[data-theme="light"] #risksSourcePanel .riskSource {
      background: rgba(0,0,0,.035);
      border-color: rgba(0,0,0,.07);
      color: rgba(0,0,0,.58);
    }

    body.light #risksSourcePanel .riskSource.active,
    body[data-theme="light"] #risksSourcePanel .riskSource.active {
      background: rgba(0,0,0,.09);
      border-color: rgba(0,0,0,.13);
      color: #111;
    }

    body.light #risksSourcePanel .risksToggleRow,
    body[data-theme="light"] #risksSourcePanel .risksToggleRow {
      border-top-color: rgba(0,0,0,.07);
    }

    body.light #risksSourcePanel .risksToggle,
    body[data-theme="light"] #risksSourcePanel .risksToggle {
      background: rgba(0,0,0,.09);
      border-color: rgba(0,0,0,.07);
    }

    body.light #risksSourcePanel .risksToggle.csF,
    body[data-theme="light"] #risksSourcePanel .risksToggle.csF {
      background: rgba(0,0,0,.15);
    }

    body.light #risksSourcePanel .risksToggleLabel,
    body[data-theme="light"] #risksSourcePanel .risksToggleLabel {
      color: rgba(0,0,0,.35);
    }

    body.light #risksSourcePanel .risksToggleLabel.active,
    body[data-theme="light"] #risksSourcePanel .risksToggleLabel.active {
      color: rgba(0,0,0,.75);
    }

    /* =====================================================
       Телефон
       ===================================================== */

    @media (max-width: 480px) {
      #risksSourcePanel {
        width: 145px;
        padding: 7px;
        border-radius: 10px;
      }

      #risksSourcePanel .riskSource {
        height: 29px;
        font-size: 10.5px;
      }
    }
  `;

  document.head.appendChild(style);

  /* =========================================================
     Создание панели
     ========================================================= */

  function createPanel() {
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "risksSourcePanel";

    panel.innerHTML = `
      <div class="risksSources">
        <button class="riskSource active" data-source="EMS">
          EMS
        </button>

        <button class="riskSource" data-source="CSF">
          CSF
        </button>
      </div>

      <div class="risksToggleRow">
        <div class="risksToggle" role="switch" aria-label="Источник рисков">
          <div class="risksToggleKnob"></div>
        </div>

        <div class="risksToggleLabels">
          <span class="risksToggleLabel active" data-label="EMS">EMS</span>
          <span style="margin:0 3px;color:rgba(255,255,255,.25)">/</span>
          <span class="risksToggleLabel" data-label="CSF">CSF</span>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    const sourceButtons = panel.querySelectorAll(".riskSource");

    sourceButtons.forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();

        setSource(button.dataset.source);

        // После выбора сразу закрываем панель
        closePanel();
      });
    });

    const toggle = panel.querySelector(".risksToggle");

    toggle.addEventListener("click", event => {
      event.stopPropagation();

      setSource(currentSource === "EMS" ? "CSF" : "EMS");
    });

    return panel;
  }

  /* =========================================================
     Источник
     ========================================================= */

  function setSource(source) {
    currentSource = source === "CSF" ? "CSF" : "EMS";

    if (!panel) return;

    panel.querySelectorAll(".riskSource").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.source === currentSource
      );
    });

    const toggle = panel.querySelector(".risksToggle");

    if (toggle) {
      toggle.classList.toggle("csF", currentSource === "CSF");
      toggle.setAttribute(
        "aria-checked",
        currentSource === "CSF" ? "true" : "false"
      );
    }

    panel.querySelectorAll(".risksToggleLabel").forEach(label => {
      label.classList.toggle(
        "active",
        label.dataset.label === currentSource
      );
    });

    /*
      Здесь позже можно подключить реальные данные:

      if (currentSource === "EMS") {
        // загрузка EMS
      }

      if (currentSource === "CSF") {
        // загрузка CSF
      }
    */
  }

  /* =========================================================
     Позиционирование
     ========================================================= */

  function positionPanel() {
    if (!panel || !panel.classList.contains("open")) return;

    const rect = warningButton.getBoundingClientRect();

    const gap = 6;

    let left = rect.left;
    let top = rect.bottom + gap;

    const panelRect = panel.getBoundingClientRect();

    // Не даём панели уйти вправо
    if (left + panelRect.width > window.innerWidth - 8) {
      left = window.innerWidth - panelRect.width - 8;
    }

    // Не даём панели уйти влево
    if (left < 8) {
      left = 8;
    }

    // Если снизу мало места — показываем сверху кнопки
    if (top + panelRect.height > window.innerHeight - 8) {
      top = rect.top - panelRect.height - gap;
    }

    if (top < 8) {
      top = 8;
    }

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  /* =========================================================
     Открытие / закрытие
     ========================================================= */

  function openPanel() {
    createPanel();

    panel.classList.add("open");

    // Сначала ставим примерно на место,
    // затем уточняем после появления
    positionPanel();

    requestAnimationFrame(positionPanel);
  }

  function closePanel() {
    if (!panel) return;

    panel.classList.remove("open");
  }

  function togglePanel() {
    if (!panel || !panel.classList.contains("open")) {
      openPanel();
    } else {
      closePanel();
    }
  }

  /* =========================================================
     Клик по «Предупр.»
     ========================================================= */

  warningButton.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();

      togglePanel();
    },
    true
  );

  /* =========================================================
     Клик вне панели
     ========================================================= */

  document.addEventListener("click", event => {
    if (!panel || !panel.classList.contains("open")) return;

    if (
      event.target.closest("#risksSourcePanel") ||
      event.target.closest(".n")
    ) {
      return;
    }

    closePanel();
  });

  /* =========================================================
     Закрытие при закрытии главного меню
     ========================================================= */

  const observer = new MutationObserver(() => {
    if (nav.classList.contains("closed")) {
      closePanel();
    }
  });

  observer.observe(nav, {
    attributes: true,
    attributeFilter: ["class"]
  });

  /* =========================================================
     Перемещение / изменение размера окна
     ========================================================= */

  window.addEventListener("resize", positionPanel);
  window.addEventListener("orientationchange", positionPanel);

  window.addEventListener(
    "scroll",
    positionPanel,
    true
  );

  /* =========================================================
     API
     ========================================================= */

  window.CLOradRisks = {
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,

    setSource: source => {
      setSource(source);
    },

    getSource: () => currentSource,

    isOpen: () =>
      !!panel && panel.classList.contains("open")
  };

})();
