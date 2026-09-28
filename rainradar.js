/* =========================================================
   CLOrad — RainRadar Russia Composite
   Canvas colorizer + atomic tile loading + timeline
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

  /* =======================================================
     COLOR CALIBRATION
     ======================================================= */

  /*
   * RainRadar grayscale сильно сжат в нижней части шкалы.
   *
   * Поэтому простое:
   *
   *   1..255 -> 19 цветов
   *
   * давало сильную недооценку.
   *
   * GAMMA < 1 растягивает слабые и средние значения,
   * сохраняя их исходный порядок.
   *
   * 0 остаётся прозрачным.
   */

  const COLOR_GAMMA = 0.52;

  const COLOR_LEVELS =
    RGMC_OY_PALETTE.length;

  /* =======================================================
     PALETTE RGB
     ======================================================= */

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

  let rainRadarNav = null;

  let rainRadarLayer = null;

  let timestamps = [];

  let currentIndex = -1;

  let active = false;

  let loading = false;

  let refreshTimer = null;

  let playbackTimer = null;

  let playback = false;

  let requestId = 0;

  let suppressTimelineInput =
    false;

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
      "position:fixed;" +
      "z-index:2147483646;" +
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

    document.body.appendChild(
      el
    );

    setTimeout(
      () => el.remove(),
      2200
    );
  }

  /* =======================================================
     COLOR MAPPING
     ======================================================= */

  function colorIndex(
    value
  ) {

    if (
      value <= 0
    ) {
      return -1;
    }

    /*
     * Нормализуем весь диапазон 1..255.
     */

    const normalized =
      (value - 1) / 254;

    /*
     * Гамма-коррекция.
     *
     * Малые значения получают
     * больше цветового диапазона.
     */

    const corrected =
      Math.pow(
        normalized,
        COLOR_GAMMA
      );

    return Math.max(
      0,
      Math.min(
        COLOR_LEVELS - 1,
        Math.floor(
          corrected *
          COLOR_LEVELS
        )
      )
    );
  }

  /* =======================================================
     COLORIZE IMAGE
     ======================================================= */

  function colorizeImage(
    image
  ) {

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

    if (!ctx) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    ctx.imageSmoothingEnabled =
      false;

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    ctx.drawImage(
      image,
      0,
      0,
      width,
      height
    );

    const imageData =
      ctx.getImageData(
        0,
        0,
        width,
        height
      );

    const data =
      imageData.data;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {

      /*
       * RainRadar — grayscale.
       * Берём интенсивность из красного канала.
       */

      const value =
        data[i];

      /*
       * Чёрный фон =
       * полностью прозрачный.
       */

      if (
        value <= 0
      ) {

        data[i + 3] =
          0;

        continue;
      }

      const index =
        colorIndex(
          value
        );

      if (
        index < 0
      ) {

        data[i + 3] =
          0;

        continue;
      }

      const color =
        PALETTE_RGB[
          index
        ];

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
     NAVIGATION
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
     ATOMIC RAINRADAR TILE LAYER
     ======================================================= */

  const RainRadarLayer =
    L.GridLayer.extend({

      initialize:
        function(options) {

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

          /*
           * Нативный размер тайла.
           */

          tile.width =
            256;

          tile.height =
            256;

          tile.style.width =
            "256px";

          tile.style.height =
            "256px";

          tile.style.display =
            "block";

          tile.style.imageRendering =
            "pixelated";

          tile.style.background =
            "transparent";

          const key =
            `${coords.z}:${coords.x}:${coords.y}`;

          this._pendingTiles.add(
            key
          );

          const ctx =
            tile.getContext(
              "2d",
              {
                willReadFrequently:
                  true
              }
            );

          if (!ctx) {

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

          const image =
            new Image();

          image.crossOrigin =
            "anonymous";

          image.decoding =
            "async";

          const finish =
            error => {

              this._pendingTiles.delete(
                key
              );

              if (
                error
              ) {

                this._failedTiles.add(
                  key
                );

              }

              done(
                error,
                tile
              );

              this._checkReady();
            };

          image.onload =
            () => {

              try {

                const colored =
                  colorizeImage(
                    image
                  );

                ctx.imageSmoothingEnabled =
                  false;

                ctx.clearRect(
                  0,
                  0,
                  256,
                  256
                );

                ctx.drawImage(
                  colored,
                  0,
                  0,
                  256,
                  256
                );

                finish(
                  null
                );

              } catch (
                error
              ) {

                console.error(
                  "RainRadar tile:",
                  error
                );

                finish(
                  error
                );

              }

            };

          image.onerror =
            () => {

              finish(
                new Error(
                  "RainRadar tile unavailable"
                )
              );

            };

          image.src =
            tileUrl(
              this.options.timestamp,
              coords
            );

          return tile;
        },

      /* ---------------------------------------------------
         ON ADD
         --------------------------------------------------- */

      onAdd:
        function(map) {

          this._frameReady =
            false;

          this._pendingTiles.clear();

          this._failedTiles.clear();

          L.GridLayer.prototype.onAdd.call(
            this,
            map
          );

          /*
           * Ключевой момент:
           *
           * слой физически уже загружается,
           * но полностью невидим.
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

          /*
           * Пока есть хотя бы один
           * незавершённый тайл —
           * ничего не показываем.
           */

          if (
            this._frameReady ||
            this._pendingTiles.size !== 0
          ) {

            return;
          }

          const tiles =
            Object.values(
              this._tiles || {}
            );

          if (
            !tiles.length
          ) {

            return;
          }

          this._frameReady =
            true;

          /*
           * Если хотя бы один тайл
           * не загрузился — не показываем
           * частично собранный кадр.
           */

          if (
            this._failedTiles.size
          ) {

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

          /*
           * ВСЕ тайлы готовы.
           *
           * Теперь кадр появляется
           * целиком одновременно.
           */

          this.setOpacity(
            1
          );

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

    if (!map) {

      throw new Error(
        "Leaflet map не найден"
      );

    }

    const id =
      ++requestId;

    const oldLayer =
      rainRadarLayer;

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

        /*
         * Небольшой buffer,
         * чтобы не грузить лишние тайлы.
         */

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

    rainRadarLayer =
      layer;

    /*
     * Новый слой невидим,
     * пока полностью не готов.
     */

    layer.setOpacity(
      0
    );

    layer.once(
      "frameready",
      event => {

        /*
         * Если за время загрузки
         * пользователь переключился
         * на другой кадр —
         * этот слой уже не актуален.
         */

        if (
          id !== requestId ||
          !active
        ) {

          return;
        }

        /*
         * Неполный кадр не показываем.
         */

        if (
          !event.ready
        ) {

          showMessage(
            "Не все тайлы кадра загрузились"
          );

          map.removeLayer(
            layer
          );

          if (
            rainRadarLayer ===
            layer
          ) {

            rainRadarLayer =
              oldLayer ||
              null;

          }

          return;
        }

        /*
         * ВСЯ мозаика готова.
         *
         * Показываем её.
         */

        layer.setOpacity(
          1
        );

        /*
         * Только теперь удаляем
         * предыдущий кадр.
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
          Number.isFinite
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

      /*
       * Последний доступный кадр.
       */

      currentIndex =
        timestamps.length - 1;

      updateTimeline();

      await setFrame(
        currentIndex,
        true
      );

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

  async function setFrame(
    index,
    initial = false
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

            if (
              !event.ready &&
              initial
            ) {

              showMessage(
                "Кадр не загружен полностью"
              );

            }

            resolve(
              event.ready
            );
          };

        layer.once(
          "frameready",
          finish
        );

        /*
         * Защита от очень быстрой
         * загрузки первого кадра.
         */

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

    /*
     * Если API вернул один кадр,
     * ползунок физически нечего перематывать.
     */

    range.disabled =
      timestamps.length <= 1;

    suppressTimelineInput =
      false;
  }

  /* =======================================================
     FIND PLAY BUTTON
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

  /* =======================================================
     PLAY BUTTON STATE
     ======================================================= */

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

    /*
     * Интервал между кадрами.
     *
     * Сам кадр появляется только после
     * полной загрузки всех его тайлов.
     */

    playbackTimer =
      setInterval(
        async () => {

          if (
            !active ||
            timestamps.length < 2
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

          /*
           * Ручная перемотка
           * останавливает проигрывание.
           */

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

    /*
     * Отменяем устаревшие
     * асинхронные переключения.
     */

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

    createNav();

    hookTimeline();

    setTimeout(
      hookTimeline,
      300
    );

    setTimeout(
      hookTimeline,
      1000
    );

    setTimeout(
      hookTimeline,
      2000
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
        ] || null

  };

})();
