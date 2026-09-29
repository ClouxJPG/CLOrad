/* =========================================================
   CLOrad — RainRadar Square Renderer
   Безопасная пикселизация

   ДЕЛАЕТ:
   - сохраняет чёткие квадратные пиксели RainRadar
   - применяет пикселизацию только к существующему canvas
   - автоматически обрабатывает новые/изменённые canvas
   - НЕ создаёт новый Leaflet layer
   - НЕ меняет API
   - НЕ меняет исходные данные
   - НЕ меняет palette
   - НЕ меняет геометрию Leaflet tile
   - НЕ использует MutationObserver
   - НЕ использует бесконечную перерисовку
   - не создаёт старые пиксели при переключении кадров

   DISPLAY_BLOCK:
   2 = визуальный квадрат 2×2 px.

   ВАЖНО:
   Пикселизация применяется к текущему
   содержимому canvas только после того,
   как RainRadar renderer записал новый кадр.
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
   * Размер визуального квадратного пикселя.
   *
   * 1 = без дополнительного укрупнения
   * 2 = квадрат 2×2 px
   * 3 = квадрат 3×3 px
   *
   * Оставляем 2 — это тот вариант,
   * который у тебя визуально выглядел нормально.
   */
  const DISPLAY_BLOCK =
    2;

  /*
   * Небольшой интервал только для поиска
   * НОВЫХ canvas.
   *
   * Сам canvas не обрабатывается повторно,
   * если его содержимое не изменилось.
   */
  const CHECK_INTERVAL =
    300;

  /*
   * Запоминаем уже обработанное состояние
   * каждого canvas.
   */
  const processed =
    new WeakMap();

  /* =======================================================
     CHECK CANVAS
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

    let imageData;

    try {
      imageData =
        ctx.getImageData(
          0,
          0,
          TILE_SIZE,
          TILE_SIZE
        );
    } catch {
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
        TILE_SIZE /
          block
      );

    const blocksY =
      Math.ceil(
        TILE_SIZE /
          block
      );

    /*
     * Берём цвет верхнего-левого
     * пикселя каждого блока и
     * распространяем его на весь
     * квадрат.
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
    } catch {
      return;
    }

    ctx.imageSmoothingEnabled =
      false;

    ctx.imageSmoothingQuality =
      "low";

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
     CANVAS SIGNATURE
     ======================================================= */

  /*
   * Нужно определить, действительно ли
   * содержимое canvas изменилось.
   *
   * Это позволяет:
   *
   * старый canvas → не трогать
   * новый кадр → обработать
   *
   * без постоянного повторного
   * укрупнения уже укрупнённых пикселей.
   */
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
       * Проверяем небольшую сетку
       * контрольных точек.
       *
       * Этого достаточно, чтобы
       * отличить старый bitmap
       * от нового кадра.
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
     * Если это тот же bitmap —
     * ничего не делаем.
     *
     * Это главное отличие от
     * старого варианта.
     */
    if (
      previous ===
      signature
    ) {
      return;
    }

    /*
     * Сначала помечаем canvas.
     *
     * После pixelate сигнатура
     * уже изменится, поэтому
     * повторный запуск не должен
     * снова укрупнять тот же canvas.
     */
    processed.set(
      canvas,
      signature
    );

    pixelateCanvas(
      canvas
    );

    /*
     * После изменения bitmap
     * обновляем контрольную сигнатуру.
     */
    const newSignature =
      getSignature(
        canvas
      );

    if (
      newSignature !==
      null
    ) {
      processed.set(
        canvas,
        newSignature
      );
    }
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
     CSS
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

      .clorad-rainradar-layer
      .leaflet-tile-container {
        image-rendering:
          -moz-crisp-edges !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          pixelated !important;
      }

      .clorad-rainradar-layer
      .leaflet-tile {
        image-rendering:
          -moz-crisp-edges !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          pixelated !important;
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
     * Проверяем появление новых
     * Leaflet canvas.
     *
     * Сам bitmap уже обработанных
     * canvas повторно не изменяется.
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
