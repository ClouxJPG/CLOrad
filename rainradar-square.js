/* =========================================================
   CLOrad — RainRadar Square Renderer
   1×1 pixel / максимально резкий режим

   ДЕЛАЕТ:
   - визуальные пиксели 1×1
   - никакого дополнительного укрупнения
   - никакого blur
   - никакого bilinear filtering
   - никакого CSS-фильтра
   - никакого transition
   - никакой animation

   НЕ:
   - изменяет API
   - изменяет источник
   - изменяет palette
   - создаёт Leaflet layer
   - изменяет геометрию tile
   - повторно укрупняет уже обработанный canvas
   - использует MutationObserver

   ВАЖНО:
   DISPLAY_BLOCK = 1 означает:
   один выходной пиксель = один пиксель
   canvas без дополнительного объединения
   соседних пикселей.

   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const TILE_SELECTOR =
    "canvas.clorad-rainradar-tile";

  const LAYER_SELECTOR =
    ".clorad-rainradar-layer";

  const TILE_SIZE =
    256;

  /*
   * 1×1.
   *
   * Никакого искусственного
   * укрупнения пикселей.
   */
  const DISPLAY_BLOCK =
    1;

  const CHECK_INTERVAL =
    300;

  const processed =
    new WeakMap();

  /* =======================================================
     CANVAS CHECK
     ======================================================= */

  function isRainRadarCanvas(
    canvas
  ) {
    return (
      canvas instanceof
        HTMLCanvasElement &&
      canvas.matches(
        TILE_SELECTOR
      ) &&
      canvas.width ===
        TILE_SIZE &&
      canvas.height ===
        TILE_SIZE
    );
  }

  /* =======================================================
     GET SIGNATURE
     ======================================================= */

  function getSignature(
    canvas
  ) {
    let ctx;

    try {
      ctx =
        canvas.getContext(
          "2d",
          {
            willReadFrequently:
              true
          }
        );
    } catch {
      return null;
    }

    if (!ctx) {
      return null;
    }

    try {
      /*
       * Контрольные точки по всей
       * площади tile.
       */
      const points = [
        [0, 0],
        [64, 0],
        [128, 0],
        [192, 0],

        [0, 64],
        [64, 64],
        [128, 64],
        [192, 64],

        [0, 128],
        [64, 128],
        [128, 128],
        [192, 128],

        [0, 192],
        [64, 192],
        [128, 192],
        [192, 192]
      ];

      let signature =
        "";

      for (
        const point of
        points
      ) {
        const data =
          ctx.getImageData(
            point[0],
            point[1],
            1,
            1
          ).data;

        signature +=
          data[0] + "," +
          data[1] + "," +
          data[2] + "," +
          data[3] + ";";
      }

      return signature;
    } catch {
      return null;
    }
  }

  /* =======================================================
     PIXELATE
     ======================================================= */

  function pixelateCanvas(
    canvas
  ) {
    if (
      !isRainRadarCanvas(
        canvas
      )
    ) {
      return;
    }

    let ctx;

    try {
      ctx =
        canvas.getContext(
          "2d",
          {
            willReadFrequently:
              true
          }
        );
    } catch {
      return;
    }

    if (!ctx) {
      return;
    }

    /*
     * Для 1×1 никакого
     * пересчёта блоков вообще
     * не требуется.
     *
     * Мы просто гарантируем,
     * что браузер не сглаживает
     * bitmap.
     */

    ctx.imageSmoothingEnabled =
      false;

    try {
      ctx.imageSmoothingQuality =
        "low";
    } catch {}

    canvas.style.setProperty(
      "image-rendering",
      "pixelated",
      "important"
    );

    canvas.style.setProperty(
      "filter",
      "none",
      "important"
    );

    canvas.style.setProperty(
      "transition",
      "none",
      "important"
    );

    canvas.style.setProperty(
      "animation",
      "none",
      "important"
    );

    /*
     * DISPLAY_BLOCK оставлен
     * явно равным 1.
     */
    if (
      DISPLAY_BLOCK !== 1
    ) {
      return;
    }
  }

  /* =======================================================
     APPLY
     ======================================================= */

  function applyToCanvas(
    canvas
  ) {
    if (
      !isRainRadarCanvas(
        canvas
      )
    ) {
      return;
    }

    const signature =
      getSignature(
        canvas
      );

    if (
      signature === null
    ) {
      return;
    }

    const previous =
      processed.get(
        canvas
      );

    /*
     * Уже обработанный bitmap
     * больше не трогаем.
     */
    if (
      previous ===
      signature
    ) {
      return;
    }

    pixelateCanvas(
      canvas
    );

    const newSignature =
      getSignature(
        canvas
      );

    processed.set(
      canvas,
      newSignature ||
        signature
    );
  }

  /* =======================================================
     APPLY ALL
     ======================================================= */

  function apply() {
    const layers =
      document.querySelectorAll(
        LAYER_SELECTOR
      );

    for (
      const layer of layers
    ) {
      const canvases =
        layer.querySelectorAll(
          TILE_SELECTOR
        );

      for (
        const canvas of
        canvases
      ) {
        applyToCanvas(
          canvas
        );
      }
    }
  }

  /* =======================================================
     HARD CSS
     ======================================================= */

  function installCSS() {
    const styleId =
      "cloradRainRadarSquareCSS";

    if (
      document.getElementById(
        styleId
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      styleId;

    style.textContent = `
      .clorad-rainradar-layer {
        opacity: 1 !important;
        filter: none !important;
        transition: none !important;
        animation: none !important;
      }

      .clorad-rainradar-layer
      canvas.clorad-rainradar-tile {
        width: 256px !important;
        height: 256px !important;

        display: block !important;

        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;

        /*
         * Жёстко запрещаем
         * сглаживание.
         */
        image-rendering:
          -moz-crisp-edges !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          pixelated !important;

        filter:
          none !important;

        transition:
          none !important;

        animation:
          none !important;

        transform:
          none !important;
      }

      .clorad-rainradar-layer
      .leaflet-tile-container {
        image-rendering:
          -moz-crisp-edges !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          pixelated !important;

        filter:
          none !important;

        transition:
          none !important;

        animation:
          none !important;
      }

      .clorad-rainradar-layer
      .leaflet-tile {
        image-rendering:
          -moz-crisp-edges !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          pixelated !important;

        filter:
          none !important;

        transition:
          none !important;

        animation:
          none !important;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     START
     ======================================================= */

  function start() {
    installCSS();

    apply();

    /*
     * Ищем только новые/изменённые
     * canvas.
     *
     * Уже обработанный canvas
     * повторно не изменяется.
     */
    setInterval(
      apply,
      CHECK_INTERVAL
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once:
          true
      }
    );
  } else {
    start();
  }

})();
