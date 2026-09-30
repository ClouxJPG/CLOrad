/* =========================================================
   CLOrad — RainRadar 1×1 Pixel Renderer
   ---------------------------------------------------------
   Отдельный визуальный модуль.

   НЕ изменяет:
   - rainradar.js
   - API
   - источник RainRadar
   - ZOOM
   - palette
   - legend
   - timeline
   - frame switching
   - Leaflet geometry
   - данные радара

   Делает:
   - жёсткий nearest-neighbor
   - 256×256 output raster
   - imageSmoothingEnabled = false
   - квадратные пиксели
   - отсутствие blur / interpolation
   - отсутствие CSS scaling artifacts

   ВАЖНО:
   Это визуальный renderer.
   Он не создаёт дополнительную физическую
   пространственную информацию, которой нет
   в исходном PNG RainRadar.
   ========================================================= */

(() => {
  "use strict";

  const STYLE_ID =
    "clorad-rainradar-1x1-style";

  const PATCH_ID =
    "clorad-rainradar-1x1-patch";

  const TILE_SIZE = 256;

  /* =========================================================
     1. CSS
     ========================================================= */

  function installCSS() {

    if (
      document.getElementById(STYLE_ID)
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id = STYLE_ID;

    style.textContent = `

      /* -----------------------------------------
         RainRadar tile canvas
         ----------------------------------------- */

      canvas.clorad-rainradar-tile {

        width: 256px !important;
        height: 256px !important;

        display: block !important;

        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;

        box-sizing: border-box !important;

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          -moz-crisp-edges !important;

        image-rendering:
          -webkit-optimize-contrast !important;

        filter:
          none !important;

        transform:
          none !important;

        transition:
          none !important;

        animation:
          none !important;

        backface-visibility:
          hidden !important;
      }


      /* -----------------------------------------
         Leaflet RainRadar container
         ----------------------------------------- */

      .clorad-rainradar-layer {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;
      }


      .clorad-rainradar-layer
      .leaflet-tile-container {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;
      }


      .clorad-rainradar-layer
      .leaflet-tile {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        filter:
          none !important;

        transition:
          none !important;

        animation:
          none !important;
      }

    `;

    document.head.appendChild(style);
  }


  /* =========================================================
     2. Проверка RainRadar canvas
     ========================================================= */

  function isRainRadarCanvas(
    canvas
  ) {

    if (
      !canvas ||
      !(canvas instanceof HTMLCanvasElement)
    ) {
      return false;
    }

    if (
      canvas.classList.contains(
        "clorad-rainradar-tile"
      )
    ) {
      return true;
    }

    return false;
  }


  /* =========================================================
     3. Жёсткий nearest-neighbor renderer
     ========================================================= */

  function renderNearestNeighbor(
    source,
    destination
  ) {

    if (
      !source ||
      !destination
    ) {
      return false;
    }

    const ctx =
      destination.getContext(
        "2d",
        {
          alpha: true,
          willReadFrequently: false
        }
      );

    if (!ctx) {
      return false;
    }


    /*
     * Всегда отключаем сглаживание.
     */

    ctx.imageSmoothingEnabled = false;


    /*
     * Если исходник уже 256×256,
     * обычный drawImage 1:1 полностью
     * безопасен.
     */

    if (
      source.width === TILE_SIZE &&
      source.height === TILE_SIZE
    ) {

      ctx.save();

      ctx.imageSmoothingEnabled = false;

      ctx.globalCompositeOperation =
        "copy";

      ctx.drawImage(
        source,
        0,
        0,
        TILE_SIZE,
        TILE_SIZE
      );

      ctx.restore();

      return true;
    }


    /*
     * Если исходный raster имеет другой размер,
     * сначала получаем его bitmap.
     */

    let sourceCanvas =
      source;


    /*
     * HTMLImageElement / ImageBitmap /
     * другие drawable-объекты.
     *
     * Переносим их на промежуточный canvas
     * без сглаживания.
     */

    if (
      !(source instanceof HTMLCanvasElement)
    ) {

      const temp =
        document.createElement("canvas");

      temp.width =
        source.naturalWidth ||
        source.width ||
        TILE_SIZE;

      temp.height =
        source.naturalHeight ||
        source.height ||
        TILE_SIZE;

      const tempCtx =
        temp.getContext(
          "2d",
          {
            alpha: true
          }
        );

      if (!tempCtx) {
        return false;
      }

      tempCtx.imageSmoothingEnabled =
        false;

      tempCtx.globalCompositeOperation =
        "copy";

      tempCtx.drawImage(
        source,
        0,
        0,
        temp.width,
        temp.height
      );

      sourceCanvas =
        temp;
    }


    const sw =
      sourceCanvas.width;

    const sh =
      sourceCanvas.height;


    if (
      !sw ||
      !sh
    ) {
      return false;
    }


    /*
     * Получаем исходные пиксели.
     */

    let sourceCtx;

    try {

      sourceCtx =
        sourceCanvas.getContext(
          "2d",
          {
            willReadFrequently: true
          }
        );

    } catch (_) {

      sourceCtx = null;
    }


    if (!sourceCtx) {
      return false;
    }


    let src;

    try {

      src =
        sourceCtx.getImageData(
          0,
          0,
          sw,
          sh
        );

    } catch (_) {

      return false;
    }


    /*
     * Создаём именно 256×256 output raster.
     */

    const output =
      ctx.createImageData(
        TILE_SIZE,
        TILE_SIZE
      );

    const srcData =
      src.data;

    const dstData =
      output.data;


    /*
     * Nearest-neighbor.
     *
     * Никаких:
     * - bilinear
     * - bicubic
     * - interpolation
     * - blur
     *
     * Каждый output pixel получает
     * значение ближайшей исходной ячейки.
     */

    for (
      let y = 0;
      y < TILE_SIZE;
      y++
    ) {

      const sy =
        Math.min(
          sh - 1,
          Math.floor(
            y * sh / TILE_SIZE
          )
        );


      for (
        let x = 0;
        x < TILE_SIZE;
        x++
      ) {

        const sx =
          Math.min(
            sw - 1,
            Math.floor(
              x * sw / TILE_SIZE
            )
          );


        const srcIndex =
          (
            sy * sw +
            sx
          ) * 4;


        const dstIndex =
          (
            y * TILE_SIZE +
            x
          ) * 4;


        dstData[dstIndex] =
          srcData[srcIndex];

        dstData[dstIndex + 1] =
          srcData[srcIndex + 1];

        dstData[dstIndex + 2] =
          srcData[srcIndex + 2];

        dstData[dstIndex + 3] =
          srcData[srcIndex + 3];
      }
    }


    /*
     * Записываем готовый bitmap
     * непосредственно в canvas.
     */

    ctx.save();

    ctx.globalCompositeOperation =
      "copy";

    ctx.imageSmoothingEnabled =
      false;

    ctx.putImageData(
      output,
      0,
      0
    );

    ctx.restore();


    return true;
  }


  /* =========================================================
     4. Защита drawImage только для RainRadar canvas
     ========================================================= */

  function installDrawImagePatch() {

    if (
      window[PATCH_ID]
    ) {
      return;
    }

    if (
      !window.CanvasRenderingContext2D ||
      !CanvasRenderingContext2D.prototype.drawImage
    ) {
      return;
    }


    const originalDrawImage =
      CanvasRenderingContext2D.prototype.drawImage;


    /*
     * Сохраняем оригинал.
     */

    window[PATCH_ID] = {
      original:
        originalDrawImage
    };


    CanvasRenderingContext2D
      .prototype
      .drawImage =
      function (...args) {

        const ctx =
          this;

        const destination =
          ctx.canvas;


        /*
         * Для всех остальных canvas
         * вообще ничего не меняем.
         */

        if (
          !isRainRadarCanvas(
            destination
          )
        ) {

          return originalDrawImage.apply(
            ctx,
            args
          );
        }


        /*
         * RainRadar canvas:
         * отключаем smoothing всегда.
         */

        ctx.imageSmoothingEnabled =
          false;


        /*
         * Нас интересует стандартный
         * drawImage(source, dx, dy, dw, dh)
         */

        const source =
          args[0];


        if (
          !source
        ) {

          return originalDrawImage.apply(
            ctx,
            args
          );
        }


        /*
         * Если вызов не является
         * обычным raster draw,
         * отдаём его оригинальному API.
         */

        if (
          args.length < 3
        ) {

          return originalDrawImage.apply(
            ctx,
            args
          );
        }


        /*
         * Если источник уже 256×256,
         * делаем обычный 1:1 copy.
         */

        const sourceWidth =
          source.naturalWidth ||
          source.videoWidth ||
          source.width;

        const sourceHeight =
          source.naturalHeight ||
          source.videoHeight ||
          source.height;


        if (
          sourceWidth === TILE_SIZE &&
          sourceHeight === TILE_SIZE
        ) {

          ctx.imageSmoothingEnabled =
            false;

          return originalDrawImage.apply(
            ctx,
            args
          );
        }


        /*
         * Для источника другого размера
         * применяем собственный nearest-neighbor.
         *
         * Только если destination —
         * именно RainRadar tile.
         */

        try {

          const ok =
            renderNearestNeighbor(
              source,
              destination
            );

          if (ok) {
            return;
          }

        } catch (_) {
          /*
           * В случае ошибки не ломаем сайт.
           */
        }


        /*
         * Безопасный fallback.
         */

        ctx.imageSmoothingEnabled =
          false;

        return originalDrawImage.apply(
          ctx,
          args
        );
      };
  }


  /* =========================================================
     5. Принудительно отключаем smoothing
     ========================================================= */

  function protectCanvas(
    canvas
  ) {

    if (
      !isRainRadarCanvas(canvas)
    ) {
      return;
    }


    const ctx =
      canvas.getContext(
        "2d"
      );

    if (!ctx) {
      return;
    }


    ctx.imageSmoothingEnabled =
      false;


    canvas.style.width =
      `${TILE_SIZE}px`;

    canvas.style.height =
      `${TILE_SIZE}px`;

    canvas.style.imageRendering =
      "pixelated";
  }


  /* =========================================================
     6. Безопасное наблюдение только за Leaflet tile pane
     ========================================================= */

  function observeRainRadarTiles() {

    /*
     * Не наблюдаем document.body.
     *
     * Ищем только конкретные RainRadar
     * canvas после их появления.
     */

    const observer =
      new MutationObserver(
        mutations => {

          for (
            const mutation of mutations
          ) {

            for (
              const node of mutation.addedNodes
            ) {

              if (
                node.nodeType !== 1
              ) {
                continue;
              }


              /*
               * Сам node — canvas.
               */

              if (
                node instanceof HTMLCanvasElement
              ) {

                protectCanvas(node);
              }


              /*
               * Или canvas находится
               * внутри добавленного элемента.
               */

              if (
                node.querySelectorAll
              ) {

                const canvases =
                  node.querySelectorAll(
                    "canvas.clorad-rainradar-tile"
                  );

                for (
                  const canvas of canvases
                ) {

                  protectCanvas(canvas);
                }
              }
            }
          }
        }
      );


    /*
     * Наблюдаем только Leaflet tile panes.
     */

    function attach() {

      const panes =
        document.querySelectorAll(
          ".leaflet-tile-pane"
        );


      for (
        const pane of panes
      ) {

        if (
          pane.dataset
            .cloradRainRadarObserved ===
          "1"
        ) {
          continue;
        }


        pane.dataset
          .cloradRainRadarObserved =
          "1";


        observer.observe(
          pane,
          {
            childList: true,
            subtree: true
          }
        );
      }
    }


    /*
     * Leaflet создаёт pane после
     * инициализации карты, поэтому
     * несколько безопасных попыток.
     */

    attach();

    setTimeout(
      attach,
      500
    );

    setTimeout(
      attach,
      1500
    );

    setTimeout(
      attach,
      3000
    );
  }


  /* =========================================================
     7. Уже существующие RainRadar canvas
     ========================================================= */

  function processExistingTiles() {

    const canvases =
      document.querySelectorAll(
        "canvas.clorad-rainradar-tile"
      );


    for (
      const canvas of canvases
    ) {

      protectCanvas(canvas);
    }
  }


  /* =========================================================
     8. Init
     ========================================================= */

  function init() {

    installCSS();

    installDrawImagePatch();

    processExistingTiles();

    observeRainRadarTiles();

  }


  /* =========================================================
     9. Запуск
     ========================================================= */

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
