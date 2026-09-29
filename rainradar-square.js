/* =========================================================
   CLOrad — RainRadar Square Renderer
   Безопасный режим

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
   - НЕ создаёт старые/остаточные пиксели

   Рендеринг пикселей полностью выполняется
   rainradar.js через imageSmoothingEnabled=false.

   Этот файл отвечает только за CSS,
   чтобы браузер не применял сглаживание
   к уже готовому RainRadar canvas.
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
