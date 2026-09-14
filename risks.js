(() => {
  "use strict";

  /*
  ============================================================
  CLOrad — RISKS
  Источники:
    EMS — рабочий источник рисков/предупреждений
    CSF — пока заглушка
  ============================================================
  */

  const nav = document.getElementById("nav");

  if (!nav) {
    console.error("[CLOrad Risks] Навигация не найдена");
    return;
  }

  // ==========================================================
  // НАХОДИМ КНОПКУ «ПРЕДУПР.»
  // ==========================================================

  const warningButton = [...nav.querySelectorAll(".n")]
    .find(button =>
      button.textContent.trim().toLowerCase() === "предупр."
    );

  if (!warningButton) {
    console.error("[CLOrad Risks] Кнопка «Предупр.» не найдена");
    return;
  }

  // ==========================================================
  // СОЗДАЁМ ПАНЕЛЬ
  // ==========================================================

  const panel = document.createElement("div");

  panel.id = "risksSourcePanel";
  panel.innerHTML = `
    <button
      type="button"
      class="risksSourceButton active"
      data-source="EMS"
    >
      EMS
    </button>

    <button
      type="button"
      class="risksSourceButton"
      data-source="CSF"
    >
      CSF
    </button>
  `;

  document.body.appendChild(panel);

  // ==========================================================
  // CSS
  // ==========================================================

  const style = document.createElement("style");

  style.textContent = `
    /*
    ------------------------------------------------------------
    ПАНЕЛЬ ИСТОЧНИКОВ РИСКОВ
    ------------------------------------------------------------
    */

    #risksSourcePanel{
      position:fixed;
      z-index:25;

      display:flex;
      align-items:center;

      gap:5px;

      padding:5px;

      width:max-content;
      height:44px;

      background:#182028f7;
      border:1px solid #3d4851;
      border-radius:9px;

      box-shadow:0 5px 16px #0004;

      opacity:0;
      pointer-events:none;

      transform:translateY(-5px);

      transition:
        opacity .20s ease,
        transform .20s ease;
    }

    #risksSourcePanel.open{
      opacity:1;
      pointer-events:auto;
      transform:translateY(0);
    }

    .risksSourceButton{
      height:32px;
      min-width:54px;

      padding:0 12px;

      border:1px solid transparent;
      border-radius:7px;

      background:transparent;
      color:#aeb7bd;

      font-size:13px;
      font-weight:700;

      display:flex;
      align-items:center;
      justify-content:center;

      transition:
        background .16s ease,
        color .16s ease,
        border-color .16s ease;
    }

    .risksSourceButton.active{
      background:#263139;
      border-color:#3e4a53;
      color:#53e39b;
    }

    .risksSourceButton:active{
      transform:scale(.96);
    }

    /*
    ------------------------------------------------------------
    СВЕТЛАЯ ТЕМА
    ------------------------------------------------------------
    */

    body.light #risksSourcePanel{
      background:#f6f8f9ee;
      border-color:#c9d0d5;
      box-shadow:0 5px 16px #0002;
    }

    body.light .risksSourceButton{
      color:#687177;
    }

    body.light .risksSourceButton.active{
      background:#e1e6e9;
      border-color:#c6ced3;
      color:#168453;
    }

    /*
    ------------------------------------------------------------
    МОБИЛЬНЫЕ
    ------------------------------------------------------------
    */

    @media(max-width:600px){
      #risksSourcePanel{
        height:42px;
        padding:4px;
      }

      .risksSourceButton{
        height:32px;
        min-width:52px;
        font-size:13px;
      }
    }
  `;

  document.head.appendChild(style);

  // ==========================================================
  // ПОЗИЦИОНИРОВАНИЕ
  // ==========================================================

  function positionPanel() {
    const rect = warningButton.getBoundingClientRect();

    /*
      Панель находится непосредственно СНИЗУ
      от кнопки «Предупр.».
    */

    const panelWidth = panel.offsetWidth || 120;
    const panelHeight = panel.offsetHeight || 44;

    let left =
      rect.left +
      rect.width / 2 -
      panelWidth / 2;

    /*
      Не даём панели выйти за экран.
    */

    const margin = 8;

    left = Math.max(
      margin,
      Math.min(
        left,
        window.innerWidth -
        panelWidth -
        margin
      )
    );

    let top =
      rect.bottom + 7;

    /*
      Если снизу недостаточно места,
      ставим панель над кнопкой.
      В обычном случае она всегда снизу.
    */

    if (
      top + panelHeight >
      window.innerHeight - 8
    ) {
      top =
        rect.top -
        panelHeight -
        7;
    }

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  // ==========================================================
  // ОТКРЫТИЕ / ЗАКРЫТИЕ
  // ==========================================================

  let opened = false;

  function openPanel() {
    positionPanel();

    panel.classList.add("open");

    opened = true;
  }

  function closePanel() {
    panel.classList.remove("open");

    opened = false;
  }

  function togglePanel() {
    if (opened) {
      closePanel();
    } else {
      openPanel();
    }
  }

  // ==========================================================
  // КНОПКА «ПРЕДУПР.»
  // ==========================================================

  warningButton.addEventListener(
    "click",
    event => {
      event.stopPropagation();

      togglePanel();
    },
    true
  );

  // ==========================================================
  // ВЫБОР ИСТОЧНИКА
  // ==========================================================

  const sourceButtons =
    [...panel.querySelectorAll(".risksSourceButton")];

  let currentSource = "EMS";

  sourceButtons.forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      const source =
        button.dataset.source;

      currentSource = source;

      sourceButtons.forEach(item => {
        item.classList.toggle(
          "active",
          item === button
        );
      });

      /*
        Здесь специально пока НЕТ сообщения
        «данные недоступны» для CSF.

        Позже сюда подключим:
          EMS → реальные риски
          CSF → реальные риски
      */

      if (window.CLOradRisks) {
        window.CLOradRisks.setSource(source);
      }
    });
  });

  // ==========================================================
  // ЗАКРЫТИЕ ПРИ НАЖАТИИ ВНЕ ПАНЕЛИ
  // ==========================================================

  document.addEventListener(
    "click",
    event => {
      if (!opened) return;

      if (
        event.target.closest("#risksSourcePanel") ||
        event.target.closest(".n")
      ) {
        return;
      }

      closePanel();
    }
  );

  // ==========================================================
  // ЕСЛИ NAV ЗАКРЫЛИ — ПАНЕЛЬ ТОЖЕ ЗАКРЫВАЕМ
  // ==========================================================

  /*
    В твоём index.html меню закрывается через:
      nav.classList.toggle("closed")

    Следим за изменением класса.
  */

  const navObserver =
    new MutationObserver(() => {
      if (
        nav.classList.contains("closed")
      ) {
        closePanel();
      }
    });

  navObserver.observe(nav, {
    attributes:true,
    attributeFilter:["class"]
  });

  // ==========================================================
  // ПЕРЕМЕЩЕНИЕ / RESIZE
  // ==========================================================

  window.addEventListener(
    "resize",
    () => {
      if (opened) {
        positionPanel();
      }
    }
  );

  window.addEventListener(
    "orientationchange",
    () => {
      setTimeout(() => {
        if (opened) {
          positionPanel();
        }
      }, 100);
    }
  );

  // ==========================================================
  // ПРИ ПРОКРУТКЕ NAV
  // ==========================================================

  nav.addEventListener(
    "scroll",
    () => {
      if (opened) {
        positionPanel();
      }
    },
    { passive:true }
  );

  // ==========================================================
  // ПУБЛИЧНЫЙ API
  // ==========================================================

  window.CLOradRisks = {

    open() {
      openPanel();
    },

    close() {
      closePanel();
    },

    toggle() {
      togglePanel();
    },

    setSource(source) {
      if (
        source !== "EMS" &&
        source !== "CSF"
      ) {
        return;
      }

      currentSource = source;

      sourceButtons.forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.source === source
        );
      });
    },

    getSource() {
      return currentSource;
    },

    isOpen() {
      return opened;
    }
  };

  console.log(
    "[CLOrad Risks] Загружен"
  );

})();
