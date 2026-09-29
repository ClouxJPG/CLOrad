/* =========================================================
   CLOrad — RainRadar SQUARE PIXEL FILTER
   Файл: rainradar-square.js

   ВАЖНО:
   Этот файл НЕ создаёт второй RainRadar.

   Он работает поверх уже существующего
   rainradar.js и обрабатывает реальные
   canvas.clorad-rainradar-tile.

   Что делает:
   - реальные радарные данные остаются теми же
   - каждый tile остаётся 256x256
   - радар визуально превращается в квадратные ячейки
   - отключается сглаживание
   - отключается interpolation
   - убирается blur
   - новые tiles автоматически обрабатываются
   - при zoom новые tiles тоже обрабатываются
   - при смене кадра обработка повторяется

   Подключать ПОСЛЕ rainradar.js.
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     SETTINGS
     ======================================================= */

  /*
   * Размер визуальной квадратной ячейки.
   *
   * 2 = мелкие квадраты
   * 3 = заметные
   * 4 = как выраженный radar-grid
   * 5 = крупнее
   * 6 = очень крупные
   *
   * Начинаем с 4.
   */
  const PIXEL_SIZE = 4;

  /*
   * Как часто проверять новые Leaflet tiles.
   */
  const SCAN_INTERVAL = 120;

  /*
   * Класс canvas твоего RainRadar.
   */
  const TILE_SELECTOR =
    "canvas.clorad-rainradar-tile";

  /*
   * Не обрабатывать один canvas повторно.
   */
  const PROCESSED_ATTRIBUTE =
    "data-clorad-square";

  /* =======================================================
     CSS
     ======================================================= */

  function installCSS() {
    if (
      document.getElementById(
        "clorad-rainradar-square-filter"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "clorad-rainradar-square-filter";

    style.textContent = `
      /*
       * RainRadar должен отображаться
       * без браузерного сглаживания.
       */

      canvas.clorad-rainradar-tile {
        image-rendering: pixelated !important;
        image-rendering: crisp-edges !important;
        image-rendering: -moz-crisp-edges !important;

        filter: none !important;

        transition: none !important;
        animation: none !important;

        backface-visibility: hidden !important;
      }

      .clorad-rainradar-layer canvas,
      .leaflet-layer canvas.clorad-rainradar-tile {
        image-rendering: pixelated !important;
        image-rendering: crisp-edges !important;
        image-rendering: -moz-crisp-edges !important;

        filter: none !important;

        transition: none !important;
        animation: none !important;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     PIXELATE CANVAS
     ======================================================= */

  function pixelateCanvas(canvas) {
    if (
      !canvas ||
      canvas.width <= 0 ||
      canvas.height <= 0
    ) {
      return;
    }

    /*
     * Не берём уже обработанный
     * canvas повторно.
     */
    if (
      canvas.getAttribute(
        PROCESSED_ATTRIBUTE
      ) === "1"
    ) {
      return;
    }

    /*
     * Получаем исходные пиксели.
     */
    let ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );

    if (!ctx) {
      return;
    }

    /*
     * Никакого smoothing.
     */
    ctx.imageSmoothingEnabled =
      false;

    ctx.imageSmoothingQuality =
      "low";

    let image;

    try {
      image =
        ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        );
    } catch (_) {
      return;
    }

    const width =
      canvas.width;

    const height =
      canvas.height;

    const source =
      image.data;

    /*
     * Новый массив.
     */
    const result =
      new Uint8ClampedArray(
        source.length
      );

    /*
     * -----------------------------------------------------
     * КВАДРАТНАЯ ДИСКРЕТИЗАЦИЯ
     * -----------------------------------------------------
     *
     * Каждый PIXEL_SIZE x PIXEL_SIZE
     * блок получает один цвет.
     *
     * При этом альфа-канал также
     * переносится.
     */

    const size =
      PIXEL_SIZE;

    for (
      let blockY = 0;
      blockY < height;
      blockY += size
    ) {
      for (
        let blockX = 0;
        blockX < width;
        blockX += size
      ) {

        /*
         * Берём цвет из центра блока.
         *
         * Это предотвращает появление
         * смешанных цветов на границах.
         */
        const centerX =
          Math.min(
            blockX +
              Math.floor(size / 2),
            width - 1
          );

        const centerY =
          Math.min(
            blockY +
              Math.floor(size / 2),
            height - 1
          );

        const centerIndex =
          (
            centerY *
            width +
            centerX
          ) * 4;

        const r =
          source[centerIndex];

        const g =
          source[
            centerIndex + 1
          ];

        const b =
          source[
            centerIndex + 2
          ];

        const a =
          source[
            centerIndex + 3
          ];

        /*
         * Заполняем весь квадрат
         * одним цветом.
         */
        const endY =
          Math.min(
            blockY + size,
            height
          );

        const endX =
          Math.min(
            blockX + size,
            width
          );

        for (
          let y = blockY;
          y < endY;
          y++
        ) {
          for (
            let x = blockX;
            x < endX;
            x++
          ) {
            const index =
              (
                y *
                width +
                x
              ) * 4;

            result[index] =
              r;

            result[index + 1] =
              g;

            result[index + 2] =
              b;

            result[index + 3] =
              a;
          }
        }
      }
    }

    /*
     * Записываем обратно.
     */
    const output =
      new ImageData(
        result,
        width,
        height
      );

    /*
     * Перед записью опять
     * отключаем smoothing.
     */
    ctx.imageSmoothingEnabled =
      false;

    ctx.imageSmoothingQuality =
      "low";

    ctx.putImageData(
      output,
      0,
      0
    );

    /*
     * Помечаем tile.
     */
    canvas.setAttribute(
      PROCESSED_ATTRIBUTE,
      "1"
    );

    /*
     * Прямо на canvas.
     */
    canvas.style.imageRendering =
      "pixelated";

    canvas.style.filter =
      "none";

    canvas.style.transition =
      "none";

    canvas.style.animation =
      "none";
  }

  /* =======================================================
     PROCESS ALL CURRENT TILES
     ======================================================= */

  function processTiles() {
    const tiles =
      document.querySelectorAll(
        TILE_SELECTOR
      );

    for (
      const tile of tiles
    ) {
      pixelateCanvas(
        tile
      );
    }
  }

  /* =======================================================
     MUTATION OBSERVER
     ======================================================= */

  let observer =
    null;

  function startObserver() {
    if (
      observer
    ) {
      return;
    }

    observer =
      new MutationObserver(
        mutations => {

          let needScan =
            false;

          for (
            const mutation of mutations
          ) {
            if (
              mutation.type ===
              "childList"
            ) {
              needScan =
                true;

              break;
            }

            if (
              mutation.type ===
              "attributes"
            ) {
              needScan =
                true;

              break;
            }
          }

          if (
            needScan
          ) {
            processTiles();
          }
        }
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "class",
          "style"
        ]
      }
    );
  }

  /* =======================================================
     PERIODIC SCAN
     ======================================================= */

  let interval =
    null;

  function startScanner() {
    if (
      interval
    ) {
      return;
    }

    interval =
      setInterval(
        processTiles,
        SCAN_INTERVAL
      );
  }

  /* =======================================================
     HANDLE ZOOM
     ======================================================= */

  function attachMapEvents() {
    if (
      !window.map ||
      typeof window.map.on !==
        "function"
    ) {
      return false;
    }

    /*
     * После zoom Leaflet создаёт
     * совершенно новые canvas.
     */
    window.map.on(
      "zoomend moveend",
      () => {
        /*
         * Несколько проходов:
         * Leaflet может создавать tiles
         * не одновременно.
         */
        setTimeout(
          processTiles,
          0
        );

        setTimeout(
          processTiles,
          100
        );

        setTimeout(
          processTiles,
          300
        );
      }
    );

    return true;
  }

  /* =======================================================
     WAIT FOR MAP
     ======================================================= */

  function waitForMap() {
    if (
      window.map
    ) {
      attachMapEvents();

      processTiles();

      return;
    }

    setTimeout(
      waitForMap,
      250
    );
  }

  /* =======================================================
     START
     ======================================================= */

  function start() {
    installCSS();

    /*
     * Первичная обработка.
     */
    processTiles();

    /*
     * Следим за новыми tiles.
     */
    startObserver();

    /*
     * Дополнительный scanner.
     */
    startScanner();

    /*
     * Подключаем zoom/move.
     */
    waitForMap();

    /*
     * Несколько начальных проходов,
     * потому что RainRadar может загрузиться
     * чуть позже этого файла.
     */
    setTimeout(
      processTiles,
      100
    );

    setTimeout(
      processTiles,
      300
    );

    setTimeout(
      processTiles,
      700
    );

    setTimeout(
      processTiles,
      1500
    );
  }

  /* =======================================================
     START AFTER DOM
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

  /* =======================================================
     PUBLIC DEBUG API
     ======================================================= */

  window.CLOrad =
    window.CLOrad || {};

  window.CLOrad.RainRadarSquare =
    {
      process:
        processTiles,

      setPixelSize(
        value
      ) {
        const n =
          Number(value);

        if (
          !Number.isFinite(n) ||
          n < 1
        ) {
          return;
        }

        /*
         * В этой версии PIXEL_SIZE —
         * константа, поэтому для изменения
         * размера нужен reload.
         */
        console.log(
          "[CLOrad RainRadar Square] " +
          "Текущий PIXEL_SIZE:",
          PIXEL_SIZE,
          "Запрошен:",
          n
        );
      }
    };

})();
