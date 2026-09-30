/* =========================================================
   CLOrad — RainRadar Square Renderer

   ОТДЕЛЬНЫЙ ФАЙЛ
   rainradar.js НЕ ИЗМЕНЯЕТСЯ

   Задача:
   - RainRadar canvas только
   - никаких getImageData()
   - никаких putImageData()
   - никаких дополнительных запросов
   - никаких дополнительных Leaflet layers
   - никаких MutationObserver
   - никаких таймеров
   - не трогает остальные canvas сайта
   - не создаёт искусственные 4x4 / 8x8 блоки
   - сохраняет исходные raster-пиксели квадратными

   ========================================================= */

(() => {
  "use strict";

  const STYLE_ID =
    "clorad-rainradar-square";

  /*
   * ---------------------------------------------------------
   * CSS
   * ---------------------------------------------------------
   */

  function installCSS() {
    if (
      document.getElementById(
        STYLE_ID
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      STYLE_ID;

    style.textContent = `
      /*
       * Только RainRadar.
       */

      .clorad-rainradar-layer
      canvas.clorad-rainradar-tile {

        display: block !important;

        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;

        /*
         * НЕ увеличиваем canvas
         * отдельным CSS pixelation.
         */
        width: 256px !important;
        height: 256px !important;

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          -moz-crisp-edges !important;

        filter: none !important;

        transform: none !important;

        transition: none !important;
        animation: none !important;
      }

      .clorad-rainradar-layer
      .leaflet-tile-container {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        transition: none !important;
        animation: none !important;
      }

      .clorad-rainradar-layer
      .leaflet-tile {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        transition: none !important;
        animation: none !important;
      }
    `;

    document.head.appendChild(
      style
    );
  }


  /*
   * ---------------------------------------------------------
   * Безопасный перехват drawImage
   * ---------------------------------------------------------
   *
   * В отличие от старой версии:
   *
   * НЕ перехватываем каждый drawImage
   * на странице.
   *
   * Работаем только если target canvas
   * является RainRadar canvas.
   *
   * Остальной CLOrad вообще
   * не затрагивается.
   */

  function installCanvasHook() {

    if (
      window.__CLORadRainRadarSquareHook
    ) {
      return;
    }

    const proto =
      CanvasRenderingContext2D.prototype;

    const originalDrawImage =
      proto.drawImage;

    if (
      typeof originalDrawImage !==
      "function"
    ) {
      return;
    }

    proto.drawImage =
      function (...args) {

        const canvas =
          this.canvas;

        /*
         * Это НЕ RainRadar.
         *
         * Отдаём браузеру
         * оригинальный drawImage.
         */
        if (
          !canvas ||
          !canvas.classList ||
          !canvas.classList.contains(
            "clorad-rainradar-tile"
          )
        ) {
          return originalDrawImage.apply(
            this,
            args
          );
        }


        /*
         * ---------------------------------------------------
         * RainRadar
         * ---------------------------------------------------
         *
         * Определяем исходный bitmap.
         */

        const source =
          args[0];

        if (
          !source
        ) {
          return originalDrawImage.apply(
            this,
            args
          );
        }


        /*
         * Получаем реальные размеры
         * исходного raster.
         */
        const sourceWidth =
          source.naturalWidth ||
          source.videoWidth ||
          source.width ||
          0;

        const sourceHeight =
          source.naturalHeight ||
          source.videoHeight ||
          source.height ||
          0;


        /*
         * Если размеры неизвестны —
         * обычный drawImage.
         */
        if (
          !sourceWidth ||
          !sourceHeight
        ) {
          return originalDrawImage.apply(
            this,
            args
          );
        }


        /*
         * ---------------------------------------------------
         * ВАЖНО
         *
         * Если rainradar.js передал:
         *
         * drawImage(
         *   source,
         *   0,
         *   0,
         *   256,
         *   256
         * )
         *
         * мы НЕ позволяем Canvas
         * интерполировать исходные
         * raster-ячейки.
         *
         * Рисуем nearest-neighbor.
         * ---------------------------------------------------
         */

        this.imageSmoothingEnabled =
          false;

        try {
          this.imageSmoothingQuality =
            "low";
        } catch {}


        /*
         * Для вызова с destination
         * 256×256 сохраняем геометрию
         * Leaflet tile, но отключаем
         * сглаживание.
         */

        if (
          args.length === 5
        ) {

          return originalDrawImage.call(
            this,

            source,

            0,
            0,

            canvas.width,
            canvas.height
          );
        }


        /*
         * Для 9-аргументного варианта
         * также принудительно отключаем
         * interpolation.
         */

        if (
          args.length === 9
        ) {

          return originalDrawImage.apply(
            this,
            args
          );
        }


        return originalDrawImage.apply(
          this,
          args
        );
      };


    window.__CLORadRainRadarSquareHook =
      true;
  }


  /*
   * ---------------------------------------------------------
   * Дополнительная защита от CSS interpolation
   * ---------------------------------------------------------
   */

  function protectExistingTiles() {

    document
      .querySelectorAll(
        ".clorad-rainradar-layer canvas.clorad-rainradar-tile"
      )
      .forEach(
        canvas => {

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
      );
  }


  /*
   * ---------------------------------------------------------
   * Запуск
   * ---------------------------------------------------------
   */

  installCSS();

  installCanvasHook();

  /*
   * Уже существующие RainRadar
   * тоже защищаем.
   */
  protectExistingTiles();

})();
