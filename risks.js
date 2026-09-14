/* =========================================================
   CLOrad — Risks / Warnings
   EMS / CSF
   ========================================================= */

(() => {
  "use strict";

  const nav = document.getElementById("nav");
  if (!nav) return;

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

    /* EMS / CSF */
    #risksSourcePanel .risksSources {
      display: flex;
      align-items: center;
      gap: 5px;
      width: 100%;
    }

    #risksSourcePanel .riskSource {
      flex: 1;

      height: 30px;

      padding: 0;

      border: 1px solid rgba(255,255,255,.08);
      border-radius: 7px;

      background: rgba(255,255,255,.045);
      color: rgba(255,255,255,.68);

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

    #risksSourcePanel .riskSource.active {
      background: rgba(255,255,255,.13);
      border-color: rgba(255,255,255,.17);
      color: #fff;
    }

    #risksSourcePanel .riskSource:active {
      transform: scale(.96);
    }

    /* =========================================================
       Переключатель
       ========================================================= */

    #risksSourcePanel .risksToggleRow {
      display: flex;
      justify-content: center;
      align-items: center;

      margin-top: 8px;
      padding-top: 7px;

      border-top: 1px solid rgba(255,255,255,.07);
    }

    #risksSourcePanel .risksToggle {
      position: relative;

      width: 42px;
      height: 22px;

      flex-shrink: 0;

      border-radius: 999px;

      background: rgba(255,255,255,.10);
      border: 1px solid rgba(255,255,255,.08);

      cursor: pointer;

      transition:
        background .18s ease,
        border-color .18s ease;
    }

    #risksSourcePanel .risksToggle::after {
      content: "";

      position: absolute;

      width: 16px;
      height: 16px;

      top: 2px;
      left: 2px;

      border-radius: 50%;

      background: #fff;

      box-shadow: 0 2px 6px rgba(0,0,0,.35);

      transition:
        transform .18s ease,
        background .18s ease;
    }

    /* Включено */
    #risksSourcePanel .risksToggle.on {
      background: rgba(255,255,255,.22);
      border-color: rgba(255,255,255,.14);
    }

    #risksSourcePanel .risksToggle.on::after {
      transform: translateX(20px);
    }

    /* =========================================================
       Светлая тема
       ========================================================= */

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

    body.light #risksSourcePanel .risksToggle.on,
    body[data-theme="light"] #risksSourcePanel .risksToggle.on {
      background: rgba(0,0,0,.18);
    }

    /* =========================================================
       Телефон
       ========================================================= */

    @media (max-width: 480px) {
      #risksSourcePanel {
        width: 150px;
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
        <div
          class="risksToggle on"
          role="switch"
          aria-checked="true"
        ></div>
      </div>
    `;

    document.body.appendChild(panel);

    /* Выбор EMS / CSF */
    panel.querySelectorAll(".riskSource").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();

        currentSource = button.dataset.source;

        panel.querySelectorAll(".riskSource").forEach(btn => {
          btn.classList.toggle(
            "active",
            btn.dataset.source === currentSource
          );
        });

        /*
         * Здесь позже подключается загрузка
         * соответствующих данных EMS / CSF.
         */

        closePanel();
      });
    });

    /* Переключатель включения / выключения */
    const toggle = panel.querySelector(".risksToggle");

    toggle.addEventListener("click", event => {
      event.stopPropagation();

      const enabled = toggle.classList.toggle("on");

      toggle.setAttribute(
        "aria-checked",
        enabled ? "true" : "false"
      );

      /*
       * Здесь позже:
       *
       * enabled === true
       *  → показывать риски
       *
       * enabled === false
       *  → скрывать риски
       */
    });

    return panel;
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

    if (left + panelRect.width > window.innerWidth - 8) {
      left = window.innerWidth - panelRect.width - 8;
    }

    if (left < 8) {
      left = 8;
    }

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
     Открытие
     ========================================================= */

  function openPanel() {
    createPanel();

    panel.classList.add("open");

    positionPanel();

    requestAnimationFrame(positionPanel);
  }

  /* =========================================================
     Закрытие
     ========================================================= */

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
     Кнопка «Предупр.»
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
     Закрытие вместе с главным меню
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
     Адаптация к экрану
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

    setSource(source) {
      createPanel();

      currentSource =
        source === "CSF" ? "CSF" : "EMS";

      panel.querySelectorAll(".riskSource").forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.source === currentSource
        );
      });
    },

    getSource() {
      return currentSource;
    },

    isOpen() {
      return !!panel &&
        panel.classList.contains("open");
    }
  };

})();
