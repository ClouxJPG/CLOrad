/* =========================================================
   CLOrad — RainRadar 1×1 Square Renderer
   =========================================================

   ЦЕЛЬ:
   Отображать исходную радарную сетку RainRadar
   как жёсткие квадратные ячейки без искусственного
   увеличения пикселей.

   ВАЖНО:
   - НЕ изменяет rainradar.js
   - НЕ изменяет API
   - НЕ изменяет URL
   - НЕ изменяет z/x/y
   - НЕ изменяет Leaflet geometry
   - НЕ копирует один tile в другой
   - НЕ использует getImageData()
   - НЕ использует putImageData()
   - НЕ перехватывает drawImage()
   - НЕ создаёт дополнительные Leaflet layers
   - НЕ создаёт анимацию
   - НЕ делает GIF-пикселизацию

   1×1 здесь означает:
   исходная радарная ячейка не превращается
   искусственно в 4×4 / 5×5 / 8×8 блок.

   ========================================================= */

(() => {

  "use strict";


  /* =======================================================
     CONSTANTS
     ======================================================= */

  const STYLE_ID =
    "clorad-rainradar-1x1-real";


  /* =======================================================
     INSTALL CSS
     ======================================================= */

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
       * =====================================================
       * RainRadar canvas
       * =====================================================
       */

      canvas.clorad-rainradar-tile {

        display:
          block !important;

        margin:
          0 !important;

        padding:
          0 !important;

        border:
          0 !important;

        filter:
          none !important;

        transition:
          none !important;

        animation:
          none !important;

        /*
         * Главное:
         * никакого сглаживания радарной сетки.
         */

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          -moz-crisp-edges !important;
      }


      /*
       * =====================================================
       * RainRadar Leaflet layer
       * =====================================================
       */

      .clorad-rainradar-layer {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;
      }


      /*
       * =====================================================
       * Tile container
       *
       * НЕ меняем:
       * position
       * transform
       * width
       * height
       *
       * Это полностью оставляем Leaflet.
       * =====================================================
       */

      .clorad-rainradar-layer
      .leaflet-tile-container {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;
      }


      /*
       * =====================================================
       * Individual tile
       * =====================================================
       */

      .clorad-rainradar-layer
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

    `;


    document.head.appendChild(
      style
    );
  }


  /* =======================================================
     DISABLE CANVAS SMOOTHING
     ======================================================= */

  function disableSmoothing(
    canvas
  ) {

    if (
      !(canvas instanceof
        HTMLCanvasElement)
    ) {
      return;
    }


    if (
      !canvas.classList.contains(
        "clorad-rainradar-tile"
      )
    ) {
      return;
    }


    const ctx =
      canvas.getContext(
        "2d"
      );


    if (!ctx) {
      return;
    }


    /*
     * Браузер больше не имеет права
     * интерполировать радарные пиксели.
     */

    ctx.imageSmoothingEnabled =
      false;


    /*
     * Дополнительно фиксируем
     * pixelated rendering.
     */

    canvas.style.imageRendering =
      "pixelated";
  }


  /* =======================================================
     PROCESS CURRENT TILES
     ======================================================= */

  function processCurrentTiles() {

    const tiles =
      document.querySelectorAll(
        "canvas.clorad-rainradar-tile"
      );


    for (
      const tile of tiles
    ) {

      disableSmoothing(
        tile
      );
    }
  }


  /* =======================================================
     OBSERVER
     ======================================================= */

  function installObserver() {

    /*
     * ВАЖНО:
     * не наблюдаем весь document.body.
     */

    const observer =
      new MutationObserver(
        mutations => {

          for (
            const mutation of mutations
          ) {

            for (
              const node of
                mutation.addedNodes
            ) {

              if (
                node.nodeType !== 1
              ) {
                continue;
              }


              /*
               * Сам node — canvas.
               */

              if (
                node instanceof
                  HTMLCanvasElement
              ) {

                disableSmoothing(
                  node
                );
              }


              /*
               * Canvas внутри нового
               * Leaflet элемента.
               */

              if (
                node.querySelectorAll
              ) {

                const tiles =
                  node.querySelectorAll(
                    "canvas.clorad-rainradar-tile"
                  );


                for (
                  const tile of tiles
                ) {

                  disableSmoothing(
                    tile
                  );
                }
              }
            }
          }
        }
      );


    /*
     * Подключаемся только к Leaflet
     * tile pane.
     */

    function attach() {

      const panes =
        document.querySelectorAll(
          ".leaflet-tile-pane"
        );


      for (
        const pane of panes
      ) {

        if (
          pane.dataset
            .cloradRainRadar1x1 ===
          "1"
        ) {
          continue;
        }


        pane.dataset
          .cloradRainRadar1x1 =
          "1";


        observer.observe(
          pane,
          {
            childList:
              true,

            subtree:
              true
          }
        );
      }
    }


    attach();


    setTimeout(
      attach,
      250
    );


    setTimeout(
      attach,
      750
    );


    setTimeout(
      attach,
      1500
    );


    setTimeout(
      attach,
      3000
    );
  }


  /* =======================================================
     INIT
     ======================================================= */

  function init() {

    installCSS();

    processCurrentTiles();

    installObserver();
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
      init,
      {
        once:
          true
      }
    );

  } else {

    init();
  }

})();
