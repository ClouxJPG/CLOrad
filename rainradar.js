/* =========================================================
   CLOrad — RainRadar
   RainRadar grayscale → РГМЦ

   ВАЖНО:
   - исходные RainRadar PNG остаются grayscale
   - цветизация выполняется прямо в браузере
   - палитра ТОЛЬКО РГМЦ
   - чёрный фон становится прозрачным
   - Canvas НЕ используется
   - CORS для чтения пикселей НЕ нужен
   - index.html НЕ изменяется

   Верхняя панель:

   Осадки-мм/ч | ДМРЛ композит | RainRadar | Слои
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const RR_ROOT =
    "https://rainradar.ru/composite/";

  const RR_MANIFEST =
    RR_ROOT + "manifest.json";

  const RR_MIN_ZOOM = 3;
  const RR_MAX_NATIVE_ZOOM = 5;

  const RR_BOUNDS = [
    [35, 15],
    [72, 180]
  ];

  /* =======================================================
     РГМЦ — ТОЧНО ТА ЖЕ ПАЛИТРА, ЧТО У ДМРЛ
     ======================================================= */

  const RGMC_PALETTE = [
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

  /* =======================================================
     STATE
     ======================================================= */

  let rainRadarButton = null;

  let rainRadarLayer = null;

  let rainRadarEnabled = false;

  let rainRadarTimestamp = null;

  let rainRadarManifest = null;

  let rainRadarFrames = [];

  let rainRadarLoading = false;

  let manifestLoadedAt = 0;

  let refreshTimer = null;

  /* =======================================================
     HELPERS
     ======================================================= */

  function $(id) {
    return document.getElementById(id);
  }

  function getMap() {
    return window.map || null;
  }

  function message(text) {
    if (typeof window.msg === "function") {
      window.msg(text);
      return;
    }

    const old =
      document.getElementById(
        "rainRadarMessage"
      );

    if (old) {
      old.remove();
    }

    const box =
      document.createElement("div");

    box.id =
      "rainRadarMessage";

    box.textContent =
      text;

    box.style =
      "position:fixed;" +
      "z-index:2147483647;" +
      "left:50%;" +
      "bottom:125px;" +
      "transform:translateX(-50%);" +
      "background:#202930;" +
      "color:#fff;" +
      "padding:9px 14px;" +
      "border-radius:8px;" +
      "border:1px solid #3d4850;" +
      "white-space:nowrap;" +
      "max-width:calc(100% - 30px);" +
      "overflow:hidden;" +
      "text-overflow:ellipsis;";

    document.body.appendChild(box);

    setTimeout(() => {
      if (box.parentNode) {
        box.remove();
      }
    }, 1800);
  }

  /* =======================================================
     SVG FILTER
     ======================================================= */

  function createRainRadarFilter() {
    if (
      document.getElementById(
        "cloradRainRadarFilterSvg"
      )
    ) {
      return;
    }

    const svg =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
      );

    svg.id =
      "cloradRainRadarFilterSvg";

    svg.setAttribute(
      "width",
      "0"
    );

    svg.setAttribute(
      "height",
      "0"
    );

    svg.setAttribute(
      "aria-hidden",
      "true"
    );

    svg.style.position =
      "absolute";

    svg.style.width =
      "0";

    svg.style.height =
      "0";

    svg.style.overflow =
      "hidden";

    /* -----------------------------------------------------
       FILTER
       ----------------------------------------------------- */

    const filter =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "filter"
      );

    filter.id =
      "cloradRainRadarColorize";

    filter.setAttribute(
      "x",
      "0%"
    );

    filter.setAttribute(
      "y",
      "0%"
    );

    filter.setAttribute(
      "width",
      "100%"
    );

    filter.setAttribute(
      "height",
      "100%"
    );

    filter.setAttribute(
      "color-interpolation-filters",
      "sRGB"
    );

    /* -----------------------------------------------------
       1. Получаем яркость исходного grayscale PNG
       и записываем её в alpha.

       RGB при этом сохраняются.
       ----------------------------------------------------- */

    const luminance =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "feColorMatrix"
      );

    luminance.setAttribute(
      "type",
      "matrix"
    );

    luminance.setAttribute(
      "values",
      [
        "1 0 0 0 0",
        "0 1 0 0 0",
        "0 0 1 0 0",
        "0.2126 0.7152 0.0722 0 0"
      ].join(" ")
    );

    filter.appendChild(
      luminance
    );

    /* -----------------------------------------------------
       2. РГМЦ — RED
       ----------------------------------------------------- */

    const red =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "feComponentTransfer"
      );

    const redFunc =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "feFuncR"
      );

    redFunc.setAttribute(
      "type",
      "table"
    );

    redFunc.setAttribute(
      "tableValues",
      [
        "0.725",
        "0.663",
        "0.388",
        "0.263",
        "0.302",
        "1.000",
        "0.459",
        "0.322",
        "0.314",
        "1.000",
        "0.980",
        "1.000",
        "0.859",
        "0.678",
        "0.573",
        "0.949",
        "0.910",
        "0.792",
        "0.467"
      ].join(" ")
    );

    red.appendChild(
      redFunc
    );

    /* -----------------------------------------------------
       3. РГМЦ — GREEN
       ----------------------------------------------------- */

    const greenFunc =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "feFuncG"
      );

    greenFunc.setAttribute(
      "type",
      "table"
    );

    greenFunc.setAttribute(
      "tableValues",
      [
        "0.757",
        "0.780",
        "0.929",
        "0.812",
        "0.722",
        "0.976",
        "0.651",
        "0.475",
        "0.290",
        "0.753",
        "0.510",
        "0.302",
        "0.573",
        "0.459",
        "0.294",
        "0.667",
        "0.353",
        "0.235",
        "0.486"
      ].join(" ")
    );

    red.appendChild(
      greenFunc
    );

    /* -----------------------------------------------------
       4. РГМЦ — BLUE
       ----------------------------------------------------- */

    const blueFunc =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "feFuncB"
      );

    blueFunc.setAttribute(
      "type",
      "table"
    );

    blueFunc.setAttribute(
      "tableValues",
      [
        "0.780",
        "0.957",
        "0.647",
        "0.537",
        "0.306",
        "0.612",
        "0.937",
        "0.929",
        "0.608",
        "0.659",
        "0.627",
        "0.302",
        "0.282",
        "0.267",
        "0.282",
        "0.941",
        "0.906",
        "0.780",
        "0.569"
      ].join(" ")
    );

    red.appendChild(
      blueFunc
    );

    filter.appendChild(
      red
    );

    /* -----------------------------------------------------
       5. ЧЁРНЫЙ ФОН → ПРОЗРАЧНЫЙ
       -----------------------------------------------------

       Alpha уже содержит яркость.

       Первые значения:
       0
       0
       0
       1

       Поэтому самый тёмный фон исчезает.
       ----------------------------------------------------- */

    const alphaFunc =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "feFuncA"
      );

    alphaFunc.setAttribute(
      "type",
      "table"
    );

    alphaFunc.setAttribute(
      "tableValues",
      [
        "0",
        "0",
        "0",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "1"
      ].join(" ")
    );

    red.appendChild(
      alphaFunc
    );

    document.body.appendChild(
      svg
    );

    svg.appendChild(
      filter
    );
  }

  /* =======================================================
     CSS
     ======================================================= */

  function createRainRadarCSS() {
    if (
      document.getElementById(
        "cloradRainRadarCSS"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "cloradRainRadarCSS";

    style.textContent = `
      .clorad-rainradar
        .leaflet-tile,
      .clorad-rainradar-canvas-tile {

        filter:
          url("#cloradRainRadarColorize");

        -webkit-filter:
          url("#cloradRainRadarColorize");

        transform-origin:
          center center;
      }

      .clorad-rainradar {
        pointer-events:
          none;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     TILE URL
     ======================================================= */

  function getTileUrl(
    timestamp,
    coords
  ) {
    return (
      RR_ROOT +
      timestamp +
      "/" +
      coords.z +
      "/" +
      coords.x +
      "_" +
      coords.y +
      ".png"
    );
  }

  /* =======================================================
     CUSTOM GRID LAYER
     ======================================================= */

  const RainRadarLayer =
    L.GridLayer.extend({

      initialize:
        function(
          timestamp,
          options
        ) {

          this.timestamp =
            timestamp;

          L.GridLayer.prototype
            .initialize.call(
              this,
              options
            );
        },

      _initTile:
        function(tile) {

          L.GridLayer.prototype
            ._initTile.call(
              this,
              tile
            );

          tile.classList.add(
            "clorad-rainradar-tile"
          );
        },

      createTile:
        function(
          coords,
          done
        ) {

          const tile =
            document.createElement(
              "img"
            );

          tile.alt = "";

          tile.setAttribute(
            "role",
            "presentation"
          );

          tile.width = 256;
          tile.height = 256;

          tile.className =
            "clorad-rainradar-tile";

          tile.crossOrigin =
            "anonymous";

          const url =
            getTileUrl(
              this.timestamp,
              coords
            );

          let finished =
            false;

          const finish =
            (error) => {

              if (finished) {
                return;
              }

              finished =
                true;

              done(
                error,
                tile
              );
            };

          tile.onload =
            () => {
              finish(null);
            };

          tile.onerror =
            () => {
              finish(
                new Error(
                  "RainRadar tile error"
                )
              );
            };

          tile.src =
            url;

          return tile;
        }
    });

  /* =======================================================
     MANIFEST
     ======================================================= */

  async function loadManifest(
    force = false
  ) {

    const now =
      Date.now();

    if (
      !force &&
      rainRadarManifest &&
      now -
        manifestLoadedAt <
        60000
    ) {
      return rainRadarManifest;
    }

    const response =
      await fetch(
        RR_MANIFEST,
        {
          method:
            "GET",

          cache:
            "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        "RainRadar manifest: HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    if (
      !Array.isArray(data)
    ) {
      throw new Error(
        "Неверный формат manifest.json"
      );
    }

    rainRadarManifest =
      data;

    manifestLoadedAt =
      now;

    parseManifest(
      data
    );

    return data;
  }

  /* =======================================================
     PARSE MANIFEST
     ======================================================= */

  function parseManifest(
    data
  ) {

    const frames = [];

    for (
      const item of data
    ) {

      if (
        !Array.isArray(item) ||
        item.length < 2
      ) {
        continue;
      }

      const timestamp =
        Number(
          item[0]
        );

      const groups =
        item[1];

      if (
        !Number.isFinite(
          timestamp
        ) ||
        !Array.isArray(
          groups
        )
      ) {
        continue;
      }

      frames.push({
        timestamp:
          timestamp
      });
    }

    frames.sort(
      (a, b) =>
        a.timestamp -
        b.timestamp
    );

    rainRadarFrames =
      frames;
  }

  /* =======================================================
     LATEST FRAME
     ======================================================= */

  function getLatestFrame() {

    if (
      !rainRadarFrames.length
    ) {
      return null;
    }

    return rainRadarFrames[
      rainRadarFrames.length - 1
    ];
  }

  /* =======================================================
     REMOVE LAYER
     ======================================================= */

  function removeRainRadarLayer() {

    const map =
      getMap();

    if (
      map &&
      rainRadarLayer &&
      map.hasLayer(
        rainRadarLayer
      )
    ) {

      map.removeLayer(
        rainRadarLayer
      );
    }

    rainRadarLayer =
      null;

    rainRadarTimestamp =
      null;
  }

  /* =======================================================
     CREATE LAYER
     ======================================================= */

  function createRainRadarLayer(
    timestamp
  ) {

    const map =
      getMap();

    if (!map) {
      throw new Error(
        "Карта CLOrad ещё не готова"
      );
    }

    removeRainRadarLayer();

    rainRadarLayer =
      new RainRadarLayer(
        timestamp,
        {
          minZoom:
            RR_MIN_ZOOM,

          minNativeZoom:
            RR_MIN_ZOOM,

          maxNativeZoom:
            RR_MAX_NATIVE_ZOOM,

          maxZoom:
            14,

          opacity:
            1,

          zIndex:
            620,

          noWrap:
            true,

          bounds:
            RR_BOUNDS,

          updateWhenZooming:
            true,

          updateWhenIdle:
            true,

          keepBuffer:
            2,

          className:
            "clorad-rainradar"
        }
      );

    rainRadarLayer.addTo(
      map
    );

    if (
      typeof rainRadarLayer.bringToFront ===
      "function"
    ) {

      rainRadarLayer.bringToFront();
    }

    rainRadarTimestamp =
      timestamp;
  }

  /* =======================================================
     ENABLE
     ======================================================= */

  async function enableRainRadar() {

    if (
      rainRadarLoading
    ) {
      return;
    }

    rainRadarLoading =
      true;

    try {

      message(
        "Загрузка RainRadar…"
      );

      await loadManifest(
        false
      );

      const latest =
        getLatestFrame();

      if (!latest) {

        throw new Error(
          "Нет доступных кадров RainRadar"
        );
      }

      createRainRadarLayer(
        latest.timestamp
      );

      rainRadarEnabled =
        true;

      if (
        rainRadarButton
      ) {

        rainRadarButton.classList.add(
          "active"
        );
      }

      setActiveNav(
        rainRadarButton
      );

      message(
        "RainRadar: " +
        formatTime(
          latest.timestamp
        )
      );

    } catch (error) {

      console.error(
        "CLOrad RainRadar:",
        error
      );

      rainRadarEnabled =
        false;

      removeRainRadarLayer();

      if (
        rainRadarButton
      ) {

        rainRadarButton.classList.remove(
          "active"
        );
      }

      message(
        error?.message ||
        "RainRadar не загрузился"
      );

    } finally {

      rainRadarLoading =
        false;
    }
  }

  /* =======================================================
     DISABLE
     ======================================================= */

  function disableRainRadar() {

    rainRadarEnabled =
      false;

    removeRainRadarLayer();

    if (
      rainRadarButton
    ) {

      rainRadarButton.classList.remove(
        "active"
      );
    }

    message(
      "RainRadar выключен"
    );
  }

  /* =======================================================
     NAV
     ======================================================= */

  function setActiveNav(
    button
  ) {

    document
      .querySelectorAll(
        ".n"
      )
      .forEach(
        item => {

          item.classList.remove(
            "active"
          );
        }
      );

    if (button) {

      button.classList.add(
        "active"
      );
    }
  }

  function removeOldLayersButton() {

    const oldLayer =
      document.getElementById(
        "rainradarLayerControl"
      );

    if (oldLayer) {
      oldLayer.remove();
    }

    const oldSwitch =
      document.getElementById(
        "rainradarSwitch"
      );

    if (oldSwitch) {

      const parent =
        oldSwitch.closest(
          ".layer"
        );

      if (parent) {
        parent.remove();
      } else {
        oldSwitch.remove();
      }
    }
  }

  function createRainRadarButton() {

    const existing =
      document.getElementById(
        "rainRadarNav"
      );

    if (existing) {

      rainRadarButton =
        existing;

      return existing;
    }

    const nav =
      document.querySelector(
        ".nav"
      );

    if (!nav) {
      return null;
    }

    const button =
      document.createElement(
        "button"
      );

    button.className =
      "n";

    button.id =
      "rainRadarNav";

    button.type =
      "button";

    button.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M5 19V11"/>
        <path d="M12 19V7"/>
        <path d="M19 19V4"/>
      </svg>
      RainRadar
    `;

    const gifButton =
      document.getElementById(
        "gifRadarNav"
      );

    const rainButton =
      document.getElementById(
        "rainProduct"
      );

    if (gifButton) {

      gifButton.after(
        button
      );

    } else if (rainButton) {

      rainButton.after(
        button
      );

    } else {

      nav.appendChild(
        button
      );
    }

    rainRadarButton =
      button;

    button.addEventListener(
      "click",
      event => {

        event.preventDefault();

        event.stopPropagation();

        if (
          rainRadarEnabled
        ) {

          disableRainRadar();

        } else {

          enableRainRadar();
        }
      }
    );

    return button;
  }

  /* =======================================================
     AUTO REFRESH
     ======================================================= */

  async function refreshRainRadar() {

    if (
      !rainRadarEnabled ||
      rainRadarLoading
    ) {
      return;
    }

    try {

      await loadManifest(
        true
      );

      const latest =
        getLatestFrame();

      if (!latest) {
        return;
      }

      if (
        latest.timestamp !==
        rainRadarTimestamp
      ) {

        createRainRadarLayer(
          latest.timestamp
        );

        message(
          "RainRadar обновлён: " +
          formatTime(
            latest.timestamp
          )
        );
      }

    } catch (error) {

      console.error(
        "RainRadar refresh:",
        error
      );
    }
  }

  /* =======================================================
     OTHER NAV BUTTONS
     ======================================================= */

  function setupNavigation() {

    const nav =
      document.querySelector(
        ".nav"
      );

    if (!nav) {
      return;
    }

    nav.addEventListener(
      "click",
      event => {

        const button =
          event.target.closest(
            ".n"
          );

        if (!button) {
          return;
        }

        if (
          button.id ===
          "rainRadarNav"
        ) {
          return;
        }

        if (
          rainRadarEnabled
        ) {

          disableRainRadar();
        }
      },
      true
    );
  }

  /* =======================================================
     TIME
     ======================================================= */

  function formatTime(
    timestamp
  ) {

    const date =
      new Date(
        timestamp * 1000
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {

      return "—";
    }

    return date.toLocaleString(
      "ru-RU",
      {
        day:
          "2-digit",

        month:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        timeZone:
          "Europe/Moscow"
      }
    );
  }

  /* =======================================================
     INIT
     ======================================================= */

  function init() {

    /*
     * Создаём SVG-фильтр ДО появления тайлов.
     */

    createRainRadarFilter();

    createRainRadarCSS();

    removeOldLayersButton();

    createRainRadarButton();

    setupNavigation();

    if (refreshTimer) {

      clearInterval(
        refreshTimer
      );
    }

    refreshTimer =
      setInterval(
        refreshRainRadar,
        60000
      );
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRainRadar = {

    enable:
      enableRainRadar,

    disable:
      disableRainRadar,

    toggle:
      () => {

        if (
          rainRadarEnabled
        ) {

          disableRainRadar();

        } else {

          enableRainRadar();
        }
      },

    refresh:
      refreshRainRadar,

    getLayer:
      () =>
        rainRadarLayer,

    getTimestamp:
      () =>
        rainRadarTimestamp,

    isEnabled:
      () =>
        rainRadarEnabled,

    palette:
      "rgmc"
  };

  /* =======================================================
     START
     ======================================================= */

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
