/* =========================================================
   CLOrad — RainRadar
   RainRadar → РГМЦ

   ВАЖНО:
   - Обычные Leaflet PNG-тайлы
   - Никаких SVG-фильтров
   - Никакого Canvas в браузере
   - Цветизация выполняется на API Vercel
   - Палитра = РГМЦ, как у ДМРЛ
   - Чёрный фон = прозрачность
   - Качество исходного тайла сохраняется
   - index.html НЕ изменяется
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

  const RR_API =
    "/api/rainradar";

  const RR_MIN_ZOOM = 3;
  const RR_MAX_NATIVE_ZOOM = 5;

  const RR_BOUNDS = [
    [35, 15],
    [72, 180]
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
     OLD SIDEBAR CONTROL
     ======================================================= */

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
        oldSwitch.closest(".layer");

      if (parent) {
        parent.remove();
      } else {
        oldSwitch.remove();
      }
    }
  }

  /* =======================================================
     TOP NAV BUTTON
     ======================================================= */

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
      document.querySelector(".nav");

    if (!nav) {
      return null;
    }

    const button =
      document.createElement("button");

    button.className = "n";
    button.id = "rainRadarNav";
    button.type = "button";

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
      gifButton.after(button);
    } else if (rainButton) {
      rainButton.after(button);
    } else {
      nav.appendChild(button);
    }

    rainRadarButton =
      button;

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        if (rainRadarEnabled) {
          disableRainRadar();
        } else {
          enableRainRadar();
        }
      }
    );

    return button;
  }

  function setActiveNav(button) {
    document
      .querySelectorAll(".n")
      .forEach(item => {
        item.classList.remove("active");
      });

    if (button) {
      button.classList.add("active");
    }
  }

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
      now - manifestLoadedAt < 60000
    ) {
      return rainRadarManifest;
    }

    const response =
      await fetch(
        RR_MANIFEST,
        {
          method: "GET",
          cache: "no-store"
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

    if (!Array.isArray(data)) {
      throw new Error(
        "Неверный формат manifest.json"
      );
    }

    rainRadarManifest =
      data;

    manifestLoadedAt =
      now;

    parseManifest(data);

    return data;
  }

  function parseManifest(data) {
    const frames = [];

    for (const item of data) {
      if (
        !Array.isArray(item) ||
        item.length < 2
      ) {
        continue;
      }

      const timestamp =
        Number(item[0]);

      const groups =
        item[1];

      if (
        !Number.isFinite(timestamp) ||
        !Array.isArray(groups)
      ) {
        continue;
      }

      frames.push({
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

  function getLatestFrame() {
    if (!rainRadarFrames.length) {
      return null;
    }

    return rainRadarFrames[
      rainRadarFrames.length - 1
    ];
  }

  /* =======================================================
     COLORED TILE URL
     ======================================================= */

  function getTileUrl(
    timestamp,
    coords
  ) {
    return (
      RR_API +
      "?timestamp=" +
      encodeURIComponent(timestamp) +
      "&z=" +
      encodeURIComponent(coords.z) +
      "&x=" +
      encodeURIComponent(coords.x) +
      "&y=" +
      encodeURIComponent(coords.y)
    );
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

    /*
     * Обычный Leaflet TileLayer.
     *
     * Никаких CSS-фильтров.
     * Никакого Canvas.
     */

    rainRadarLayer =
      L.tileLayer(
        getTileUrl(
          timestamp,
          {
            z: "{z}",
            x: "{x}",
            y: "{y}"
          }
        ),
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
    if (rainRadarLoading) {
      return;
    }

    rainRadarLoading =
      true;

    try {
      message(
        "Загрузка RainRadar…"
      );

      await loadManifest(false);

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

      if (rainRadarButton) {
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

      if (rainRadarButton) {
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

    if (rainRadarButton) {
      rainRadarButton.classList.remove(
        "active"
      );
    }

    message(
      "RainRadar выключен"
    );
  }

  /* =======================================================
     REFRESH
     ======================================================= */

  async function refreshRainRadar() {
    if (
      !rainRadarEnabled ||
      rainRadarLoading
    ) {
      return;
    }

    try {
      await loadManifest(true);

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
      document.querySelector(".nav");

    if (!nav) {
      return;
    }

    nav.addEventListener(
      "click",
      event => {
        const button =
          event.target.closest(".n");

        if (!button) {
          return;
        }

        if (
          button.id ===
          "rainRadarNav"
        ) {
          return;
        }

        if (rainRadarEnabled) {
          disableRainRadar();
        }
      },
      true
    );
  }

  /* =======================================================
     TIME
     ======================================================= */

  function formatTime(timestamp) {
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

    toggle: () => {
      if (rainRadarEnabled) {
        disableRainRadar();
      } else {
        enableRainRadar();
      }
    },

    refresh:
      refreshRainRadar,

    getLayer:
      () => rainRadarLayer,

    getTimestamp:
      () => rainRadarTimestamp,

    isEnabled:
      () => rainRadarEnabled,

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
        once: true
      }
    );
  } else {
    init();
  }

})();
