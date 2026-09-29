/* =========================================================
   CLOrad — RainRadar 1×1 RGMC / NOWCAST STYLE
   Файл: rainradar-square.js

   НАЗНАЧЕНИЕ:
   - НЕ создаёт второй RainRadar
   - НЕ меняет API
   - НЕ меняет палитру
   - НЕ меняет legend
   - НЕ меняет timeline
   - НЕ меняет basemap
   - НЕ создаёт искусственные 4×4 / 6×6 блоки

   Оригинальная радарная сетка остаётся 1×1.

   Главная задача:
   заставить Leaflet + браузер отображать
   исходные пиксели как ЧЁТКИЕ КВАДРАТЫ,
   без bilinear interpolation / blur.

   Работает непосредственно с:
     canvas.clorad-rainradar-tile

   из существующего rainradar.js.

   ПОДКЛЮЧАТЬ ПОСЛЕ rainradar.js.
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
   * Проверка новых тайлов.
   *
   * RainRadar может создавать canvas
   * не сразу после открытия слоя.
   */
  const SCAN_INTERVAL =
    100;


  /* =======================================================
     FORCE PIXELATED RENDERING
     ======================================================= */

  function forcePixelRendering(
    element
  ) {
    if (!element) {
      return;
    }

    /*
     * Самое важное свойство.
     *
     * Через setProperty(..., "important")
     * мы гарантированно перебиваем
     *
     * rainradar.js:
     *
     * image-rendering: auto !important;
     */
    element.style.setProperty(
      "image-rendering",
      "pixelated",
      "important"
    );

    /*
     * Старые браузерные fallback.
     */
    element.style.setProperty(
      "image-rendering",
      "crisp-edges",
      "important"
    );

    /*
     * Убираем любые CSS-фильтры.
     */
    element.style.setProperty(
      "filter",
      "none",
      "important"
    );

    /*
     * Никаких transition.
     */
    element.style.setProperty(
      "transition",
      "none",
      "important"
    );

    /*
     * Никакой animation.
     */
    element.style.setProperty(
      "animation",
      "none",
      "important"
    );

    /*
     * Не позволяем браузеру применять
     * дополнительную интерполяцию.
     */
    element.style.setProperty(
      "backface-visibility",
      "hidden",
      "important"
    );
  }


  /* =======================================================
     FORCE CANVAS CONTEXT
     ======================================================= */

  function forceCanvasContext(
    canvas
  ) {
    if (
      !canvas ||
      canvas.tagName !==
        "CANVAS"
    ) {
      return;
    }

    /*
     * Canvas должен отображаться
     * именно как радарная картинка.
     */
    forcePixelRendering(
      canvas
    );

    /*
     * Получаем уже существующий
     * 2D context.
     *
     * Новый context здесь НЕ создаём,
     * чтобы ничего не ломать в renderer.
     */
    let ctx = null;

    try {
      ctx =
        canvas.getContext(
          "2d"
        );
    } catch {
      return;
    }

    if (!ctx) {
      return;
    }

    /*
     * Исходный RainRadar уже использует
     * imageSmoothingEnabled=false.
     *
     * Мы принудительно сохраняем это.
     */
    try {
      ctx.imageSmoothingEnabled =
        false;

      ctx.imageSmoothingQuality =
        "low";
    } catch {}
  }


  /* =======================================================
     PROCESS ONE TILE
     ======================================================= */

  function processTile(
    tile
  ) {
    if (!tile) {
      return;
    }

    /*
     * Только настоящий RainRadar tile.
     */
    if (
      !tile.matches(
        TILE_SELECTOR
      )
    ) {
      return;
    }

    /*
     * ВАЖНО:
     *
     * НИКАКОГО getImageData().
     * НИКАКОГО putImageData().
     * НИКАКОГО пересчёта цветов.
     * НИКАКОГО 4×4.
     *
     * Мы НЕ трогаем исходные данные.
     *
     * Меняем только способ отображения.
     */

    forceCanvasContext(
      tile
    );

    /*
     * Leaflet иногда меняет inline style
     * после создания tile.
     *
     * Поэтому ставим свойства непосредственно
     * на canvas.
     */
    tile.style.setProperty(
      "image-rendering",
      "pixelated",
      "important"
    );

    tile.style.setProperty(
      "filter",
      "none",
      "important"
    );

    tile.style.setProperty(
      "transform-style",
      "flat",
      "important"
    );

    /*
     * Не меняем width/height.
     *
     * Leaflet полностью отвечает
     * за геометрию tile.
     */
  }


  /* =======================================================
     PROCESS RAINRADAR LAYER
     * ======================================================= */

  function processLayer(
    layer
  ) {
    if (!layer) {
      return;
    }

    /*
     * Сам контейнер.
     */
    forcePixelRendering(
      layer
    );

    /*
     * Все дочерние canvas.
     */
    const tiles =
      layer.querySelectorAll(
        TILE_SELECTOR
      );

    for (
      const tile of tiles
    ) {
      processTile(
        tile
      );
    }

    /*
     * Leaflet tile containers.
     */
    const containers =
      layer.querySelectorAll(
        ".leaflet-tile-container"
      );

    for (
      const container of containers
    ) {
      /*
       * Здесь тоже нужен pixelated,
       * потому что Leaflet масштабирует
       * сам container через transform.
       */
      forcePixelRendering(
        container
      );
    }

    /*
     * Все img, если Leaflet где-либо
     * использует raster fallback.
     */
    const images =
      layer.querySelectorAll(
        "img.leaflet-tile"
      );

    for (
      const image of images
    ) {
      forcePixelRendering(
        image
      );
    }
  }


  /* =======================================================
     PROCESS EVERYTHING
     ======================================================= */

  function processAll() {
    /*
     * Находим именно RainRadar.
     */
    const layers =
      document.querySelectorAll(
        LAYER_SELECTOR
      );

    for (
      const layer of layers
    ) {
      processLayer(
        layer
      );
    }

    /*
     * Дополнительная проверка самих
     * canvas — на случай если Leaflet
     * перестроил контейнер.
     */
    const tiles =
      document.querySelectorAll(
        TILE_SELECTOR
      );

    for (
      const tile of tiles
    ) {
      processTile(
        tile
      );
    }
  }


  /* =======================================================
     GLOBAL CSS
     ======================================================= */

  function installCSS() {
    if (
      document.getElementById(
        "cloradRainRadarSquareCSS"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "cloradRainRadarSquareCSS";

    style.textContent = `
      /*
       * =================================================
       * CLOrad RainRadar
       * TRUE 1×1 PIXEL DISPLAY
       * =================================================
       */

      ${LAYER_SELECTOR},
      ${LAYER_SELECTOR} *,
      ${TILE_SELECTOR},
      ${LAYER_SELECTOR}
        .leaflet-tile-container,
      ${LAYER_SELECTOR}
        .leaflet-layer,
      ${LAYER_SELECTOR}
        .leaflet-tile {
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


      /*
       * Canvas должен оставаться обычным
       * Leaflet tile.
       *
       * НЕ задаём width.
       * НЕ задаём height.
       * НЕ задаём transform.
       * НЕ задаём position.
       */
      ${TILE_SELECTOR} {
        display:
          block !important;

        padding:
          0 !important;

        margin:
          0 !important;

        border:
          0 !important;

        image-rendering:
          pixelated !important;
      }


      /*
       * Tile container тоже pixelated.
       *
       * Это особенно важно при zoom:
       * Leaflet масштабирует именно
       * контейнер тайлов.
       */
      ${LAYER_SELECTOR}
        .leaflet-tile-container {
        image-rendering:
          pixelated !important;
      }
    `;

    document.head.appendChild(
      style
    );
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

    if (
      !document.body
    ) {
      return;
    }

    observer =
      new MutationObserver(
        mutations => {

          let relevant =
            false;

          for (
            const mutation of mutations
          ) {

            /*
             * Появились новые tiles.
             */
            if (
              mutation.type ===
              "childList"
            ) {
              relevant =
                true;

              break;
            }

            /*
             * Leaflet изменил style/class
             * при zoom/pan.
             */
            if (
              mutation.type ===
              "attributes"
            ) {
              relevant =
                true;

              break;
            }
          }

          if (
            relevant
          ) {
            processAll();
          }
        }
      );

    observer.observe(
      document.body,
      {
        childList:
          true,

        subtree:
          true,

        attributes:
          true,

        attributeFilter:
          [
            "style",
            "class"
          ]
      }
    );
  }


  /* =======================================================
     PERIODIC CHECK
     ======================================================= */

  let timer =
    null;

  function startScanner() {
    if (
      timer
    ) {
      return;
    }

    timer =
      setInterval(
        processAll,
        SCAN_INTERVAL
      );
  }


  /* =======================================================
     MAP EVENTS
     ======================================================= */

  let mapHooked =
    false;

  function hookMap() {
    const map =
      window.map;

    if (
      !map ||
      typeof map.on !==
        "function"
    ) {
      return false;
    }

    if (
      mapHooked
    ) {
      return true;
    }

    mapHooked =
      true;

    /*
     * При каждом zoom Leaflet
     * масштабирует существующие tiles
     * и/или создаёт новые.
     */
    map.on(
      "zoomstart",
      () => {
        processAll();
      }
    );

    map.on(
      "zoom",
      () => {
        processAll();
      }
    );

    map.on(
      "zoomend",
      () => {
        /*
         * Несколько проходов.
         *
         * Leaflet может закончить
         * перестройку tile-container
         * чуть позже zoomend.
         */
        processAll();

        setTimeout(
          processAll,
          0
        );

        setTimeout(
          processAll,
          50
        );

        setTimeout(
          processAll,
          150
        );

        setTimeout(
          processAll,
          300
        );
      }
    );

    map.on(
      "moveend",
      () => {
        processAll();

        setTimeout(
          processAll,
          100
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
      hookMap()
    ) {
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

    /*
     * CSS ставим сразу.
     */
    installCSS();

    /*
     * Существующие tiles.
     */
    processAll();

    /*
     * Новые tiles.
     */
    startObserver();

    /*
     * Дополнительная проверка.
     */
    startScanner();

    /*
     * Leaflet map.
     */
    waitForMap();

    /*
     * RainRadar может создаться
     * уже после загрузки файла.
     */
    setTimeout(
      processAll,
      50
    );

    setTimeout(
      processAll,
      200
    );

    setTimeout(
      processAll,
      500
    );

    setTimeout(
      processAll,
      1000
    );

    setTimeout(
      processAll,
      2000
    );
  }


  /* =======================================================
     PUBLIC DEBUG
     ======================================================= */

  window.CLOrad =
    window.CLOrad || {};

  window.CLOrad.RainRadarSquare =
    {
      refresh:
        processAll
    };


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
        once:
          true
      }
    );

  } else {

    start();

  }

})();
