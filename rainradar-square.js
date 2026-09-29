/* =========================================================
   CLOrad — RainRadar 1×1 / Pixelated
   Безопасный режим

   НЕ:
   - создаёт новый слой
   - не меняет данные
   - не меняет canvas pixels
   - не использует MutationObserver
   - не вмешивается в Leaflet GridLayer

   ДЕЛАЕТ:
   - находит уже существующие RainRadar canvas
   - отключает сглаживание при отображении
   - делает исходные 1×1 ячейки визуально
     чёткими квадратными пикселями
   ========================================================= */

(() => {
  "use strict";

  const TILE_SELECTOR =
    "canvas.clorad-rainradar-tile";

  const LAYER_SELECTOR =
    ".clorad-rainradar-layer";

  /*
   * Проверяем уже созданные canvas
   * раз в 500 мс.
   *
   * Это специально редко, чтобы
   * вообще не нагружать страницу.
   */
  const CHECK_INTERVAL = 500;


  /* =======================================================
     APPLY TO ONE CANVAS
     ======================================================= */

  function applyToCanvas(canvas) {
    if (!canvas) {
      return;
    }

    /*
     * Только RainRadar canvas.
     */
    if (
      !canvas.matches(
        TILE_SELECTOR
      )
    ) {
      return;
    }

    /*
     * Главный параметр:
     * никакого bilinear interpolation.
     */
    canvas.style.setProperty(
      "image-rendering",
      "pixelated",
      "important"
    );

    /*
     * Убираем возможные фильтры.
     */
    canvas.style.setProperty(
      "filter",
      "none",
      "important"
    );

    /*
     * Не даём canvas плавно
     * появляться/изменяться.
     */
    canvas.style.setProperty(
      "transition",
      "none",
      "important"
    );

    /*
     * Работаем с уже существующим
     * 2D context.
     *
     * Никакой перерисовки данных.
     */
    try {
      const ctx =
        canvas.getContext("2d");

      if (ctx) {
        ctx.imageSmoothingEnabled =
          false;

        ctx.imageSmoothingQuality =
          "low";
      }
    } catch (_) {
      /*
       * Ничего не делаем.
       */
    }
  }


  /* =======================================================
     APPLY TO EXISTING RAINRADAR
     ======================================================= */

  function apply() {
    /*
     * Находим только существующие
     * RainRadar layers.
     */
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

    document.head.appendChild(
      style
    );
  }


  /* =======================================================
     START
     ======================================================= */

  function start() {
    /*
     * CSS.
     */
    installCSS();

    /*
     * Уже существующие tiles.
     */
    apply();

    /*
     * Просто периодическая проверка.
     *
     * Никаких MutationObserver.
     * Никаких событий Leaflet.
     * Никаких вмешательств в создание tile.
     */
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
