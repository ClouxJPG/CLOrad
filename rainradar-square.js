/* =========================================================
   CLOrad — RainRadar 1×1 / Pixelated
   Безопасный режим

   НЕ:
   - создаёт новый слой
   - не меняет данные
   - не меняет API
   - не меняет palette
   - не меняет Leaflet tile geometry
   - не использует MutationObserver
   - не использует transform
   - не растягивает радар радиально

   ДЕЛАЕТ:
   - находит существующие RainRadar canvas
   - делает радарные ячейки крупными
     чёткими квадратами
   - сохраняет ровную границу каждого tile
   - не сглаживает цвета
   - не создаёт промежуточный слой

   DISPLAY_BLOCK = 2
   = визуальный квадрат 2×2 px
   внутри 256×256 Leaflet tile.

   ВАЖНО:
   это только визуализация уже полученных
   RainRadar данных.
   Исходные PNG/API не изменяются.
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

  /*
   * Тот самый размер квадратов,
   * который сейчас выглядит правильно.
   */
  const DISPLAY_BLOCK = 2;

  const TILE_SIZE = 256;

  /*
   * Никаких MutationObserver.
   */
  const CHECK_INTERVAL = 500;


  /* =======================================================
     CHECK
     ======================================================= */

  function isRainRadarCanvas(
    canvas
  ) {
    if (!canvas) {
      return false;
    }

    return canvas.matches(
      TILE_SELECTOR
    );
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

    if (
      canvas.width !== TILE_SIZE ||
      canvas.height !== TILE_SIZE
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
    } catch (_) {
      return;
    }

    if (!ctx) {
      return;
    }

    let imageData;

    try {
      imageData =
        ctx.getImageData(
          0,
          0,
          TILE_SIZE,
          TILE_SIZE
        );
    } catch (_) {
      return;
    }

    const source =
      imageData.data;

    const output =
      new Uint8ClampedArray(
        source.length
      );

    const block =
      DISPLAY_BLOCK;

    const blocksX =
      Math.ceil(
        TILE_SIZE / block
      );

    const blocksY =
      Math.ceil(
        TILE_SIZE / block
      );


    /*
     * Каждый блок получает цвет
     * исходной raster-ячейки.
     *
     * Никакого blur.
     * Никакого усреднения.
     */
    for (
      let blockY = 0;
      blockY < blocksY;
      blockY++
    ) {

      for (
        let blockX = 0;
        blockX < blocksX;
        blockX++
      ) {

        const sourceX =
          Math.min(
            TILE_SIZE - 1,
            blockX * block
          );

        const sourceY =
          Math.min(
            TILE_SIZE - 1,
            blockY * block
          );

        const sourceIndex =
          (
            sourceY *
              TILE_SIZE +
            sourceX
          ) * 4;

        const r =
          source[
            sourceIndex
          ];

        const g =
          source[
            sourceIndex + 1
          ];

        const b =
          source[
            sourceIndex + 2
          ];

        const a =
          source[
            sourceIndex + 3
          ];


        for (
          let py = 0;
          py < block;
          py++
        ) {

          const y =
            blockY * block +
            py;

          if (
            y >= TILE_SIZE
          ) {
            continue;
          }

          for (
            let px = 0;
            px < block;
            px++
          ) {

            const x =
              blockX * block +
              px;

            if (
              x >= TILE_SIZE
            ) {
              continue;
            }

            const outputIndex =
              (
                y *
                  TILE_SIZE +
                x
              ) * 4;

            output[
              outputIndex
            ] = r;

            output[
              outputIndex + 1
            ] = g;

            output[
              outputIndex + 2
            ] = b;

            output[
              outputIndex + 3
            ] = a;
          }
        }
      }
    }


    try {
      imageData.data.set(
        output
      );

      ctx.putImageData(
        imageData,
        0,
        0
      );
    } catch (_) {
      return;
    }


    /*
     * Запрещаем браузеру
     * интерполировать картинку.
     */
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
  }


  /* =======================================================
     APPLY ONE
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

    pixelateCanvas(
      canvas
    );

    try {
      const ctx =
        canvas.getContext(
          "2d"
        );

      if (ctx) {
        ctx.imageSmoothingEnabled =
          false;

        ctx.imageSmoothingQuality =
          "low";
      }
    } catch (_) {}
  }


  /* =======================================================
     APPLY
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
        const canvas of canvases
      ) {
        applyToCanvas(
          canvas
        );
      }
    }
  }


  /* =======================================================
     CSS
     ======================================================= */

  function installCSS() {
    if (
      document.getElementById(
        "cloradRainRadarSquareSafe"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "cloradRainRadarSquareSafe";

    style.textContent = `
      canvas.clorad-rainradar-tile {
        width: 256px !important;
        height: 256px !important;

        display: block !important;

        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;

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

    setInterval(
      apply,
      CHECK_INTERVAL
    );
  }


  /* =======================================================
     INIT
     ======================================================= */

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once: true
      }
    );

  } else {

    start();
  }

})();
