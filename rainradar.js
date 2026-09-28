/* =========================================================
   CLOrad — RainRadar Russia Composite
   Автоматический timestamp
   Canvas colorizer
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

  /*
   * ВАЖНО:
   * Палитра RGMC ОЯ не изменяется.
   */

  const RGMC_OY_PALETTE = [
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
   * 0 = прозрачность.
   *
   * Остальной диапазон 1–255
   * распределяется равномерно по
   * всем 19 цветовым уровням.
   *
   * Это не даёт искусственно усиливать
   * или ослаблять отдельные значения.
   */

  const COLOR_LEVELS =
    RGMC_OY_PALETTE.length;

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
     COLOR HELPERS
     ======================================================= */

  function hexToRGB(hex) {
    return {
      r: parseInt(
        hex.slice(1, 3),
        16
      ),

      g: parseInt(
        hex.slice(3, 5),
        16
      ),

      b: parseInt(
        hex.slice(5, 7),
        16
      )
    };
  }

  const PALETTE_RGB =
    RGMC_OY_PALETTE.map(
      hexToRGB
    );

  /*
   * Преобразование исходного серого
   * значения RainRadar в цвет.
   *
   * 0   -> прозрачный
   * 1   -> первый цвет
   * 255 -> последний цвет
   *
   * Используется полный диапазон 1–255.
   */

  function valueToPaletteIndex(
    value
  ) {
    if (
      value <= 0
    ) {
      return -1;
    }

    const index =
      Math.floor(
        (
          (value - 1) *
          COLOR_LEVELS
        ) / 255
      );

    return Math.max(
      0,
      Math.min(
        COLOR_LEVELS - 1,
        index
      )
    );
  }

  /* =======================================================
     COLORIZE TILE
     ======================================================= */

  function colorizeImage(
    image
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      image.naturalWidth ||
      256;

    canvas.height =
      image.naturalHeight ||
      256;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );

    if (!ctx) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    /*
     * КРИТИЧНО:
     * никаких сглаживаний.
     * Каждый исходный пиксель
     * остаётся квадратным.
     */

    ctx.imageSmoothingEnabled =
      false;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    /*
     * Рисуем PNG 1:1.
     * Никакого масштабирования.
     */

    ctx.drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    /*
     * PNG RainRadar — grayscale.
     *
     * Берём красный канал как
     * значение интенсивности.
     */

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {

      const value =
        data[i];

      /*
       * Чёрный фон полностью убираем.
       */

      if (
        value <= 0
      ) {
        data[i + 3] =
          0;

        continue;
      }

      const paletteIndex =
        valueToPaletteIndex(
          value
        );

      if (
        paletteIndex < 0
      ) {
        data[i + 3] =
          0;

        continue;
      }

      const color =
        PALETTE_RGB[
          paletteIndex
        ];

      /*
       * Непрозрачный цвет.
       * Без смешивания с фоном.
       */

      data[i] =
        color.r;

      data[i + 1] =
        color.g;

      data[i + 2] =
        color.b;

      data[i + 3] =
        255;
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
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
      document.createElement(
        "button"
      );

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
     * Выключаем другие продукты.
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

  function tileUrl(
    timestamp
  ) {

    return (
      `${API}` +
      `?timestamp=${encodeURIComponent(timestamp)}` +
      `&z={z}` +
      `&x={x}` +
      `&y={y}`
    );

  }

  /* =======================================================
     RAINRADAR CANVAS TILE LAYER
     ======================================================= */

  const RainRadarLayer =
    L.GridLayer.extend({

      createTile:
        function(
          coords,
          done
        ) {

          const tile =
            document.createElement(
              "canvas"
            );

          tile.width =
            256;

          tile.height =
            256;

          tile.style.width =
            "256px";

          tile.style.height =
            "256px";

          /*
           * Запрещаем браузеру
           * сглаживать изображение.
           */

          tile.style.imageRendering =
            "pixelated";

          const ctx =
            tile.getContext(
              "2d",
              {
                willReadFrequently:
                  true
              }
            );

          if (!ctx) {

            done(
              new Error(
                "Canvas 2D недоступен"
              ),
              tile
            );

            return tile;
          }

          ctx.imageSmoothingEnabled =
            false;

          const timestamp =
            this.options.timestamp;

          const url =
            tileUrl(
              timestamp
            )
              .replace(
                "{z}",
                coords.z
              )
              .replace(
                "{x}",
                coords.x
              )
              .replace(
                "{y}",
                coords.y
              );

          const image =
            new Image();

          image.crossOrigin =
            "anonymous";

          image.decoding =
            "async";

          image.onload =
            () => {

              try {

                const colored =
                  colorizeImage(
                    image
                  );

                /*
                 * Копируем уже
                 * раскрашенный Canvas
                 * в Leaflet tile.
                 */

                ctx.clearRect(
                  0,
                  0,
                  256,
                  256
                );

                ctx.imageSmoothingEnabled =
                  false;

                ctx.drawImage(
                  colored,
                  0,
                  0,
                  256,
                  256
                );

                done(
                  null,
                  tile
                );

              } catch (error) {

                console.error(
                  "RainRadar tile:",
                  error
                );

                done(
                  error,
                  tile
                );

              }

            };

          image.onerror =
            () => {

              done(
                new Error(
                  "RainRadar tile unavailable"
                ),
                tile
              );

            };

          image.src =
            url;

          return tile;
        }

    });

  /* =======================================================
     CREATE LAYER
     ======================================================= */

  function createLayer(
    timestamp
  ) {

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
      new RainRadarLayer({

        tileSize:
          256,

        bounds:
          RR_BOUNDS,

        minZoom:
          MIN_ZOOM,

        maxZoom:
          MAX_ZOOM,

        minNativeZoom:
          MIN_NATIVE_ZOOM,

        maxNativeZoom:
          MAX_NATIVE_ZOOM,

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

        timestamp:
          timestamp

      });

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
          cache:
            "no-store"
        }
      );

    let data =
      null;

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
      Array.isArray(
        data.frames
      )
        ? data.frames
        : [];

    if (
      !frames.length
    ) {

      throw new Error(
        "RainRadar не вернул кадры"
      );

    }

    /*
     * API возвращает:
     *
     * {
     *   timestamp: 1790617200,
     *   time: "..."
     * }
     */

    timestamps =
      frames
        .map(
          frame => {

            if (
              typeof frame ===
                "number" ||
              typeof frame ===
                "string"
            ) {

              return Number(
                frame
              );

            }

            return Number(
              frame?.timestamp
            );

          }
        )
        .filter(
          value =>
            Number.isFinite(
              value
            )
        )
        .sort(
          (a, b) =>
            a - b
        );

    if (
      !timestamps.length
    ) {

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

    loading =
      true;

    showMessage(
      "Загрузка RainRadar..."
    );

    try {

      await loadFrames();

      currentIndex =
        timestamps.length - 1;

      const timestamp =
        timestamps[
          currentIndex
        ];

      createLayer(
        timestamp
      );

      updateTimeline();

      startRefresh();

      showMessage(
        "RainRadar загружен"
      );

    } catch (
      error
    ) {

      console.error(
        "RainRadar:",
        error
      );

      showMessage(
        error?.message ||
        "Ошибка загрузки RainRadar"
      );

    } finally {

      loading =
        false;

    }
  }

  /* =======================================================
     SET FRAME
     ======================================================= */

  function setFrame(
    index
  ) {

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
      timestamps[
        currentIndex
      ];

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
      range.dataset
        .rainRadarHooked
    ) {
      return;
    }

    range.dataset
      .rainRadarHooked =
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

    active =
      false;

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
      () =>
        timestamps.slice(),

    getCurrent:
      () =>
        timestamps[
          currentIndex
        ] || null

  };

})();
