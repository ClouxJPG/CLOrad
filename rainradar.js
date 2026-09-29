/* =========================================================
   CLOrad — RainRadar Russia Composite

   RainRadar:
   - grayscale source
   - RGMC ОЯ palette
   - black = transparent
   - nearest-neighbor / pixelated rendering
   - square pixels
   - atomic frame loading
   - frame timeline
   - playback
   - automatic refresh

   Настройки:
   - Накрутка RainRadar: 1..30
   - По умолчанию: 15
   - Изменение применяется кнопкой "Применить"

   ВАЖНО:
   index.html НЕ изменяется.
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const API =
    "/api/rainradar";

  const RR_BOUNDS = [
    [35, 15],
    [72, 180]
  ];

  const MIN_ZOOM =
    3;

  const MIN_NATIVE_ZOOM =
    3;

  const MAX_NATIVE_ZOOM =
    5;

  const MAX_ZOOM =
    14;

  const REFRESH_TIME =
    60 * 1000;

  /* =======================================================
     RAINRADAR BOOST
     ======================================================= */

  const BOOST_MIN =
    1;

  const BOOST_MAX =
    30;

  const BOOST_DEFAULT =
    15;

  const BOOST_STORAGE_KEY =
    "clorad_rainradar_boost";

  /*
   * Применённое значение.
   * Именно оно используется для карты.
   */

  let rainRadarBoost =
    loadBoost();

  /*
   * Выбранное значение в настройках.
   *
   * Может отличаться от применённого,
   * пока пользователь не нажал "Применить".
   */

  let selectedBoost =
    rainRadarBoost;

  function loadBoost() {

    try {

      const stored =
        Number(
          localStorage.getItem(
            BOOST_STORAGE_KEY
          )
        );

      if (
        Number.isFinite(stored)
      ) {

        return Math.max(
          BOOST_MIN,
          Math.min(
            BOOST_MAX,
            Math.round(stored)
          )
        );

      }

    } catch {}

    return BOOST_DEFAULT;
  }

  function saveBoost(
    value
  ) {

    try {

      localStorage.setItem(
        BOOST_STORAGE_KEY,
        String(value)
      );

    } catch {}

  }

  /* =======================================================
     RGMC ОЯ PALETTE
     НЕ ИЗМЕНЯТЬ
     ======================================================= */

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

  const COLOR_LEVELS =
    RGMC_OY_PALETTE.length;

  const PALETTE_RGB =
    RGMC_OY_PALETTE.map(
      hex => ({
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
      })
    );

  /* =======================================================
     STATE
     ======================================================= */

  let rainRadarNav =
    null;

  let rainRadarLayer =
    null;

  let timestamps =
    [];

  let currentIndex =
    -1;

  let active =
    false;

  let loading =
    false;

  let refreshTimer =
    null;

  let playbackTimer =
    null;

  let playback =
    false;

  let requestId =
    0;

  let suppressTimelineInput =
    false;

  let settingsControl =
    null;

  /*
   * Исходные grayscale-данные.
   *
   * timestamp/z/x/y -> ImageData
   */

  const grayscaleCache =
    new Map();

  /*
   * Цветные тайлы.
   *
   * timestamp/z/x/y/boost -> canvas
   */

  const coloredCache =
    new Map();

  const MAX_CACHE_ITEMS =
    600;

  /* =======================================================
     BASIC HELPERS
     ======================================================= */

  function $(id) {
    return document.getElementById(id);
  }

  function getMap() {
    return window.map || null;
  }

  function showMessage(
    text
  ) {

    if (
      typeof window.msg ===
      "function"
    ) {

      window.msg(text);

      return;
    }

    const el =
      document.createElement(
        "div"
      );

    el.textContent =
      text;

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

    document.body.appendChild(
      el
    );

    setTimeout(
      () => el.remove(),
      2200
    );
  }

  /* =======================================================
     FORCE SHARP LEAFLET RENDERING
     ======================================================= */

  function installSharpRendering() {

    if (
      document.getElementById(
        "cloradRainRadarSharpCSS"
      )
    ) {

      return;

    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "cloradRainRadarSharpCSS";

    style.textContent = `
      /*
       * RainRadar:
       * запрещаем сглаживание raster-тайлов.
       */

      .leaflet-layer canvas,
      .leaflet-tile-container canvas,
      .leaflet-tile-container img,
      .leaflet-image-layer {
        image-rendering:
          pixelated !important;

        image-rendering:
          -moz-crisp-edges !important;

        -ms-interpolation-mode:
          nearest-neighbor !important;
      }

      /*
       * Canvas самого RainRadar.
       */

      canvas.clorad-rainradar-tile {
        image-rendering:
          pixelated !important;

        image-rendering:
          -moz-crisp-edges !important;

        -ms-interpolation-mode:
          nearest-neighbor !important;

        backface-visibility:
          hidden !important;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     CACHE MANAGEMENT
     ======================================================= */

  function trimMapCache(
    cache
  ) {

    while (
      cache.size >
      MAX_CACHE_ITEMS
    ) {

      const first =
        cache.keys().next().value;

      if (
        first === undefined
      ) {

        break;

      }

      cache.delete(
        first
      );

    }

  }

  /* =======================================================
     BOOST CURVE
     ======================================================= */

  /*
   * RainRadar grayscale имеет большую
   * часть значений в нижнем диапазоне.
   *
   * Поэтому накрутка управляет gamma-кривой.
   *
   * 1  -> почти линейно
   * 15 -> стандартное усиление
   * 30 -> максимальное усиление
   */

  function getGamma(
    boost
  ) {

    return Math.max(
      0.22,
      1.02 -
      (
        boost *
        0.033
      )
    );
  }

  function boostValue(
    value
  ) {

    if (
      value <= 0
    ) {

      return 0;

    }

    const normalized =
      value / 255;

    const gamma =
      getGamma(
        rainRadarBoost
      );

    const corrected =
      Math.pow(
        normalized,
        gamma
      );

    return Math.max(
      0,
      Math.min(
        255,
        Math.round(
          corrected *
          255
        )
      )
    );
  }

  /* =======================================================
     PALETTE INDEX
     ======================================================= */

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
          value *
          COLOR_LEVELS
        ) / 256
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
     COLORIZE IMAGE DATA
     ======================================================= */

  function colorizeImageData(
    imageData
  ) {

    const width =
      imageData.width;

    const height =
      imageData.height;

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      width;

    canvas.height =
      height;

    canvas.className =
      "clorad-rainradar-tile";

    const ctx =
      canvas.getContext(
        "2d"
      );

    if (
      !ctx
    ) {

      throw new Error(
        "Canvas 2D недоступен"
      );

    }

    ctx.imageSmoothingEnabled =
      false;

    const output =
      new ImageData(
        width,
        height
      );

    const src =
      imageData.data;

    const dst =
      output.data;

    for (
      let i = 0;
      i < src.length;
      i += 4
    ) {

      const sourceValue =
        src[i];

      /*
       * Чёрный фон.
       */

      if (
        sourceValue <= 0
      ) {

        dst[i] =
          0;

        dst[i + 1] =
          0;

        dst[i + 2] =
          0;

        dst[i + 3] =
          0;

        continue;

      }

      /*
       * Накрутка.
       */

      const value =
        boostValue(
          sourceValue
        );

      const paletteIndex =
        valueToPaletteIndex(
          value
        );

      if (
        paletteIndex < 0
      ) {

        dst[i + 3] =
          0;

        continue;

      }

      const color =
        PALETTE_RGB[
          paletteIndex
        ];

      dst[i] =
        color.r;

      dst[i + 1] =
        color.g;

      dst[i + 2] =
        color.b;

      dst[i + 3] =
        255;

    }

    /*
     * Прямая запись пикселей.
     *
     * Никакого resize.
     */

    ctx.putImageData(
      output,
      0,
      0
    );

    return canvas;
  }

  /* =======================================================
     LOAD GRAYSCALE TILE
     ======================================================= */

  function loadGrayscaleTile(
    timestamp,
    coords
  ) {

    const key =
      `${timestamp}/${coords.z}/${coords.x}/${coords.y}`;

    const cached =
      grayscaleCache.get(
        key
      );

    if (
      cached
    ) {

      return Promise.resolve(
        cached
      );

    }

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const image =
          new Image();

        image.crossOrigin =
          "anonymous";

        image.decoding =
          "async";

        image.onload =
          () => {

            try {

              const width =
                image.naturalWidth ||
                256;

              const height =
                image.naturalHeight ||
                256;

              const canvas =
                document.createElement(
                  "canvas"
                );

              canvas.width =
                width;

              canvas.height =
                height;

              const ctx =
                canvas.getContext(
                  "2d",
                  {
                    willReadFrequently:
                      true
                  }
                );

              if (
                !ctx
              ) {

                throw new Error(
                  "Canvas 2D недоступен"
                );

              }

              /*
               * Исходный PNG читается
               * пиксель-в-пиксель.
               */

              ctx.imageSmoothingEnabled =
                false;

              ctx.drawImage(
                image,
                0,
                0
              );

              const imageData =
                ctx.getImageData(
                  0,
                  0,
                  width,
                  height
                );

              grayscaleCache.set(
                key,
                imageData
              );

              trimMapCache(
                grayscaleCache
              );

              resolve(
                imageData
              );

            } catch (
              error
            ) {

              reject(
                error
              );

            }

          };

        image.onerror =
          () => {

            reject(
              new Error(
                "RainRadar tile unavailable"
              )
            );

          };

        image.src =
          tileUrl(
            timestamp,
            coords
          );

      }
    );
  }

  /* =======================================================
     BUILD COLORED TILE
     ======================================================= */

  async function buildColoredTile(
    timestamp,
    coords
  ) {

    const cacheKey =
      `${timestamp}/${coords.z}/${coords.x}/${coords.y}/${rainRadarBoost}`;

    const cached =
      coloredCache.get(
        cacheKey
      );

    if (
      cached
    ) {

      return cached;

    }

    const imageData =
      await loadGrayscaleTile(
        timestamp,
        coords
      );

    const canvas =
      colorizeImageData(
        imageData
      );

    coloredCache.set(
      cacheKey,
      canvas
    );

    trimMapCache(
      coloredCache
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

    if (
      !rainButton
    ) {

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
     ACTIVATE
     ======================================================= */

  function activate() {

    active =
      true;

    stopPlayback();

    document
      .querySelectorAll(
        ".nav .n"
      )
      .forEach(
        button => {

          button.classList.remove(
            "active"
          );

        }
      );

    if (
      rainRadarNav
    ) {

      rainRadarNav.classList.add(
        "active"
      );

    }

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
    timestamp,
    coords
  ) {

    return (
      `${API}` +
      `?timestamp=${encodeURIComponent(timestamp)}` +
      `&z=${coords.z}` +
      `&x=${coords.x}` +
      `&y=${coords.y}`
    );

  }

  /* =======================================================
     RAINRADAR GRID LAYER
     ======================================================= */

  const RainRadarLayer =
    L.GridLayer.extend({

      initialize:
        function(
          options
        ) {

          L.GridLayer.prototype.initialize.call(
            this,
            options
          );

          this._pendingTiles =
            new Set();

          this._failedTiles =
            new Set();

          this._frameReady =
            false;

        },

      /* ---------------------------------------------------
         CREATE TILE
         --------------------------------------------------- */

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

          tile.className =
            "clorad-rainradar-tile";

          /*
           * Максимально резкий raster.
           */

          tile.style.imageRendering =
            "pixelated";

          tile.style.msInterpolationMode =
            "nearest-neighbor";

          tile.style.display =
            "block";

          tile.style.background =
            "transparent";

          const key =
            `${coords.z}:${coords.x}:${coords.y}`;

          this._pendingTiles.add(
            key
          );

          const ctx =
            tile.getContext(
              "2d"
            );

          if (
            !ctx
          ) {

            this._pendingTiles.delete(
              key
            );

            this._failedTiles.add(
              key
            );

            done(
              new Error(
                "Canvas 2D недоступен"
              ),
              tile
            );

            this._checkReady();

            return tile;

          }

          ctx.imageSmoothingEnabled =
            false;

          const timestamp =
            this.options.timestamp;

          buildColoredTile(
            timestamp,
            coords
          )
            .then(
              canvas => {

                /*
                 * Проверяем ещё раз.
                 */

                ctx.imageSmoothingEnabled =
                  false;

                ctx.clearRect(
                  0,
                  0,
                  256,
                  256
                );

                /*
                 * canvas уже 256×256.
                 *
                 * Здесь нет изменения
                 * размера вообще.
                 */

                ctx.drawImage(
                  canvas,
                  0,
                  0
                );

                this._pendingTiles.delete(
                  key
                );

                done(
                  null,
                  tile
                );

                this._checkReady();

              }
            )
            .catch(
              error => {

                console.error(
                  "RainRadar tile:",
                  error
                );

                this._pendingTiles.delete(
                  key
                );

                this._failedTiles.add(
                  key
                );

                done(
                  error,
                  tile
                );

                this._checkReady();

              }
            );

          return tile;

        },

      /* ---------------------------------------------------
         ON ADD
         --------------------------------------------------- */

      onAdd:
        function(
          map
        ) {

          this._frameReady =
            false;

          this._pendingTiles.clear();

          this._failedTiles.clear();

          L.GridLayer.prototype.onAdd.call(
            this,
            map
          );

          /*
           * До полной готовности
           * слой полностью невидим.
           */

          this.setOpacity(
            0
          );

        },

      /* ---------------------------------------------------
         CHECK FRAME
         --------------------------------------------------- */

      _checkReady:
        function() {

          if (
            this._frameReady
          ) {

            return;

          }

          if (
            this._pendingTiles.size !==
            0
          ) {

            return;

          }

          if (
            this._failedTiles.size
          ) {

            this._frameReady =
              true;

            this.fire(
              "frameready",
              {
                ready:
                  false,

                failed:
                  this._failedTiles.size
              }
            );

            return;

          }

          this._frameReady =
            true;

          this.fire(
            "frameready",
            {
              ready:
                true,

              failed:
                0
            }
          );

        }

    });

  /* =======================================================
     CREATE FRAME LAYER
     ======================================================= */

  function createLayer(
    timestamp
  ) {

    const map =
      getMap();

    if (
      !map
    ) {

      throw new Error(
        "Leaflet map не найден"
      );

    }

    const oldLayer =
      rainRadarLayer;

    const layerId =
      ++requestId;

    const layer =
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
          1,

        updateWhenIdle:
          true,

        updateWhenZooming:
          false,

        updateInterval:
          100,

        timestamp:
          timestamp

      });

    layer.setOpacity(
      0
    );

    rainRadarLayer =
      layer;

    layer.once(
      "frameready",
      event => {

        if (
          layerId !==
            requestId ||
          !active
        ) {

          if (
            map.hasLayer(
              layer
            )
          ) {

            map.removeLayer(
              layer
            );

          }

          return;

        }

        if (
          !event.ready
        ) {

          if (
            map.hasLayer(
              layer
            )
          ) {

            map.removeLayer(
              layer
            );

          }

          if (
            rainRadarLayer ===
            layer
          ) {

            rainRadarLayer =
              oldLayer ||
              null;

          }

          showMessage(
            "Кадр RainRadar загружен не полностью"
          );

          return;

        }

        /*
         * Весь кадр готов.
         *
         * Только теперь показываем.
         */

        layer.setOpacity(
          1
        );

        /*
         * Старый кадр удаляем
         * после появления нового.
         */

        if (
          oldLayer &&
          oldLayer !== layer &&
          map.hasLayer(
            oldLayer
          )
        ) {

          map.removeLayer(
            oldLayer
          );

        }

      }
    );

    layer.addTo(
      map
    );

    return layer;
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

    let data;

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
     SHOW RAINRADAR
     ======================================================= */

  async function showRainRadar() {

    if (
      loading
    ) {

      return;

    }

    const map =
      getMap();

    if (
      !map
    ) {

      showMessage(
        "Карта ещё не готова"
      );

      return;

    }

    loading =
      true;

    stopPlayback();

    showMessage(
      "Загрузка RainRadar..."
    );

    try {

      await loadFrames();

      currentIndex =
        timestamps.length - 1;

      updateTimeline();

      await setFrame(
        currentIndex
      );

      startRefresh();

      showMessage(
        `RainRadar загружен · накрутка ${rainRadarBoost}`
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

  async function setFrame(
    index
  ) {

    if (
      !timestamps.length ||
      !active
    ) {

      return false;

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

    updateTimeline();

    const timestamp =
      timestamps[
        currentIndex
      ];

    const layer =
      createLayer(
        timestamp
      );

    return new Promise(
      resolve => {

        let finished =
          false;

        const finish =
          event => {

            if (
              finished
            ) {

              return;

            }

            finished =
              true;

            resolve(
              event.ready
            );

          };

        layer.once(
          "frameready",
          finish
        );

        if (
          layer._frameReady
        ) {

          finish({
            ready:
              layer._failedTiles.size ===
              0
          });

        }

      }
    );

  }

  /* =======================================================
     TIMELINE
     ======================================================= */

  function updateTimeline() {

    const range =
      document.querySelector(
        ".timeline input[type='range']"
      );

    if (
      !range
    ) {

      return;

    }

    suppressTimelineInput =
      true;

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

    range.disabled =
      timestamps.length <= 1;

    suppressTimelineInput =
      false;

  }

  /* =======================================================
     PLAY BUTTON
     ======================================================= */

  function findPlayButton() {

    const timeline =
      document.querySelector(
        ".timeline"
      );

    if (
      !timeline
    ) {

      return null;

    }

    return timeline.querySelector(
      [
        "button",
        ".play",
        "[data-action='play']",
        "[aria-label*='play' i]"
      ].join(",")
    );

  }

  function updatePlayButton() {

    const button =
      findPlayButton();

    if (
      !button
    ) {

      return;

    }

    button.classList.toggle(
      "active",
      playback
    );

    button.setAttribute(
      "aria-pressed",
      playback
        ? "true"
        : "false"
    );

  }

  /* =======================================================
     STOP PLAYBACK
     ======================================================= */

  function stopPlayback() {

    playback =
      false;

    if (
      playbackTimer
    ) {

      clearInterval(
        playbackTimer
      );

    }

    playbackTimer =
      null;

    updatePlayButton();

  }

  /* =======================================================
     START PLAYBACK
     ======================================================= */

  function startPlayback() {

    if (
      timestamps.length < 2 ||
      !active
    ) {

      return;

    }

    stopPlayback();

    playback =
      true;

    updatePlayButton();

    playbackTimer =
      setInterval(
        async () => {

          if (
            !active
          ) {

            stopPlayback();

            return;

          }

          const next =
            currentIndex >=
            timestamps.length - 1
              ? 0
              : currentIndex + 1;

          await setFrame(
            next
          );

        },
        700
      );

  }

  /* =======================================================
     TOGGLE PLAYBACK
     ======================================================= */

  function togglePlayback() {

    if (
      playback
    ) {

      stopPlayback();

    } else {

      startPlayback();

    }

  }

  /* =======================================================
     TIMELINE HOOK
     ======================================================= */

  function hookTimeline() {

    const range =
      document.querySelector(
        ".timeline input[type='range']"
      );

    if (
      range &&
      !range.dataset.rainRadarHooked
    ) {

      range.dataset.rainRadarHooked =
        "1";

      range.addEventListener(
        "input",
        () => {

          if (
            !active ||
            suppressTimelineInput
          ) {

            return;

          }

          stopPlayback();

          setFrame(
            Number(
              range.value
            )
          );

        }
      );

    }

    const timeline =
      document.querySelector(
        ".timeline"
      );

    if (
      timeline &&
      !timeline.dataset.rainRadarPlayHooked
    ) {

      const buttons =
        timeline.querySelectorAll(
          [
            "button",
            ".play",
            "[data-action='play']",
            "[aria-label*='play' i]"
          ].join(",")
        );

      if (
        buttons.length
      ) {

        buttons[0].addEventListener(
          "click",
          event => {

            if (
              !active
            ) {

              return;

            }

            event.preventDefault();

            event.stopPropagation();

            togglePlayback();

          }
        );

        timeline.dataset.rainRadarPlayHooked =
          "1";

      }

    }

    updateTimeline();

  }

  /* =======================================================
     RAINRADAR SETTINGS
     ======================================================= */

  function findSettingsContainer() {

    return $(
      "settings"
    );

  }

  function createRainRadarSettings() {

    const settings =
      findSettingsContainer();

    if (
      !settings
    ) {

      return;

    }

    /*
     * Не создаём второй раз.
     */

    let existing =
      settings.querySelector(
        "#cloradRainRadarSetting"
      );

    if (
      existing
    ) {

      settingsControl =
        existing;

      syncBoostUI();

      return;

    }

    /*
     * Используем ту же структуру,
     * что и существующий "Кол. кадров".
     */

    const setting =
      document.createElement(
        "div"
      );

    setting.className =
      "setting";

    setting.id =
      "cloradRainRadarSetting";

    const head =
      document.createElement(
        "button"
      );

    head.className =
      "settingHead";

    head.type =
      "button";

    head.innerHTML =
      `
        <span>Накрутка RainRadar</span>
        <span
          class="settingArrow"
          id="cloradRainRadarArrow"
        >›</span>
      `;

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "settingBody";

    const info =
      document.createElement(
        "div"
      );

    info.className =
      "framesInfo";

    info.style.marginBottom =
      "9px";

    info.textContent =
      "Усиление интенсивности данных";

    const valueRow =
      document.createElement(
        "div"
      );

    valueRow.style.cssText =
      [
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "margin-bottom:8px",
        "font-size:13px"
      ].join(";");

    const selectedText =
      document.createElement(
        "span"
      );

    selectedText.textContent =
      "Выбрано:";

    const selectedValue =
      document.createElement(
        "strong"
      );

    selectedValue.id =
      "cloradRainRadarBoostValue";

    selectedValue.textContent =
      String(
        selectedBoost
      );

    selectedValue.style.cssText =
      [
        "font-size:16px",
        "font-variant-numeric:tabular-nums",
        "min-width:28px",
        "text-align:right",
        "color:#53e39b"
      ].join(";");

    valueRow.appendChild(
      selectedText
    );

    valueRow.appendChild(
      selectedValue
    );

    const range =
      document.createElement(
        "input"
      );

    range.type =
      "range";

    range.id =
      "cloradRainRadarBoostRange";

    range.min =
      String(
        BOOST_MIN
      );

    range.max =
      String(
        BOOST_MAX
      );

    range.step =
      "1";

    range.value =
      String(
        selectedBoost
      );

    range.style.cssText =
      [
        "width:100%",
        "display:block",
        "margin:3px 0 4px",
        "accent-color:#53e39b"
      ].join(";");

    const scale =
      document.createElement(
        "div"
      );

    scale.style.cssText =
      [
        "display:flex",
        "justify-content:space-between",
        "font-size:10px",
        "color:#858e95",
        "margin-bottom:10px"
      ].join(";");

    const min =
      document.createElement(
        "span"
      );

    min.textContent =
      "1";

    const max =
      document.createElement(
        "span"
      );

    max.textContent =
      "30";

    scale.appendChild(
      min
    );

    scale.appendChild(
      max
    );

    const apply =
      document.createElement(
        "button"
      );

    apply.id =
      "cloradRainRadarBoostApply";

    apply.type =
      "button";

    apply.textContent =
      "Применить";

    apply.style.cssText =
      [
        "width:100%",
        "height:40px",
        "border:1px solid #3d8e6a",
        "border-radius:8px",
        "background:#194c38",
        "color:#eafff5",
        "font-size:14px",
        "font-weight:600",
        "cursor:pointer"
      ].join(";");

    body.appendChild(
      info
    );

    body.appendChild(
      valueRow
    );

    body.appendChild(
      range
    );

    body.appendChild(
      scale
    );

    body.appendChild(
      apply
    );

    setting.appendChild(
      head
    );

    setting.appendChild(
      body
    );

    /*
     * Ставим после "Кол. кадров".
     */

    const framesSetting =
      settings.querySelector(
        "#framesSetting"
      );

    if (
      framesSetting &&
      framesSetting.parentElement ===
        settings
    ) {

      framesSetting.insertAdjacentElement(
        "afterend",
        setting
      );

    } else {

      settings.appendChild(
        setting
      );

    }

    settingsControl =
      setting;

    /*
     * Раскрытие/скрытие.
     */

    head.addEventListener(
      "click",
      event => {

        event.preventDefault();

        event.stopPropagation();

        setting.classList.toggle(
          "open"
        );

      }
    );

    /*
     * Выбор значения.
     *
     * Только меняем выбранное значение.
     * Карта пока НЕ меняется.
     */

    range.addEventListener(
      "input",
      () => {

        selectedBoost =
          Math.max(
            BOOST_MIN,
            Math.min(
              BOOST_MAX,
              Math.round(
                Number(
                  range.value
                )
              )
            )
          );

        selectedValue.textContent =
          String(
            selectedBoost
          );

      }
    );

    /*
     * ПРИМЕНИТЬ.
     */

    apply.addEventListener(
      "click",
      event => {

        event.preventDefault();

        event.stopPropagation();

        applyBoost();

      }
    );

    syncBoostUI();

  }

  /* =======================================================
     SYNC BOOST SETTINGS UI
     ======================================================= */

  function syncBoostUI() {

    const range =
      document.getElementById(
        "cloradRainRadarBoostRange"
      );

    const value =
      document.getElementById(
        "cloradRainRadarBoostValue"
      );

    if (
      range
    ) {

      range.value =
        String(
          selectedBoost
        );

    }

    if (
      value
    ) {

      value.textContent =
        String(
          selectedBoost
        );

    }

  }

  /* =======================================================
     APPLY BOOST
     ======================================================= */

  function applyBoost() {

    if (
      selectedBoost ===
      rainRadarBoost
    ) {

      showMessage(
        `Накрутка RainRadar: ${rainRadarBoost}`
      );

      return;

    }

    /*
     * Теперь выбранное значение
     * становится применённым.
     */

    rainRadarBoost =
      selectedBoost;

    saveBoost(
      rainRadarBoost
    );

    /*
     * Все цветные версии
     * старой настройки больше не нужны.
     */

    coloredCache.clear();

    /*
     * Перерисовываем текущий кадр
     * без повторной загрузки PNG.
     */

    refreshCurrentFrameInstant();

    showMessage(
      `Накрутка RainRadar применена: ${rainRadarBoost}`
    );

  }

  /* =======================================================
     INSTANT CURRENT FRAME REFRESH
     ======================================================= */

  function refreshCurrentFrameInstant() {

    if (
      !active ||
      currentIndex < 0 ||
      !timestamps.length
    ) {

      return;

    }

    const timestamp =
      timestamps[
        currentIndex
      ];

    const layer =
      rainRadarLayer;

    if (
      !layer ||
      !layer._tiles
    ) {

      setFrame(
        currentIndex
      );

      return;

    }

    const tiles =
      Object.values(
        layer._tiles
      );

    /*
     * Если нет тайлов,
     * обычное переключение.
     */

    if (
      !tiles.length
    ) {

      setFrame(
        currentIndex
      );

      return;

    }

    /*
     * Сохраняем старый кадр
     * до полной перекраски.
     */

    layer.setOpacity(
      0
    );

    let pending =
      tiles.length;

    let failed =
      false;

    for (
      const item of tiles
    ) {

      const tile =
        item.el;

      const coords =
        item.coords;

      if (
        !tile ||
        !coords
      ) {

        pending--;

        continue;

      }

      buildColoredTile(
        timestamp,
        coords
      )
        .then(
          canvas => {

            const ctx =
              tile.getContext(
                "2d"
              );

            if (
              !ctx
            ) {

              failed =
                true;

              pending--;

              return;

            }

            ctx.imageSmoothingEnabled =
              false;

            ctx.clearRect(
              0,
              0,
              256,
              256
            );

            ctx.drawImage(
              canvas,
              0,
              0
            );

            pending--;

            if (
              pending <= 0
            ) {

              /*
               * Все тайлы перекрашены.
               */

              layer.setOpacity(
                failed
                  ? 0
                  : 1
              );

            }

          }
        )
        .catch(
          error => {

            console.warn(
              "RainRadar boost:",
              error
            );

            failed =
              true;

            pending--;

            if (
              pending <= 0
            ) {

              layer.setOpacity(
                1
              );

            }

          }
        );

    }

  }

  /* =======================================================
     AUTO REFRESH
     ======================================================= */

  function startRefresh() {

    stopRefresh();

    refreshTimer =
      setInterval(
        async () => {

          if (
            !active ||
            loading
          ) {

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

              const wasPlaying =
                playback;

              if (
                wasPlaying
              ) {

                stopPlayback();

              }

              currentIndex =
                timestamps.length - 1;

              updateTimeline();

              await setFrame(
                currentIndex
              );

              if (
                wasPlaying
              ) {

                startPlayback();

              }

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

  /* =======================================================
     STOP REFRESH
     ======================================================= */

  function stopRefresh() {

    if (
      refreshTimer
    ) {

      clearInterval(
        refreshTimer
      );

    }

    refreshTimer =
      null;

  }

  /* =======================================================
     STOP
     ======================================================= */

  function stop() {

    active =
      false;

    stopPlayback();

    stopRefresh();

    ++requestId;

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

    /*
     * Сначала ставим резкий raster.
     */

    installSharpRendering();

    createNav();

    hookTimeline();

    /*
     * Настройки создаются
     * внутри существующего #settings.
     */

    createRainRadarSettings();

    setTimeout(
      () => {

        hookTimeline();

        createRainRadarSettings();

      },
      300
    );

    setTimeout(
      () => {

        hookTimeline();

        createRainRadarSettings();

      },
      800
    );

    setTimeout(
      () => {

        hookTimeline();

        createRainRadarSettings();

      },
      1500
    );

    setTimeout(
      () => {

        hookTimeline();

        createRainRadarSettings();

      },
      3000
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

    play:
      startPlayback,

    pause:
      stopPlayback,

    getFrames:
      () =>
        timestamps.slice(),

    getCurrent:
      () =>
        timestamps[
          currentIndex
        ] || null,

    getBoost:
      () =>
        rainRadarBoost,

    setBoost:
      value => {

        const next =
          Math.max(
            BOOST_MIN,
            Math.min(
              BOOST_MAX,
              Math.round(
                Number(
                  value
                )
              )
            )
          );

        selectedBoost =
          next;

        syncBoostUI();

        applyBoost();

      }

  };

})();
