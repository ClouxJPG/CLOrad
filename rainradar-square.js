/* =========================================================
   CLOrad — RainRadar Square Renderer

   ВАЖНО:
   - rainradar.js НЕ изменяется
   - API НЕ изменяется
   - источник RainRadar НЕ изменяется
   - никаких новых запросов к RainRadar
   - никаких getImageData()
   - никаких putImageData()
   - никакого глобального drawImage()
   - никаких MutationObserver
   - никаких setInterval
   - никаких дополнительных Leaflet layers

   ЗАДАЧА:
   - убрать сглаживание RainRadar
   - сохранить квадратную форму
     исходных raster-ячеек
   - не создавать искусственную
     крупную пикселизацию
   - не замедлять загрузку кадров
   - не вмешиваться в кадровый renderer

   ========================================================= */

(() => {
  "use strict";

  const STYLE_ID =
    "cloradRainRadarSquareRenderer";

  function install() {
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
       * RainRadar canvas.
       *
       * Никакого CSS-увеличения
       * исходной картинки.
       */
      .clorad-rainradar-layer
      canvas.clorad-rainradar-tile {

        display: block !important;

        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;

        /*
         * Canvas остаётся ровно
         * размером Leaflet tile.
         */
        width: 256px !important;
        height: 256px !important;

        /*
         * Запрещаем браузеру
         * сглаживать raster.
         */
        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          -moz-crisp-edges !important;

        /*
         * Никаких визуальных
         * переходов между кадрами.
         */
        transition:
          none !important;

        animation:
          none !important;

        filter:
          none !important;

        transform:
          none !important;
      }


      /*
       * Leaflet tile container.
       */
      .clorad-rainradar-layer
      .leaflet-tile-container {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          -moz-crisp-edges !important;

        transition:
          none !important;

        animation:
          none !important;
      }


      /*
       * Leaflet tile.
       */
      .clorad-rainradar-layer
      .leaflet-tile {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          -moz-crisp-edges !important;

        transition:
          none !important;

        animation:
          none !important;
      }


      /*
       * Сам слой RainRadar.
       */
      .clorad-rainradar-layer {

        transition:
          none !important;

        animation:
          none !important;

        filter:
          none !important;
      }
    `;

    document.head.appendChild(
      style
    );
  }


  /*
   * Устанавливаем CSS сразу,
   * если DOM уже готов.
   */
  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      install,
      {
        once: true
      }
    );
  } else {
    install();
  }


  /*
   * Если rainradar.js загрузится
   * после этого файла и создаст
   * свои canvas — CSS уже будет
   * применяться автоматически.
   */
})();
