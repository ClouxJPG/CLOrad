/* =========================================================
   CLOrad — Radar Palettes Manager
   =========================================================

   Системные палитры:
   - РГМЦ
   - ИРАМ

   Системные палитры нельзя удалить.

   Пользовательские палитры:
   - создание
   - изменение
   - переименование
   - дублирование
   - сохранение
   - удаление

   Хранение:
   localStorage

   Требуется:
   gif-radar.js должен быть загружен ДО этого файла.
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const STORAGE_KEY =
    "CLOrad_radar_palettes_v1";

  const COLOR_COUNT = 19;

  /* =======================================================
     СИСТЕМНАЯ ПАЛИТРА РГМЦ
     ======================================================= */

  const RGMC_PALETTE = [
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
     СИСТЕМНАЯ ПАЛИТРА ИРАМ
     ======================================================= */

  const IRAM_PALETTE = [
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
     СИСТЕМНЫЕ ПАЛИТРЫ
     ======================================================= */

  const SYSTEM_PALETTES = [
    {
      id: "rgmc",
      name: "РГМЦ",
      locked: true,
      colors: RGMC_PALETTE.slice()
    },

    {
      id: "iram",
      name: "ИРАМ",
      locked: true,
      colors: IRAM_PALETTE.slice()
    }
  ];

  /* =======================================================
     STATE
     ======================================================= */

  let palettes = [];

  let activePaletteId =
    "rgmc";

  let editorPaletteId =
    null;

  /* =======================================================
     HELPERS
     ======================================================= */

  function cloneColors(colors) {
    return Array.isArray(colors)
      ? colors.slice(0, COLOR_COUNT)
      : [];
  }

  function normalizeColor(
    color,
    fallback
  ) {
    if (
      typeof color !== "string"
    ) {
      return fallback;
    }

    let value =
      color.trim();

    if (!value) {
      return fallback;
    }

    if (
      !value.startsWith("#")
    ) {
      value =
        "#" + value;
    }

    if (
      /^#[0-9a-fA-F]{6}$/.test(
        value
      )
    ) {
      return value.toLowerCase();
    }

    if (
      /^#[0-9a-fA-F]{3}$/.test(
        value
      )
    ) {
      return (
        "#" +
        value[1] +
        value[1] +
        value[2] +
        value[2] +
        value[3] +
        value[3]
      ).toLowerCase();
    }

    return fallback;
  }

  function normalizeColors(
    colors,
    fallback
  ) {
    const result = [];

    for (
      let i = 0;
      i < COLOR_COUNT;
      i++
    ) {
      result.push(
        normalizeColor(
          colors?.[i],
          fallback?.[i] ||
            "#000000"
        )
      );
    }

    return result;
  }

  function makeId() {
    return (
      "custom-" +
      Date.now().toString(36) +
      "-" +
      Math.random()
        .toString(36)
        .slice(2, 8)
    );
  }

  function getSystemPalette(id) {
    return (
      SYSTEM_PALETTES.find(
        palette =>
          palette.id === id
      ) || null
    );
  }

  function getPalette(id) {
    return (
      palettes.find(
        palette =>
          palette.id === id
      ) || null
    );
  }

  function getActivePalette() {
    return getPalette(
      activePaletteId
    );
  }

  /* =======================================================
     STORAGE
     ======================================================= */

  function saveStorage() {
    try {
      const custom =
        palettes
          .filter(
            palette =>
              !palette.locked
          )
          .map(palette => ({
            id: palette.id,
            name: palette.name,
            locked: false,
            colors:
              cloneColors(
                palette.colors
              )
          }));

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          activePaletteId,
          palettes: custom
        })
      );
    } catch (error) {
      console.warn(
        "CLOrad: не удалось сохранить палитры:",
        error
      );
    }
  }

  function loadStorage() {
    palettes =
      SYSTEM_PALETTES.map(
        palette => ({
          id: palette.id,
          name: palette.name,
          locked: true,
          colors:
            palette.colors.slice()
        })
      );

    try {
      const raw =
        localStorage.getItem(
          STORAGE_KEY
        );

      if (!raw) {
        activePaletteId =
          "rgmc";

        return;
      }

      const data =
        JSON.parse(raw);

      if (
        Array.isArray(
          data.palettes
        )
      ) {
        for (
          const item of
            data.palettes
        ) {
          if (
            !item ||
            !item.id
          ) {
            continue;
          }

          if (
            item.id ===
              "rgmc" ||
            item.id ===
              "iram"
          ) {
            continue;
          }

          palettes.push({
            id: String(
              item.id
            ),

            name:
              typeof item.name ===
                "string" &&
              item.name.trim()
                ? item.name.trim()
                : "Моя палитра",

            locked: false,

            colors:
              normalizeColors(
                item.colors,
                RGMC_PALETTE
              )
          });
        }
      }

      if (
        typeof data.activePaletteId ===
          "string" &&
        getPalette(
          data.activePaletteId
        )
      ) {
        activePaletteId =
          data.activePaletteId;
      } else {
        activePaletteId =
          "rgmc";
      }
    } catch (error) {
      console.warn(
        "CLOrad: ошибка загрузки палитр:",
        error
      );

      activePaletteId =
        "rgmc";
    }
  }

  /* =======================================================
     RADAR API
     ======================================================= */

  function applyToRadar(
    palette
  ) {
    if (!palette) {
      return false;
    }

    if (
      typeof window
        .CLOradSetCustomGIFPalette ===
      "function"
    ) {
      try {
        const result =
          window.CLOradSetCustomGIFPalette(
            palette.colors.slice(),
            palette.id,
            palette.name
          );

        if (
          result !== false
        ) {
          updateLegend(
            palette.colors
          );

          return true;
        }
      } catch (error) {
        console.warn(
          "CLOrad: ошибка применения палитры:",
          error
        );
      }
    }

    if (
      typeof window
        .CLOradSetGIFPaletteColors ===
      "function"
    ) {
      try {
        window.CLOradSetGIFPaletteColors(
          palette.colors.slice()
        );

        updateLegend(
          palette.colors
        );

        return true;
      } catch (error) {
        console.warn(
          "CLOrad: ошибка CLOradSetGIFPaletteColors:",
          error
        );
      }
    }

    updateLegend(
      palette.colors
    );

    return false;
  }

  /* =======================================================
     LEGEND
     ======================================================= */

  function updateLegend(
    colors
  ) {
    if (
      !Array.isArray(colors)
    ) {
      return;
    }

    for (
      let i = 0;
      i < COLOR_COUNT;
      i++
    ) {
      const color =
        colors[i];

      const elements =
        document.querySelectorAll(
          ".l" + (i + 1)
        );

      elements.forEach(
        element => {
          element.style.background =
            color;

          element.style.backgroundColor =
            color;
        }
      );
    }
  }

  /* =======================================================
     ACTIVATE
     ======================================================= */

  function activatePalette(
    id
  ) {
    const palette =
      getPalette(id);

    if (!palette) {
      return;
    }

    activePaletteId =
      palette.id;

    saveStorage();

    applyToRadar(
      palette
    );

    render();

    window.dispatchEvent(
      new CustomEvent(
        "CLOradPaletteChanged",
        {
          detail: {
            id: palette.id,
            name: palette.name,
            colors:
              palette.colors.slice()
          }
        }
      )
    );
  }

  /* =======================================================
     CREATE
     ======================================================= */

  function createPalette() {
    const source =
      getActivePalette() ||
      getPalette("rgmc");

    const palette = {
      id: makeId(),

      name:
        "Новая палитра",

      locked: false,

      colors:
        cloneColors(
          source?.colors ||
            RGMC_PALETTE
        )
    };

    palettes.push(
      palette
    );

    activePaletteId =
      palette.id;

    saveStorage();

    openEditor(
      palette.id
    );
  }

  /* =======================================================
     DUPLICATE
     ======================================================= */

  function duplicatePalette(
    id
  ) {
    const source =
      getPalette(id);

    if (!source) {
      return;
    }

    const copy = {
      id: makeId(),

      name:
        source.name +
        " — копия",

      locked: false,

      colors:
        cloneColors(
          source.colors
        )
    };

    palettes.push(
      copy
    );

    activePaletteId =
      copy.id;

    saveStorage();

    render();

    openEditor(
      copy.id
    );
  }

  /* =======================================================
     RENAME
     ======================================================= */

  function renamePalette(
    id
  ) {
    const palette =
      getPalette(id);

    if (
      !palette ||
      palette.locked
    ) {
      return;
    }

    const newName =
      window.prompt(
        "Название палитры:",
        palette.name
      );

    if (
      newName === null
    ) {
      return;
    }

    const name =
      newName.trim();

    if (!name) {
      return;
    }

    palette.name =
      name;

    saveStorage();

    render();

    if (
      editorPaletteId ===
      id
    ) {
      renderEditor();
    }
  }

  /* =======================================================
     DELETE
     ======================================================= */

  function deletePalette(
    id
  ) {
    const palette =
      getPalette(id);

    if (!palette) {
      return;
    }

    if (palette.locked) {
      return;
    }

    const confirmed =
      window.confirm(
        'Удалить палитру "' +
          palette.name +
          '"?'
      );

    if (!confirmed) {
      return;
    }

    palettes =
      palettes.filter(
        item =>
          item.id !== id
      );

    if (
      activePaletteId ===
      id
    ) {
      activePaletteId =
        "rgmc";

      const rgmc =
        getPalette("rgmc");

      if (rgmc) {
        applyToRadar(
          rgmc
        );
      }
    }

    if (
      editorPaletteId ===
      id
    ) {
      editorPaletteId =
        null;
    }

    saveStorage();

    render();
  }

  /* =======================================================
     RESET
     ======================================================= */

  function resetPalette(
    id
  ) {
    const palette =
      getPalette(id);

    if (
      !palette ||
      palette.locked
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "Вернуть исходные цвета этой пользовательской палитры?"
      );

    if (!confirmed) {
      return;
    }

    const base =
      getPalette("rgmc");

    if (base) {
      palette.colors =
        base.colors.slice();
    }

    saveStorage();

    if (
      activePaletteId ===
      palette.id
    ) {
      applyToRadar(
        palette
      );
    }

    render();
  }

  /* =======================================================
     EDITOR
     ======================================================= */

  function openEditor(
    id
  ) {
    const palette =
      getPalette(id);

    if (!palette) {
      return;
    }

    if (palette.locked) {
      return;
    }

    editorPaletteId =
      id;

    render();

    setTimeout(() => {
      renderEditor();

      const editor =
        document.getElementById(
          "cloradPaletteEditor"
        );

      if (editor) {
        editor.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      }
    }, 0);
  }

  function closeEditor() {
    editorPaletteId =
      null;

    render();
  }

  function changeColor(
    index,
    value
  ) {
    const palette =
      getPalette(
        editorPaletteId
      );

    if (!palette) {
      return;
    }

    if (palette.locked) {
      return;
    }

    const fallback =
      palette.colors[index] ||
      "#000000";

    const color =
      normalizeColor(
        value,
        fallback
      );

    palette.colors[
      index
    ] = color;

    saveStorage();

    if (
      activePaletteId ===
      palette.id
    ) {
      applyToRadar(
        palette
      );
    }

    render();
  }

  /* =======================================================
     STYLES
     ======================================================= */

  function ensureStyles() {
    if (
      document.getElementById(
        "cloradPaletteStyles"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "cloradPaletteStyles";

    style.textContent = `

      /* ================================================
         КНОПКА ПОД РГМЦ / ИРАМ
         ================================================ */

      #cloradPaletteManagerButton {
        width: 100%;
        min-height: 34px;
        margin-top: 7px;
        padding: 7px 10px;

        border: 1px solid
          rgba(255,255,255,.12);

        border-radius: 8px;

        background:
          rgba(255,255,255,.045);

        color: #ddd;

        font-size: 12px;
        font-weight: 500;

        cursor: pointer;

        transition:
          background .15s ease,
          border-color .15s ease,
          color .15s ease;
      }

      #cloradPaletteManagerButton:hover {
        background:
          rgba(255,255,255,.09);

        border-color:
          rgba(255,255,255,.24);

        color: #fff;
      }

      #cloradPaletteManagerButton:active {
        transform: translateY(1px);
      }

      /* ================================================
         MANAGER
         ================================================ */

      #cloradPaletteManager {
        position: fixed;

        z-index: 99999;

        top: 90px;
        right: 18px;

        width: 360px;

        max-width:
          calc(100vw - 36px);

        max-height:
          calc(100vh - 110px);

        overflow: hidden;

        display: none;

        flex-direction: column;

        background:
          rgba(12,15,19,.97);

        color: #fff;

        border:
          1px solid
          rgba(255,255,255,.12);

        border-radius: 14px;

        box-shadow:
          0 18px 60px
          rgba(0,0,0,.55);

        backdrop-filter:
          blur(12px);

        -webkit-backdrop-filter:
          blur(12px);

        font-family:
          Arial, sans-serif;
      }

      #cloradPaletteManager.open {
        display: flex;
      }

      .cloradPaletteHeader {
        min-height: 52px;

        display: flex;

        align-items: center;

        justify-content:
          space-between;

        padding:
          0 14px;

        border-bottom:
          1px solid
          rgba(255,255,255,.09);

        flex-shrink: 0;
      }

      .cloradPaletteTitle {
        font-size: 16px;
        font-weight: 700;
      }

      .cloradPaletteClose {
        border: 0;
        background: transparent;
        color: #aaa;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
      }

      .cloradPaletteClose:hover {
        color: #fff;
      }

      .cloradPaletteBody {
        overflow-y: auto;
        padding: 12px;
      }

      .cloradPaletteSystemTitle,
      .cloradPaletteCustomTitle {
        margin: 3px 0 8px;

        color: #999;

        font-size: 11px;
        font-weight: 700;

        text-transform:
          uppercase;

        letter-spacing:
          .08em;
      }

      .cloradPaletteList {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }

      .cloradPaletteItem {
        display: flex;
        align-items: center;
        gap: 8px;

        padding: 8px;

        border:
          1px solid
          rgba(255,255,255,.08);

        border-radius: 10px;

        background:
          rgba(255,255,255,.035);
      }

      .cloradPaletteItem.active {
        border-color:
          rgba(255,255,255,.32);

        background:
          rgba(255,255,255,.075);
      }

      .cloradPalettePreview {
        width: 78px;
        height: 28px;

        display: flex;

        overflow: hidden;

        border-radius: 5px;

        flex-shrink: 0;
      }

      .cloradPalettePreview span {
        flex: 1;
        min-width: 0;
      }

      .cloradPaletteName {
        flex: 1;
        min-width: 0;
      }

      .cloradPaletteNameMain {
        overflow: hidden;

        white-space:
          nowrap;

        text-overflow:
          ellipsis;

        font-size: 13px;
        font-weight: 600;
      }

      .cloradPaletteNameSub {
        margin-top: 2px;

        color: #888;

        font-size: 10px;
      }

      .cloradPaletteActions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .cloradPaletteBtn {
        height: 30px;
        min-width: 30px;

        padding:
          0 8px;

        border:
          1px solid
          rgba(255,255,255,.1);

        border-radius: 7px;

        background:
          rgba(255,255,255,.06);

        color: #ddd;

        cursor: pointer;

        font-size: 11px;
      }

      .cloradPaletteBtn:hover {
        background:
          rgba(255,255,255,.12);

        color: #fff;
      }

      .cloradPaletteBtn.primary {
        background:
          rgba(40,180,100,.2);

        border-color:
          rgba(40,180,100,.4);
      }

      .cloradPaletteBtn.danger {
        color: #ff8585;
      }

      .cloradPaletteCreate {
        width: 100%;

        margin-top: 10px;

        height: 38px;

        border:
          1px dashed
          rgba(255,255,255,.18);

        border-radius: 9px;

        background:
          rgba(255,255,255,.035);

        color: #ddd;

        cursor: pointer;

        font-size: 12px;
      }

      .cloradPaletteCreate:hover {
        background:
          rgba(255,255,255,.08);
      }

      .cloradPaletteEditor {
        margin-top: 14px;

        padding-top: 14px;

        border-top:
          1px solid
          rgba(255,255,255,.09);
      }

      .cloradPaletteEditorHead {
        display: flex;

        align-items: center;

        justify-content:
          space-between;

        margin-bottom: 10px;
      }

      .cloradPaletteEditorName {
        font-size: 14px;
        font-weight: 700;
      }

      .cloradPaletteGrid {
        display: grid;

        grid-template-columns:
          repeat(4,1fr);

        gap: 7px;
      }

      .cloradColorCell {
        position: relative;

        min-width: 0;

        border:
          1px solid
          rgba(255,255,255,.09);

        border-radius: 8px;

        overflow: hidden;

        background:
          rgba(255,255,255,.04);
      }

      .cloradColorInput {
        display: block;

        width: 100%;
        height: 42px;

        padding: 0;

        border: 0;

        background:
          transparent;

        cursor: pointer;
      }

      .cloradColorInput::-webkit-color-swatch-wrapper {
        padding: 0;
      }

      .cloradColorInput::-webkit-color-swatch {
        border: 0;
      }

      .cloradColorLabel {
        display: block;

        padding: 4px;

        color: #888;

        font-size: 9px;

        text-align: center;
      }

      .cloradPaletteFooter {
        display: flex;

        gap: 7px;

        margin-top: 10px;
      }

      .cloradPaletteFooter button {
        flex: 1;
      }

      @media (max-width: 600px) {

        #cloradPaletteManager {
          top: 70px;
          right: 8px;

          width:
            calc(100vw - 16px);

          max-height:
            calc(100vh - 80px);
        }

        .cloradPaletteGrid {
          grid-template-columns:
            repeat(4,1fr);
        }

      }

    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     КНОПКА МЕНЕДЖЕРА
     ======================================================= */

  function installPaletteManagerButton() {
    if (
      document.getElementById(
        "cloradPaletteManagerButton"
      )
    ) {
      return true;
    }

    const all =
      Array.from(
        document.querySelectorAll(
          "button, .button, .btn, label, div"
        )
      );

    const rgmc =
      all.find(
        element =>
          element.textContent
            .trim() === "РГМЦ"
      );

    const iram =
      all.find(
        element =>
          element.textContent
            .trim() === "ИРАМ"
      );

    if (
      !rgmc &&
      !iram
    ) {
      return false;
    }

    const reference =
      iram || rgmc;

    let container =
      reference.parentElement;

    if (!container) {
      return false;
    }

    /*
       Если РГМЦ и ИРАМ находятся внутри
       общего контейнера глубже, поднимаемся
       максимум на несколько уровней.
    */

    let current =
      container;

    for (
      let i = 0;
      i < 3;
      i++
    ) {
      const hasRGMC =
        Array.from(
          current.querySelectorAll(
            "*"
          )
        ).some(
          element =>
            element !== current &&
            element.textContent
              .trim() === "РГМЦ"
        );

      const hasIRAM =
        Array.from(
          current.querySelectorAll(
            "*"
          )
        ).some(
          element =>
            element !== current &&
            element.textContent
              .trim() === "ИРАМ"
        );

      if (
        hasRGMC &&
        hasIRAM
      ) {
        container =
          current;

        break;
      }

      if (
        current.parentElement
      ) {
        current =
          current.parentElement;
      }
    }

    if (
      container.querySelector(
        "#cloradPaletteManagerButton"
      )
    ) {
      return true;
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
        event.preventDefault();
        event.stopPropagation();

        openManager();
      }
    );

    /*
       Ставим кнопку после существующего
       блока выбора РГМЦ / ИРАМ.
    */

    container.appendChild(
      button
    );

    return true;
  }

  /* =======================================================
     MANAGER DOM
     ======================================================= */

  function createManager() {
    if (
      document.getElementById(
        "cloradPaletteManager"
      )
    ) {
      return;
    }

    const manager =
      document.createElement(
        "div"
      );

    manager.id =
      "cloradPaletteManager";

    manager.innerHTML = `

      <div class="cloradPaletteHeader">

        <div class="cloradPaletteTitle">
          Палитры радара
        </div>

        <button
          class="cloradPaletteClose"
          id="cloradPaletteClose"
          type="button"
        >
          ×
        </button>

      </div>

      <div
        class="cloradPaletteBody"
        id="cloradPaletteBody"
      ></div>

    `;

    document.body.appendChild(
      manager
    );

    const closeButton =
      document.getElementById(
        "cloradPaletteClose"
      );

    if (closeButton) {
      closeButton.addEventListener(
        "click",
        closeManager
      );
    }

    manager.addEventListener(
      "click",
      handleManagerClick
    );
  }

  /* =======================================================
     PREVIEW
     ======================================================= */

  function palettePreview(
    colors
  ) {
    return colors
      .map(
        color =>
          `<span style="background:${color}"></span>`
      )
      .join("");
  }

  /* =======================================================
     PALETTE ITEM
     ======================================================= */

  function renderPaletteItem(
    palette
  ) {
    const active =
      palette.id ===
      activePaletteId
        ? " active"
        : "";

    const locked =
      palette.locked;

    return `

      <div
        class="cloradPaletteItem${active}"
        data-palette-id="${escapeHTML(
          palette.id
        )}"
      >

        <div class="cloradPalettePreview">
          ${palettePreview(
            palette.colors
          )}
        </div>

        <div class="cloradPaletteName">

          <div class="cloradPaletteNameMain">
            ${escapeHTML(
              palette.name
            )}
          </div>

          <div class="cloradPaletteNameSub">
            ${
              locked
                ? "Системная"
                : "Пользовательская"
            }
          </div>

        </div>

        <div class="cloradPaletteActions">

          <button
            class="cloradPaletteBtn primary"
            data-action="apply"
            data-id="${escapeHTML(
              palette.id
            )}"
            type="button"
          >
            ${
              palette.id ===
              activePaletteId
                ? "Включена"
                : "Применить"
            }
          </button>

          <button
            class="cloradPaletteBtn"
            data-action="duplicate"
            data-id="${escapeHTML(
              palette.id
            )}"
            type="button"
          >
            Копия
          </button>

          ${
            locked
              ? ""
              : `

                <button
                  class="cloradPaletteBtn"
                  data-action="edit"
                  data-id="${escapeHTML(
                    palette.id
                  )}"
                  type="button"
                >
                  Изменить
                </button>

                <button
                  class="cloradPaletteBtn"
                  data-action="rename"
                  data-id="${escapeHTML(
                    palette.id
                  )}"
                  type="button"
                >
                  Имя
                </button>

                <button
                  class="cloradPaletteBtn danger"
                  data-action="delete"
                  data-id="${escapeHTML(
                    palette.id
                  )}"
                  type="button"
                >
                  Удалить
                </button>

              `
          }

        </div>

      </div>

    `;
  }

  /* =======================================================
     EDITOR
     ======================================================= */

  function renderEditor() {
    const body =
      document.getElementById(
        "cloradPaletteBody"
      );

    if (!body) {
      return;
    }

    if (!editorPaletteId) {
      return;
    }

    const palette =
      getPalette(
        editorPaletteId
      );

    if (!palette) {
      editorPaletteId =
        null;

      return;
    }

    if (palette.locked) {
      editorPaletteId =
        null;

      return;
    }

    const oldEditor =
      document.getElementById(
        "cloradPaletteEditor"
      );

    if (oldEditor) {
      oldEditor.remove();
    }

    const cells =
      palette.colors
        .map(
          (
            color,
            index
          ) => `

            <div class="cloradColorCell">

              <input
                class="cloradColorInput"
                type="color"
                value="${color}"
                data-color-index="${index}"
              >

              <span class="cloradColorLabel">
                ${index + 1}
              </span>

            </div>

          `
        )
        .join("");

    const editor =
      document.createElement(
        "div"
      );

    editor.className =
      "cloradPaletteEditor";

    editor.id =
      "cloradPaletteEditor";

    editor.innerHTML = `

      <div class="cloradPaletteEditorHead">

        <div class="cloradPaletteEditorName">
          ${escapeHTML(
            palette.name
          )}
        </div>

        <button
          class="cloradPaletteBtn"
          data-action="close-editor"
          type="button"
        >
          Закрыть
        </button>

      </div>

      <div class="cloradPaletteGrid">
        ${cells}
      </div>

      <div class="cloradPaletteFooter">

        <button
          class="cloradPaletteBtn"
          data-action="rename"
          data-id="${escapeHTML(
            palette.id
          )}"
          type="button"
        >
          Переименовать
        </button>

        <button
          class="cloradPaletteBtn"
          data-action="reset"
          data-id="${escapeHTML(
            palette.id
          )}"
          type="button"
        >
          Сбросить
        </button>

      </div>

    `;

    body.appendChild(
      editor
    );

    editor
      .querySelectorAll(
        ".cloradColorInput"
      )
      .forEach(
        input => {
          input.addEventListener(
            "input",
            event => {
              const index =
                Number(
                  event.target
                    .dataset
                    .colorIndex
                );

              changeColor(
                index,
                event.target.value
              );
            }
          );
        }
      );
  }

  /* =======================================================
     RENDER
     ======================================================= */

  function render() {
    const body =
      document.getElementById(
        "cloradPaletteBody"
      );

    if (!body) {
      return;
    }

    const system =
      palettes.filter(
        palette =>
          palette.locked
      );

    const custom =
      palettes.filter(
        palette =>
          !palette.locked
      );

    body.innerHTML = `

      <div class="cloradPaletteSystemTitle">
        Системные палитры
      </div>

      <div class="cloradPaletteList">
        ${system
          .map(
            renderPaletteItem
          )
          .join("")}
      </div>

      <div
        class="cloradPaletteCustomTitle"
        style="margin-top:14px;"
      >
        Пользовательские палитры
      </div>

      <div class="cloradPaletteList">

        ${
          custom.length
            ? custom
                .map(
                  renderPaletteItem
                )
                .join("")
            : `

              <div
                style="
                  color:#777;
                  font-size:12px;
                  padding:7px 2px;
                "
              >
                Пользовательских палитр пока нет.
              </div>

            `
        }

      </div>

      <button
        class="cloradPaletteCreate"
        data-action="create"
        type="button"
      >
        Создать палитру
      </button>

    `;

    renderEditor();
  }

  /* =======================================================
     EVENTS
     ======================================================= */

  function handleManagerClick(
    event
  ) {
    const button =
      event.target.closest(
        "[data-action]"
      );

    if (!button) {
      return;
    }

    const action =
      button.dataset.action;

    const id =
      button.dataset.id;

    if (
      action ===
      "apply"
    ) {
      activatePalette(id);
      return;
    }

    if (
      action ===
      "edit"
    ) {
      openEditor(id);
      return;
    }

    if (
      action ===
      "duplicate"
    ) {
      duplicatePalette(id);
      return;
    }

    if (
      action ===
      "rename"
    ) {
      renamePalette(id);
      return;
    }

    if (
      action ===
      "delete"
    ) {
      deletePalette(id);
      return;
    }

    if (
      action ===
      "reset"
    ) {
      resetPalette(id);
      return;
    }

    if (
      action ===
      "close-editor"
    ) {
      closeEditor();
      return;
    }

    if (
      action ===
      "create"
    ) {
      createPalette();
      return;
    }
  }

  /* =======================================================
     OPEN / CLOSE
     ======================================================= */

  function openManager() {
    ensureStyles();

    createManager();

    const manager =
      document.getElementById(
        "cloradPaletteManager"
      );

    if (!manager) {
      return;
    }

    manager.classList.add(
      "open"
    );

    render();
  }

  function closeManager() {
    const manager =
      document.getElementById(
        "cloradPaletteManager"
      );

    if (!manager) {
      return;
    }

    manager.classList.remove(
      "open"
    );
  }

  function toggleManager() {
    const manager =
      document.getElementById(
        "cloradPaletteManager"
      );

    if (
      manager &&
      manager.classList.contains(
        "open"
      )
    ) {
      closeManager();
    } else {
      openManager();
    }
  }

  /* =======================================================
     ESC
     ======================================================= */

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "Escape"
      ) {
        closeManager();
      }
    }
  );

  /* =======================================================
     HTML ESCAPE
     ======================================================= */

  function escapeHTML(
    value
  ) {
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
     PUBLIC API
     ======================================================= */

  window.CLOradPalettes = {

    open:
      openManager,

    close:
      closeManager,

    toggle:
      toggleManager,

    getAll() {
      return palettes.map(
        palette => ({
          id:
            palette.id,

          name:
            palette.name,

          locked:
            palette.locked,

          colors:
            palette.colors.slice()
        })
      );
    },

    getActive() {
      const palette =
        getActivePalette();

      if (!palette) {
        return null;
      }

      return {
        id:
          palette.id,

        name:
          palette.name,

        locked:
          palette.locked,

        colors:
          palette.colors.slice()
      };
    },

    activate(id) {
      activatePalette(id);
    },

    create() {
      createPalette();
    },

    duplicate(id) {
      duplicatePalette(id);
    },

    rename(id) {
      renamePalette(id);
    },

    remove(id) {
      deletePalette(id);
    },

    edit(id) {
      openEditor(id);
    }
  };

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    loadStorage();

    ensureStyles();

    createManager();

    /*
       Палитры РГМЦ / ИРАМ могут создаваться
       самим gif-radar.js после его инициализации.

       Поэтому пытаемся установить кнопку
       несколько раз.
    */

    let attempts = 0;

    const buttonTimer =
      setInterval(() => {

        attempts++;

        const installed =
          installPaletteManagerButton();

        if (
          installed ||
          attempts >= 40
        ) {
          clearInterval(
            buttonTimer
          );
        }

      }, 250);

    /*
       Также следим за DOM.
       Это нужно на случай, если gif-radar.js
       позже перестроит панель палитр.
    */

    const observer =
      new MutationObserver(
        () => {
          installPaletteManagerButton();
        }
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    /*
       Применяем сохранённую палитру
       после загрузки radar-модуля.
    */

    const active =
      getActivePalette();

    if (active) {
      setTimeout(() => {
        applyToRadar(
          active
        );
      }, 500);
    }
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }

})();
