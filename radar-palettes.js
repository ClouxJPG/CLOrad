/* =========================================================
   CLOrad — Radar Palette Manager
   РГМЦ / ИРАМ / пользовательские палитры

   Файл:
   radar-palettes.js

   Подключение:
   <script src="gif-radar.js"></script>
   <script src="radar-palettes.js"></script>
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const STORAGE_KEY =
    "CLOrad.customRadarPalettes.v2";

  const COLOR_COUNT = 19;

  /* =======================================================
     СИСТЕМНЫЕ ПАЛИТРЫ
     ======================================================= */

  const RGMC_COLORS = [
    "#b9c1c7",
    "#a9c7f4",
    "#63eda5",
    "#43cf89",
    "#4db84e",
    "#fff89c",
    "#75a6ef",
    "#5279ed",
    "#504a9b",
    "#ffc0a8",
    "#fa82a0",
    "#ff4d4d",
    "#db9248",
    "#ad7544",
    "#924b48",
    "#f2aaf0",
    "#e85ae7",
    "#ca3cc7",
    "#777c91"
  ];

  /*
     ИРАМ оставляем БЕЗ ИЗМЕНЕНИЙ.
  */
  const IRAM_COLORS = [
    "#b9c1c7",
    "#a9a9a9",
    "#00ff00",
    "#00cc00",
    "#009900",
    "#00ffff",
    "#4da6ff",
    "#3366ff",
    "#0000cc",
    "#ff66cc",
    "#ff00ff",
    "#cc0099",
    "#ffff00",
    "#ff9900",
    "#ff0000",
    "#cc99ff",
    "#cc33ff",
    "#9900cc",
    "#000000"
  ];

  /* =======================================================
     STATE
     ======================================================= */

  let customPalettes = [];

  let selectedPaletteId =
    "rgmc";

  let editingPaletteId =
    null;

  /* =======================================================
     HELPERS
     ======================================================= */

  function normalizeColor(value) {
    if (
      typeof value !== "string"
    ) {
      return "#000000";
    }

    let color =
      value.trim();

    if (
      !color.startsWith("#")
    ) {
      color =
        "#" + color;
    }

    if (
      /^#[0-9a-fA-F]{6}$/.test(
        color
      )
    ) {
      return color.toLowerCase();
    }

    if (
      /^#[0-9a-fA-F]{3}$/.test(
        color
      )
    ) {
      return (
        "#" +
        color
          .slice(1)
          .split("")
          .map(
            char =>
              char + char
          )
          .join("")
          .toLowerCase()
      );
    }

    return "#000000";
  }

  function cloneColors(colors) {
    return Array.from(
      {
        length:
          COLOR_COUNT
      },
      (_, index) =>
        normalizeColor(
          colors?.[index] ||
            "#000000"
        )
    );
  }

  function makeId() {
    return (
      "custom_" +
      Date.now() +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 8)
    );
  }

  function escapeHTML(value) {
    return String(value)
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#039;"
      );
  }

  /* =======================================================
     STORAGE
     ======================================================= */

  function loadCustomPalettes() {
    try {
      const raw =
        localStorage.getItem(
          STORAGE_KEY
        );

      if (!raw) {
        customPalettes = [];
        return;
      }

      const parsed =
        JSON.parse(raw);

      if (
        !Array.isArray(
          parsed
        )
      ) {
        customPalettes = [];
        return;
      }

      customPalettes =
        parsed
          .filter(
            palette =>
              palette &&
              typeof palette.id ===
                "string"
          )
          .map(
            palette => ({
              id:
                palette.id,

              name:
                typeof palette.name ===
                  "string"
                  ? palette.name
                  : "Пользовательская",

              colors:
                cloneColors(
                  palette.colors
                )
            })
          );

    } catch (error) {
      console.error(
        "CLOrad palettes:",
        error
      );

      customPalettes = [];
    }
  }

  function saveCustomPalettes() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          customPalettes
        )
      );
    } catch (error) {
      console.error(
        "CLOrad palettes storage:",
        error
      );
    }
  }

  /* =======================================================
     PALETTE DATA
     ======================================================= */

  function getSystemPalette(
    id
  ) {
    if (
      id === "rgmc"
    ) {
      return {
        id:
          "rgmc",

        name:
          "РГМЦ",

        system:
          true,

        colors:
          RGMC_COLORS.slice()
      };
    }

    if (
      id === "iram"
    ) {
      return {
        id:
          "iram",

        name:
          "ИРАМ",

        system:
          true,

        colors:
          IRAM_COLORS.slice()
      };
    }

    return null;
  }

  function getPalette(id) {
    const system =
      getSystemPalette(
        id
      );

    if (system) {
      return system;
    }

    return (
      customPalettes.find(
        palette =>
          palette.id === id
      ) ||
      null
    );
  }

  function getAllPalettes() {
    return [
      getSystemPalette(
        "rgmc"
      ),

      getSystemPalette(
        "iram"
      ),

      ...customPalettes
    ];
  }

  /* =======================================================
     APPLY TO RADAR
     ======================================================= */

  function applyPalette(
    palette
  ) {
    if (!palette) {
      return false;
    }

    selectedPaletteId =
      palette.id;

    /*
       ВАЖНО.

       Системные палитры используют
       свои ID:

       rgmc
       iram

       А ЛЮБАЯ пользовательская
       палитра должна передаваться
       в gif-radar.js именно как:

       custom

       Её настоящий ID нужен только
       менеджеру для хранения/редактирования.
    */

    const radarPaletteId =
      palette.system
        ? palette.id
        : "custom";

    if (
      typeof window.CLOradApplyPalette ===
      "function"
    ) {
      const result =
        window.CLOradApplyPalette(
          radarPaletteId,
          palette.colors.slice(),
          palette.name
        );

      updateManager();

      return result !== false;
    }

    /* =====================================================
       СОВМЕСТИМОСТЬ СО СТАРОЙ СИСТЕМОЙ
       ===================================================== */

    if (
      palette.id === "rgmc" ||
      palette.id === "iram"
    ) {
      if (
        typeof window.CLOradSetGIFPalette ===
        "function"
      ) {
        window.CLOradSetGIFPalette(
          palette.id
        );

        updateManager();

        return true;
      }
    }

    /*
       Старый API кастомной палитры.
    */
    if (
      !palette.system &&
      typeof window.CLOradSetCustomGIFPalette ===
        "function"
    ) {
      window.CLOradSetCustomGIFPalette(
        palette.colors.slice(),
        palette.name
      );

      updateManager();

      return true;
    }

    console.warn(
      "CLOrad: API палитры ещё не подключён."
    );

    return false;
  }

  /* =======================================================
     CREATE NEW
     ======================================================= */

  function createPalette() {
    const palette = {
      id:
        makeId(),

      name:
        "Новая палитра",

      colors:
        RGMC_COLORS.slice()
    };

    customPalettes.push(
      palette
    );

    saveCustomPalettes();

    editingPaletteId =
      palette.id;

    selectedPaletteId =
      palette.id;

    renderEditor();

    setTimeout(
      () => {
        const name =
          document.getElementById(
            "cloradPaletteName"
          );

        if (name) {
          name.focus();
          name.select();
        }
      },
      50
    );
  }

  /* =======================================================
     DELETE
     ======================================================= */

  function deletePalette(
    id
  ) {
    /*
       Системные палитры удалить
       невозможно.
    */

    if (
      id === "rgmc" ||
      id === "iram"
    ) {
      return;
    }

    const palette =
      getPalette(id);

    if (!palette) {
      return;
    }

    customPalettes =
      customPalettes.filter(
        item =>
          item.id !== id
      );

    saveCustomPalettes();

    if (
      selectedPaletteId ===
      id
    ) {
      selectedPaletteId =
        "rgmc";

      applyPalette(
        getSystemPalette(
          "rgmc"
        )
      );
    }

    if (
      editingPaletteId ===
      id
    ) {
      editingPaletteId =
        null;
    }

    renderManager();
  }

  /* =======================================================
     EDIT
     ======================================================= */

  function editPalette(
    id
  ) {
    const palette =
      getPalette(id);

    if (!palette) {
      return;
    }

    editingPaletteId =
      id;

    renderEditor();
  }

  /* =======================================================
     SAVE EDIT
     ======================================================= */

  function saveEditor() {
    if (
      !editingPaletteId
    ) {
      return;
    }

    const palette =
      getPalette(
        editingPaletteId
      );

    if (
      !palette ||
      palette.system
    ) {
      return;
    }

    const nameInput =
      document.getElementById(
        "cloradPaletteName"
      );

    const name =
      nameInput
        ? nameInput.value.trim()
        : "";

    const colors = [];

    for (
      let i = 0;
      i < COLOR_COUNT;
      i++
    ) {
      const input =
        document.getElementById(
          "cloradColor_" +
          i
        );

      colors.push(
        normalizeColor(
          input
            ? input.value
            : "#000000"
        )
      );
    }

    palette.name =
      name ||
      "Пользовательская";

    palette.colors =
      colors;

    saveCustomPalettes();

    selectedPaletteId =
      palette.id;

    /*
       Здесь palette.id может быть
       custom_XXXXXXXX.

       applyPalette() сам преобразует
       его в "custom" для radar API.
    */
    applyPalette(
      palette
    );

    renderManager();
  }

  /* =======================================================
     COLOR CHANGE
     ======================================================= */

  function syncColorInput(
    index,
    value
  ) {
    const color =
      normalizeColor(
        value
      );

    const picker =
      document.getElementById(
        "cloradColorPicker_" +
        index
      );

    const text =
      document.getElementById(
        "cloradColor_" +
        index
      );

    const preview =
      document.getElementById(
        "cloradColorPreview_" +
        index
      );

    if (picker) {
      picker.value =
        color;
    }

    if (text) {
      text.value =
        color;
    }

    if (preview) {
      preview.style.background =
        color;
    }
  }

  /* =======================================================
     RESET EDITOR
     ======================================================= */

  function resetEditor() {
    if (
      !editingPaletteId
    ) {
      return;
    }

    const palette =
      getPalette(
        editingPaletteId
      );

    if (
      !palette ||
      palette.system
    ) {
      return;
    }

    palette.colors =
      RGMC_COLORS.slice();

    saveCustomPalettes();

    renderEditor();
  }

  /* =======================================================
     CSS
     ======================================================= */

  function installStyle() {
    if (
      document.getElementById(
        "clorad-palette-manager-style"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "clorad-palette-manager-style";

    style.textContent = `
      #cloradPaletteManagerButton {
        width: 100%;
        margin-top: 8px;
        min-height: 42px;
        padding: 0 14px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 10px;
        background: rgba(255,255,255,.055);
        color: rgba(255,255,255,.82);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background .15s ease,
          border-color .15s ease,
          transform .12s ease;
        -webkit-tap-highlight-color: transparent;
      }

      #cloradPaletteManagerButton:hover {
        background: rgba(255,255,255,.09);
        border-color: rgba(255,255,255,.20);
      }

      #cloradPaletteManagerButton:active {
        transform: scale(.98);
      }

      #cloradPaletteOverlay {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(0,0,0,.58);
        backdrop-filter: blur(7px);
        -webkit-backdrop-filter: blur(7px);
      }

      #cloradPaletteOverlay.open {
        display: flex;
      }

      #cloradPaletteManager {
        width: min(520px, calc(100vw - 24px));
        max-height: calc(100vh - 32px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 18px;
        background:
          linear-gradient(
            180deg,
            rgba(31,34,39,.98),
            rgba(20,22,26,.98)
          );
        box-shadow:
          0 24px 70px rgba(0,0,0,.48);
        color: #fff;
      }

      #cloradPaletteHeader {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 18px 19px;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }

      #cloradPaletteTitle {
        font-size: 17px;
        font-weight: 700;
      }

      #cloradPaletteClose {
        width: 34px;
        height: 34px;
        border: 0;
        border-radius: 9px;
        background: rgba(255,255,255,.07);
        color: rgba(255,255,255,.75);
        font-size: 21px;
        line-height: 1;
        cursor: pointer;
      }

      #cloradPaletteContent {
        min-height: 0;
        overflow-y: auto;
        padding: 17px;
      }

      .clorad-palette-section-title {
        margin: 0 0 9px;
        color: rgba(255,255,255,.54);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      .clorad-palette-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
      }

      .clorad-palette-item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 55px;
        padding: 8px 9px;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 11px;
        background: rgba(255,255,255,.045);
      }

      .clorad-palette-item.active {
        border-color: rgba(110,190,145,.55);
        background: rgba(110,190,145,.09);
      }

      .clorad-palette-info {
        flex: 1;
        min-width: 0;
        cursor: pointer;
      }

      .clorad-palette-name {
        margin-bottom: 6px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 650;
      }

      .clorad-palette-type {
        color: rgba(255,255,255,.42);
        font-size: 10px;
      }

      .clorad-palette-preview {
        display: grid;
        grid-template-columns: repeat(19, 1fr);
        width: 100%;
        height: 13px;
        overflow: hidden;
        border-radius: 4px;
      }

      .clorad-palette-preview span {
        min-width: 0;
      }

      .clorad-palette-action {
        flex: 0 0 auto;
        height: 34px;
        padding: 0 10px;
        border: 1px solid rgba(255,255,255,.09);
        border-radius: 8px;
        background: rgba(255,255,255,.055);
        color: rgba(255,255,255,.78);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }

      .clorad-palette-action.delete {
        color: #ff9b9b;
      }

      #cloradPaletteNew {
        width: 100%;
        min-height: 43px;
        border: 1px dashed rgba(255,255,255,.18);
        border-radius: 10px;
        background: rgba(255,255,255,.035);
        color: rgba(255,255,255,.78);
        font-size: 13px;
        font-weight: 650;
        cursor: pointer;
      }

      .clorad-editor-name {
        width: 100%;
        height: 43px;
        box-sizing: border-box;
        margin-bottom: 14px;
        padding: 0 12px;
        border: 1px solid rgba(255,255,255,.11);
        border-radius: 10px;
        outline: none;
        background: rgba(255,255,255,.055);
        color: #fff;
        font-size: 13px;
      }

      .clorad-editor-name:focus {
        border-color: rgba(110,190,145,.55);
      }

      .clorad-color-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 9px;
      }

      .clorad-color-card {
        min-width: 0;
        padding: 9px;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 10px;
        background: rgba(255,255,255,.035);
      }

      .clorad-color-number {
        margin-bottom: 7px;
        color: rgba(255,255,255,.42);
        font-size: 10px;
        font-weight: 600;
      }

      .clorad-color-preview {
        width: 100%;
        height: 28px;
        margin-bottom: 7px;
        border-radius: 6px;
        box-shadow:
          inset 0 0 0 1px rgba(255,255,255,.10);
      }

      .clorad-color-row {
        display: flex;
        gap: 5px;
      }

      .clorad-color-picker {
        width: 32px;
        height: 32px;
        flex: 0 0 32px;
        padding: 2px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 6px;
        background: transparent;
        cursor: pointer;
      }

      .clorad-color-text {
        min-width: 0;
        width: 100%;
        height: 32px;
        box-sizing: border-box;
        padding: 0 7px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 6px;
        outline: none;
        background: rgba(255,255,255,.045);
        color: rgba(255,255,255,.82);
        font-family: monospace;
        font-size: 10px;
      }

      .clorad-editor-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
      }

      .clorad-editor-button {
        flex: 1;
        min-height: 43px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 10px;
        background: rgba(255,255,255,.055);
        color: rgba(255,255,255,.82);
        font-size: 12px;
        font-weight: 650;
        cursor: pointer;
      }

      .clorad-editor-button.primary {
        border-color: rgba(110,190,145,.42);
        background: rgba(110,190,145,.18);
        color: #fff;
      }

      .clorad-editor-button:active,
      .clorad-palette-action:active,
      #cloradPaletteNew:active {
        transform: scale(.98);
      }

      body.light #cloradPaletteOverlay {
        background: rgba(0,0,0,.35);
      }

      body.light #cloradPaletteManager {
        background: #f4f5f7;
        color: #111;
        border-color: rgba(0,0,0,.10);
      }

      body.light #cloradPaletteHeader {
        border-color: rgba(0,0,0,.08);
      }

      body.light .clorad-palette-section-title,
      body.light .clorad-palette-type,
      body.light .clorad-color-number {
        color: rgba(0,0,0,.48);
      }

      body.light .clorad-palette-item,
      body.light .clorad-color-card {
        border-color: rgba(0,0,0,.08);
        background: rgba(0,0,0,.035);
      }

      body.light .clorad-palette-item.active {
        border-color: rgba(60,150,100,.45);
        background: rgba(60,150,100,.08);
      }

      body.light .clorad-palette-action,
      body.light #cloradPaletteClose,
      body.light #cloradPaletteNew,
      body.light .clorad-editor-button,
      body.light .clorad-editor-name,
      body.light .clorad-color-text {
        border-color: rgba(0,0,0,.10);
        background: rgba(0,0,0,.045);
        color: #222;
      }

      @media (max-width: 520px) {
        #cloradPaletteOverlay {
          padding: 8px;
        }

        #cloradPaletteManager {
          width: calc(100vw - 16px);
          max-height: calc(100vh - 16px);
          border-radius: 15px;
        }

        #cloradPaletteContent {
          padding: 13px;
        }

        .clorad-color-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     MANAGER BUTTON
     ======================================================= */

  function installManagerButton() {
    if (
      document.getElementById(
        "cloradPaletteManagerButton"
      )
    ) {
      return;
    }

    const buttons =
      Array.from(
        document.querySelectorAll(
          "button"
        )
      );

    const rgmc =
      buttons.find(
        button =>
          button.textContent.trim() ===
          "РГМЦ"
      );

    const iram =
      buttons.find(
        button =>
          button.textContent.trim() ===
          "ИРАМ"
      );

    if (
      !rgmc &&
      !iram
    ) {
      return;
    }

    const button =
      document.createElement(
        "button"
      );

    button.id =
      "cloradPaletteManagerButton";

    button.type =
      "button";

    button.textContent =
      "Настроить палитры";

    button.addEventListener(
      "click",
      event => {
        event.stopPropagation();
        openManager();
      }
    );

    const anchor =
      iram ||
      rgmc;

    const parent =
      anchor.parentElement;

    if (
      parent
    ) {
      parent.appendChild(
        button
      );
    } else {
      button.style.position =
        "fixed";

      button.style.left =
        "20px";

      button.style.bottom =
        "80px";

      document.body.appendChild(
        button
      );
    }
  }

  /* =======================================================
     OVERLAY
     ======================================================= */

  function createOverlay() {
    if (
      document.getElementById(
        "cloradPaletteOverlay"
      )
    ) {
      return;
    }

    const overlay =
      document.createElement(
        "div"
      );

    overlay.id =
      "cloradPaletteOverlay";

    overlay.innerHTML = `
      <div
        id="cloradPaletteManager"
        role="dialog"
        aria-modal="true"
      >
        <div id="cloradPaletteHeader">
          <div id="cloradPaletteTitle">
            Палитры радара
          </div>

          <button
            id="cloradPaletteClose"
            type="button"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div id="cloradPaletteContent"></div>
      </div>
    `;

    document.body.appendChild(
      overlay
    );

    overlay.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          overlay
        ) {
          closeManager();
        }
      }
    );

    document
      .getElementById(
        "cloradPaletteClose"
      )
      ?.addEventListener(
        "click",
        closeManager
      );
  }

  /* =======================================================
     OPEN / CLOSE
     ======================================================= */

  function openManager() {
    createOverlay();

    renderManager();

    document
      .getElementById(
        "cloradPaletteOverlay"
      )
      ?.classList.add(
        "open"
      );
  }

  function closeManager() {
    document
      .getElementById(
        "cloradPaletteOverlay"
      )
      ?.classList.remove(
        "open"
      );

    editingPaletteId =
      null;
  }

  /* =======================================================
     PREVIEW
     ======================================================= */

  function makePreview(
    colors
  ) {
    return `
      <div class="clorad-palette-preview">
        ${cloneColors(colors)
          .map(
            color =>
              `<span style="background:${color}"></span>`
          )
          .join("")}
      </div>
    `;
  }

  /* =======================================================
     MANAGER
     ======================================================= */

  function renderManager() {
    const content =
      document.getElementById(
        "cloradPaletteContent"
      );

    if (!content) {
      return;
    }

    const all =
      getAllPalettes();

    content.innerHTML = `
      <div class="clorad-palette-section-title">
        Системные
      </div>

      <div class="clorad-palette-list">
        ${all
          .filter(
            palette =>
              palette.system
          )
          .map(
            palette =>
              `
                <div
                  class="
                    clorad-palette-item
                    ${
                      selectedPaletteId ===
                      palette.id
                        ? "active"
                        : ""
                    }
                  "
                  data-palette-id="${
                    palette.id
                  }"
                >
                  <div
                    class="clorad-palette-info"
                    data-action="apply"
                  >
                    <div class="clorad-palette-name">
                      ${escapeHTML(
                        palette.name
                      )}
                    </div>

                    <div class="clorad-palette-type">
                      Системная
                    </div>

                    ${makePreview(
                      palette.colors
                    )}
                  </div>

                  <button
                    class="clorad-palette-action"
                    type="button"
                    data-action="apply"
                  >
                    Выбрать
                  </button>
                </div>
              `
          )
          .join("")}
      </div>

      <div class="clorad-palette-section-title">
        Мои палитры
      </div>

      <div class="clorad-palette-list">
        ${
          customPalettes.length
            ? customPalettes
                .map(
                  palette =>
                    `
                      <div
                        class="
                          clorad-palette-item
                          ${
                            selectedPaletteId ===
                            palette.id
                              ? "active"
                              : ""
                          }
                        "
                        data-palette-id="${
                          palette.id
                        }"
                      >
                        <div
                          class="clorad-palette-info"
                          data-action="apply"
                        >
                          <div class="clorad-palette-name">
                            ${escapeHTML(
                              palette.name
                            )}
                          </div>

                          <div class="clorad-palette-type">
                            Пользовательская
                          </div>

                          ${makePreview(
                            palette.colors
                          )}
                        </div>

                        <button
                          class="clorad-palette-action"
                          type="button"
                          data-action="edit"
                        >
                          Изменить
                        </button>

                        <button
                          class="
                            clorad-palette-action
                            delete
                          "
                          type="button"
                          data-action="delete"
                        >
                          Удалить
                        </button>
                      </div>
                    `
                )
                .join("")
            : `
              <div
                style="
                  padding: 12px 2px 15px;
                  color: rgba(255,255,255,.42);
                  font-size: 12px;
                "
              >
                Пользовательских палитр пока нет.
              </div>
            `
        }
      </div>

      <button
        id="cloradPaletteNew"
        type="button"
      >
        + Создать новую палитру
      </button>
    `;

    content
      .querySelectorAll(
        ".clorad-palette-item"
      )
      .forEach(
        item => {
          const id =
            item.dataset.paletteId;

          item
            .querySelectorAll(
              "[data-action]"
            )
            .forEach(
              element => {
                element.addEventListener(
                  "click",
                  event => {
                    event.stopPropagation();

                    const action =
                      element.dataset.action;

                    if (
                      action ===
                      "apply"
                    ) {
                      applyPalette(
                        getPalette(
                          id
                        )
                      );
                    }

                    if (
                      action ===
                      "edit"
                    ) {
                      editPalette(
                        id
                      );
                    }

                    if (
                      action ===
                      "delete"
                    ) {
                      deletePalette(
                        id
                      );
                    }
                  }
                );
              }
            );
        }
      );

    document
      .getElementById(
        "cloradPaletteNew"
      )
      ?.addEventListener(
        "click",
        createPalette
      );
  }

  /* =======================================================
     EDITOR
     ======================================================= */

  function renderEditor() {
    const content =
      document.getElementById(
        "cloradPaletteContent"
      );

    if (!content) {
      return;
    }

    const palette =
      getPalette(
        editingPaletteId
      );

    if (
      !palette ||
      palette.system
    ) {
      editingPaletteId =
        null;

      renderManager();

      return;
    }

    content.innerHTML = `
      <div
        class="clorad-palette-section-title"
      >
        Редактирование
      </div>

      <input
        id="cloradPaletteName"
        class="clorad-editor-name"
        type="text"
        maxlength="40"
        value="${escapeHTML(
          palette.name
        )}"
        placeholder="Название палитры"
      >

      <div
        class="clorad-color-grid"
      >
        ${palette.colors
          .map(
            (color, index) =>
              `
                <div
                  class="clorad-color-card"
                >
                  <div
                    class="clorad-color-number"
                  >
                    Цвет ${index + 1}
                  </div>

                  <div
                    id="cloradColorPreview_${index}"
                    class="clorad-color-preview"
                    style="background:${color}"
                  ></div>

                  <div
                    class="clorad-color-row"
                  >
                    <input
                      id="cloradColorPicker_${index}"
                      class="clorad-color-picker"
                      type="color"
                      value="${color}"
                      data-index="${index}"
                    >

                    <input
                      id="cloradColor_${index}"
                      class="clorad-color-text"
                      type="text"
                      value="${color}"
                      maxlength="7"
                      data-index="${index}"
                      spellcheck="false"
                    >
                  </div>
                </div>
              `
          )
          .join("")}
      </div>

      <div
        class="clorad-editor-actions"
      >
        <button
          id="cloradEditorBack"
          class="clorad-editor-button"
          type="button"
        >
          Назад
        </button>

        <button
          id="cloradEditorReset"
          class="clorad-editor-button"
          type="button"
        >
          Сбросить
        </button>

        <button
          id="cloradEditorSave"
          class="
            clorad-editor-button
            primary
          "
          type="button"
        >
          Сохранить
        </button>
      </div>
    `;

    document
      .querySelectorAll(
        ".clorad-color-picker"
      )
      .forEach(
        input => {
          input.addEventListener(
            "input",
            () => {
              syncColorInput(
                Number(
                  input.dataset.index
                ),
                input.value
              );
            }
          );
        }
      );

    document
      .querySelectorAll(
        ".clorad-color-text"
      )
      .forEach(
        input => {
          input.addEventListener(
            "change",
            () => {
              syncColorInput(
                Number(
                  input.dataset.index
                ),
                input.value
              );
            }
          );

          input.addEventListener(
            "keydown",
            event => {
              if (
                event.key ===
                "Enter"
              ) {
                syncColorInput(
                  Number(
                    input.dataset.index
                  ),
                  input.value
                );

                input.blur();
              }
            }
          );
        }
      );

    document
      .getElementById(
        "cloradEditorBack"
      )
      ?.addEventListener(
        "click",
        () => {
          editingPaletteId =
            null;

          renderManager();
        }
      );

    document
      .getElementById(
        "cloradEditorReset"
      )
      ?.addEventListener(
        "click",
        resetEditor
      );

    document
      .getElementById(
        "cloradEditorSave"
      )
      ?.addEventListener(
        "click",
        saveEditor
      );
  }

  /* =======================================================
     UPDATE
     ======================================================= */

  function updateManager() {
    const overlay =
      document.getElementById(
        "cloradPaletteOverlay"
      );

    if (
      !overlay ||
      !overlay.classList.contains(
        "open"
      )
    ) {
      return;
    }

    if (
      editingPaletteId
    ) {
      renderEditor();
    } else {
      renderManager();
    }
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradPalettes = {
    getAll:
      () =>
        getAllPalettes().map(
          palette => ({
            ...palette,

            colors:
              palette.colors.slice()
          })
        ),

    get:
      id => {
        const palette =
          getPalette(id);

        if (!palette) {
          return null;
        }

        return {
          ...palette,

          colors:
            palette.colors.slice()
        };
      },

    apply:
      id =>
        applyPalette(
          getPalette(id)
        ),

    open:
      openManager,

    close:
      closeManager
  };

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    loadCustomPalettes();

    installStyle();

    createOverlay();

    installManagerButton();

    /*
       Если настройки gif-radar.js
       создаются позже — пробуем ещё раз.
    */

    const observer =
      new MutationObserver(
        () => {
          installManagerButton();
        }
      );

    if (
      document.body
    ) {
      observer.observe(
        document.body,
        {
          childList:
            true,

          subtree:
            true
        }
      );
    }

    setTimeout(
      () => {
        installManagerButton();
      },
      500
    );

    setTimeout(
      () => {
        installManagerButton();
      },
      1500
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once:
          true
      }
    );
  } else {
    init();
  }

})();
