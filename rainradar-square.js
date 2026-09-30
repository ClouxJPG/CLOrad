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
/* =========================================================
   CLOrad — RainRadar PNG Resolution Diagnostic
   ВРЕМЕННО
   Показывает реальный naturalWidth × naturalHeight
   исходного radar PNG.
   ========================================================= */

(() => {
  "use strict";

  const ID = "clorad-rainradar-resolution-test";

  function showResolution() {
    const canvas = document.querySelector(
      "canvas.clorad-rainradar-tile"
    );

    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    const imageData = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

    /*
     * Сам canvas уже 256×256 после нашего renderer,
     * поэтому по нему определить исходный PNG нельзя.
     *
     * Этот тест специально ищет IMG,
     * если браузер временно держит исходную картинку.
     */

    let imgs = document.querySelectorAll("img");

    for (const img of imgs) {
      if (
        img.naturalWidth > 0 &&
        img.naturalHeight > 0 &&
        img.src.includes("/api/rainradar")
      ) {
        let box =
          document.getElementById(ID);

        if (!box) {
          box =
            document.createElement("div");

          box.id = ID;

          box.style.cssText = `
            position: fixed;
            left: 10px;
            bottom: 10px;
            z-index: 999999;

            padding: 8px 12px;

            background: rgba(0,0,0,.85);
            color: white;

            font:
              14px -apple-system,
              BlinkMacSystemFont,
              sans-serif;

            border-radius: 8px;

            pointer-events: none;
          `;

          document.body.appendChild(box);
        }

        box.textContent =
          "RainRadar PNG: " +
          img.naturalWidth +
          " × " +
          img.naturalHeight;

        return;
      }
    }
  }

  setTimeout(showResolution, 1000);
  setTimeout(showResolution, 3000);
  setTimeout(showResolution, 6000);

})();
