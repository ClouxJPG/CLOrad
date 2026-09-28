/* =========================================================
   CLOrad — RainRadar Russia Composite
   Автоматический timestamp
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const API = "/api/rainradar";

  const RR_BOUNDS = [
    [35, 15],
    [72, 180]
  ];

  const MIN_ZOOM = 3;
  const MIN_NATIVE_ZOOM = 3;
  const MAX_NATIVE_ZOOM = 5;
  const MAX_ZOOM = 14;

  const REFRESH_TIME = 60 * 1000;

  /* =======================================================
     STATE
     ======================================================= */

  let rainRadarNav = null;

  let rainRadarLayer = null;

  let timestamps = [];
  let currentIndex = -1;

  let active = false;

  let refreshTimer = null;

  let loading = false;

  /* =======================================================
     HELPERS
     ======================================================= */

  function $(id) {
    return document.getElementById(id);
  }

  function getMap() {
    return window.map || null;
  }

  function showMessage(text) {
    if (
      typeof window.msg === "function"
    ) {
      window.msg(text);
      return;
    }

    const el =
      document.createElement("div");

    el.textContent = text;

    el.style.cssText =
      [
        "position:fixed",
        "z-index:2147483646",
        "left:50%",
        "bottom:125px",
        "transform:translateX(-50%)",
        "background:#202930",
        "color:#fff",
        "padding:9px 14px",
        "border-radius:8px",
        "border:1px solid #3d4850",
        "white-space:nowrap",
        "max-width:calc(100% - 30px)",
        "overflow:hidden",
        "text-overflow:ellipsis"
      ].join(";");

    document.body.appendChild(el);

    setTimeout(
      () => el.remove(),
      2200
    );
  }

  /* =======================================================
     NAV
     ======================================================= */

  function createNav() {
    if (
      $("rainRadarNav")
    ) {
      rainRadarNav =
        $("rainRadarNav");

      return;
    }

    const rainButton =
      $("rainProduct");

    if (!rainButton) {
      return;
    }

    rainRadarNav =
      document.createElement("button");

    rainRadarNav.id =
      "rainRadarNav";

    rainRadarNav.className =
      "n";

    rainRadarNav.type =
      "button";

    rainRadarNav.innerHTML =
      `
        <svg viewBox="0 0 24 24">
          <path d="M4 17h16M4 12h16M4 7h16"/>
        </svg>
        RainRadar
      `;

    rainButton.insertAdjacentElement(
      "afterend",
      rainRadarNav
    );

    rainRadarNav.onclick =
      event => {
        event.stopPropagation();

        activate();

        showRainRadar();
      };
  }

  /* =======================================================
     ACTIVE NAV
     ======================================================= */

  function activate() {
    active = true;

    document
      .querySelectorAll(
        ".nav .n"
      )
      .forEach(button => {
        button.classList.remove(
          "active"
        );
      });

    if (rainRadarNav) {
      rainRadarNav.classList.add(
        "active"
      );
    }

    /*
     * Выключаем другие продукты,
     * если они предоставляют публичные
     * функции остановки.
     */

    try {
      if (
        typeof window.CLOradStopRadar ===
        "function"
      ) {
        window.CLOradStopRadar();
      }
    } catch {}

    try {
      if (
        typeof window.CLOradDeactivateGIF ===
        "function"
      ) {
        window.CLOradDeactivateGIF();
      }
    } catch {}
  }

  /* =======================================================
     TILE URL
     ======================================================= */

  function tileUrl(timestamp) {
    return (
      `${API}` +
      `?timestamp=${encodeURIComponent(timestamp)}` +
      `&z={z}` +
      `&x={x}` +
      `&y={y}`
    );
  }

  /* =======================================================
     CREATE LAYER
     ======================================================= */

  function createLayer(timestamp) {
    const map =
      getMap();

    if (!map) {
      throw new Error(
        "Leaflet map не найден"
      );
    }

    if (rainRadarLayer) {
      try {
        map.removeLayer(
          rainRadarLayer
        );
      } catch {}
    }

    rainRadarLayer =
      L.tileLayer(
        tileUrl(timestamp),
        {
          bounds:
            RR_BOUNDS,

          minZoom:
            MIN_ZOOM,

          minNativeZoom:
            MIN_NATIVE_ZOOM,

          maxNativeZoom:
            MAX_NATIVE_ZOOM,

          maxZoom:
            MAX_ZOOM,

          noWrap:
            true,

          zIndex:
            620,

          keepBuffer:
            2,

          updateWhenIdle:
            true,

          updateWhenZooming:
            false,

          crossOrigin:
            true,

          errorTileUrl:
            ""
        }
      );

    rainRadarLayer.addTo(
      map
    );

    return rainRadarLayer;
  }

  /* =======================================================
     LOAD FRAMES
     ======================================================= */

  async function loadFrames() {
    const response =
      await fetch(
        `${API}?manifest=1&t=${Date.now()}`,
        {
          cache: "no-store"
        }
      );

    let data = null;

    try {
      data =
        await response.json();
    } catch {
      throw new Error(
        `RainRadar API вернул HTTP ${response.status}`
      );
    }

    if (
      !response.ok ||
      !data ||
      data.ok === false
    ) {
      throw new Error(
        data?.error ||
        `RainRadar API HTTP ${response.status}`
      );
    }

    const frames =
      Array.isArray(data.frames)
        ? data.frames
        : [];

    if (!frames.length) {
      throw new Error(
        "RainRadar не вернул кадры"
      );
    }

    timestamps =
      frames
        .map(Number)
        .filter(
          value =>
            Number.isFinite(value)
        )
        .sort(
          (a, b) => a - b
        );

    if (!timestamps.length) {
      throw new Error(
        "Не удалось получить timestamp RainRadar"
      );
    }

    return timestamps;
  }

  /* =======================================================
     SHOW
     ======================================================= */

  async function showRainRadar() {
    if (loading) {
      return;
    }

    const map =
      getMap();

    if (!map) {
      showMessage(
        "Карта ещё не готова"
      );

      return;
    }

    loading = true;

    showMessage(
      "Загрузка RainRadar..."
    );

    try {
      await loadFrames();

      currentIndex =
        timestamps.length - 1;

      const timestamp =
        timestamps[currentIndex];

      createLayer(
        timestamp
      );

      updateTimeline();

      startRefresh();

      showMessage(
        "RainRadar загружен"
      );
    } catch (error) {
      console.error(
        "RainRadar:",
        error
      );

      showMessage(
        error?.message ||
        "Ошибка загрузки RainRadar"
      );
    } finally {
      loading = false;
    }
  }

  /* =======================================================
     SET FRAME
     ======================================================= */

  function setFrame(index) {
    if (
      !timestamps.length
    ) {
      return;
    }

    index =
      Math.max(
        0,
        Math.min(
          timestamps.length - 1,
          Number(index)
        )
      );

    currentIndex =
      index;

    const timestamp =
      timestamps[currentIndex];

    createLayer(
      timestamp
    );

    updateTimeline();
  }

  /* =======================================================
     TIMELINE
     ======================================================= */

  function updateTimeline() {
    const range =
      document.querySelector(
        ".timeline input[type='range']"
      );

    if (!range) {
      return;
    }

    range.min =
      "0";

    range.max =
      String(
        Math.max(
          0,
          timestamps.length - 1
        )
      );

    range.step =
      "1";

    range.value =
      String(
        Math.max(
          0,
          currentIndex
        )
      );
  }

  function hookTimeline() {
    const range =
      document.querySelector(
        ".timeline input[type='range']"
      );

    if (!range) {
      return;
    }

    if (
      range.dataset.rainRadarHooked
    ) {
      return;
    }

    range.dataset.rainRadarHooked =
      "1";

    range.addEventListener(
      "input",
      () => {
        if (!active) {
          return;
        }

        setFrame(
          Number(
            range.value
          )
        );
      }
    );
  }

  /* =======================================================
     AUTO REFRESH
     ======================================================= */

  function startRefresh() {
    stopRefresh();

    refreshTimer =
      setInterval(
        async () => {
          if (!active) {
            return;
          }

          try {
            const oldLatest =
              timestamps[
                timestamps.length - 1
              ];

            await loadFrames();

            const newLatest =
              timestamps[
                timestamps.length - 1
              ];

            /*
             * Если появился новый кадр,
             * сразу переключаемся на него.
             */

            if (
              newLatest !==
              oldLatest
            ) {
              currentIndex =
                timestamps.length - 1;

              createLayer(
                newLatest
              );

              updateTimeline();

              showMessage(
                "RainRadar: новый кадр"
              );
            }
          } catch (
            error
          ) {
            console.warn(
              "RainRadar refresh:",
              error
            );
          }
        },
        REFRESH_TIME
      );
  }

  function stopRefresh() {
    if (
      refreshTimer
    ) {
      clearInterval(
        refreshTimer
      );

      refreshTimer =
        null;
    }
  }

  /* =======================================================
     PUBLIC STOP
     ======================================================= */

  function stop() {
    active = false;

    stopRefresh();

    const map =
      getMap();

    if (
      map &&
      rainRadarLayer
    ) {
      try {
        map.removeLayer(
          rainRadarLayer
        );
      } catch {}
    }

    rainRadarLayer =
      null;
  }

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    createNav();

    hookTimeline();

    /*
     * Timeline в index.html может
     * появиться позже.
     */

    setTimeout(
      hookTimeline,
      500
    );

    setTimeout(
      hookTimeline,
      1500
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRainRadar = {
    show:
      showRainRadar,

    stop,

    reload:
      showRainRadar,

    getFrames:
      () => timestamps.slice(),

    getCurrent:
      () =>
        timestamps[
          currentIndex
        ] || null
  };

})();
