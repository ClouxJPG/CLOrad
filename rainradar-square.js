/* =========================================================
   CLOrad — RainRadar Square Renderer
   Безопасный режим / 1×1 без blur

   ВАЖНО:
   - НЕ изменяет bitmap радара
   - НЕ перерисовывает canvas
   - НЕ создаёт дополнительные слои
   - НЕ использует MutationObserver
   - НЕ использует setInterval
   - НЕ меняет API
   - НЕ меняет данные RainRadar
   - НЕ меняет palette
   - НЕ меняет Leaflet tile geometry
   - НЕ изменяет координаты тайлов
   - НЕ создаёт старые/остаточные пиксели

   Рендеринг самого bitmap полностью выполняется
   rainradar.js через imageSmoothingEnabled=false.

   Этот файл отвечает ТОЛЬКО за CSS,
   чтобы браузер не применял сглаживание
   к уже готовому RainRadar canvas.

   DISPLAY:
   1×1 — без дополнительного укрупнения
   пикселей через JavaScript.

   ========================================================= */

(() => {
  "use strict";

  const STYLE_ID =
    "cloradRainRadarSquareSafe";

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
      /* ===================================================
         RAINRADAR CANVAS
         =================================================== */

      canvas.clorad-rainradar-tile {
        width: 256px !important;
        height: 256px !important;

        display: block !important;

        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;

        /*
         * Максимально резкий режим.
         */
        image-rendering:
          -moz-crisp-edges !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          pixelated !important;

        /*
         * Никакого blur/filter.
         */
        filter:
          none !important;

        /*
         * Никаких промежуточных
         * CSS-анимаций.
         */
        transition:
          none !important;

        animation:
          none !important;

        /*
         * Не добавляем transform.
         * Leaflet сам управляет
         * положением tile.
         */
      }


      /* ===================================================
         RAINRADAR TILE CONTAINER
         =================================================== */

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


      /* ===================================================
         RAINRADAR LEAFLET TILE
         =================================================== */

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


      /* ===================================================
         RAINRADAR LAYER
         =================================================== */

      .clorad-rainradar-layer {
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

})();
