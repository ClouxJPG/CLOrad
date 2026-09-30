/* =========================================================
   CLOrad — RainRadar Square Renderer
   ---------------------------------------------------------
   БЕЗОПАСНЫЙ отдельный renderer.

   НЕ изменяет:
   - rainradar.js
   - API
   - источник RainRadar
   - ZOOM
   - palette
   - legend
   - timeline
   - frame switching
   - Leaflet tile coordinates
   - Leaflet tile positioning
   - Leaflet tile geometry

   ВАЖНО:
   Этот файл НИКОГДА не перехватывает
   CanvasRenderingContext2D.prototype.drawImage.

   Каждый RainRadar tile остаётся своим
   отдельным z/x/y tile.

   Задача файла:
   - убрать сглаживание;
   - сохранить квадратную геометрию 256×256;
   - запретить CSS interpolation;
   - не создавать дубликаты тайлов;
   - не переносить содержимое одного тайла
     в другой.
   ========================================================= */

(() => {

  "use strict";


  /* =========================================================
     CONSTANTS
     ========================================================= */

  const STYLE_ID =
    "clorad-rainradar-square-safe";


  const TILE_SIZE =
    256;


  /* =========================================================
     CSS
     ========================================================= */

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
       * RainRadar canvas
       */

      canvas.clorad-rainradar-tile {

        width:
          256px !important;

        height:
          256px !important;

        min-width:
          256px !important;

        min-height:
          256px !important;

        max-width:
          256px !important;

        max-height:
          256px !important;

        display:
          block !important;

        margin:
          0 !important;

        padding:
          0 !important;

        border:
          0 !important;

        box-sizing:
          border-box !important;


        /*
         * Никакого сглаживания.
         */

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          -moz-crisp-edges !important;


        /*
         * Никаких CSS-фильтров.
         */

        filter:
          none !important;


        /*
         * Никакого CSS transform.
         *
         * Leaflet сам позиционирует tile.
         */

        transform:
          none !important;


        /*
         * Никаких transition/animation.
         */

        transition:
          none !important;

        animation:
          none !important;
      }


      /*
       * Только RainRadar layer.
       */

      .clorad-rainradar-layer {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;
      }


      /*
       * Контейнер тайлов.
       *
       * НЕ задаём ему transform,
       * position или размеры.
       *
       * Leaflet должен управлять
       * геометрией самостоятельно.
       */

      .clorad-rainradar-layer
      .leaflet-tile-container {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;
      }


      /*
       * Сам Leaflet tile.
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


  /* =========================================================
     RAINRADAR CANVAS CHECK
     ========================================================= */

  function isRainRadarCanvas(
    canvas
  ) {

    return (
      canvas instanceof
        HTMLCanvasElement &&
      canvas.classList.contains(
        "clorad-rainradar-tile"
      )
    );
  }


  /* =========================================================
     PIXEL SETTINGS
     ========================================================= */

  function configureCanvas(
    canvas
  ) {

    if (
      !isRainRadarCanvas(
        canvas
      )
    ) {
      return;
    }


    /*
     * ВАЖНО:
     *
     * НЕ меняем:
     * canvas.width
     * canvas.height
     *
     * после того, как rainradar.js
     * уже нарисовал данные.
     *
     * Изменение width/height очистило бы
     * bitmap и могло бы сломать кадр.
     */


    const ctx =
      canvas.getContext(
        "2d"
      );


    if (!ctx) {
      return;
    }


    /*
     * Жёстко выключаем interpolation.
     */

    ctx.imageSmoothingEnabled =
      false;


    /*
     * CSS тоже фиксируем.
     */

    canvas.style.width =
      `${TILE_SIZE}px`;

    canvas.style.height =
      `${TILE_SIZE}px`;

    canvas.style.imageRendering =
      "pixelated";
  }


  /* =========================================================
     PROCESS EXISTING TILES
     ========================================================= */

  function processExistingTiles() {

    const canvases =
      document.querySelectorAll(
        "canvas.clorad-rainradar-tile"
      );


    for (
      const canvas of canvases
    ) {

      configureCanvas(
        canvas
      );
    }
  }


  /* =========================================================
     OBSERVER
     ========================================================= */

  function installObserver() {

    /*
     * Никакого observer на document.body.
     *
     * Следим только за появлением canvas
     * внутри Leaflet tile panes.
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
               * Сам node — RainRadar canvas.
               */

              if (
                node instanceof
                  HTMLCanvasElement &&
                isRainRadarCanvas(
                  node
                )
              ) {

                configureCanvas(
                  node
                );
              }


              /*
               * Проверяем canvas внутри
               * добавленного Leaflet элемента.
               */

              if (
                node.querySelectorAll
              ) {

                const canvases =
                  node.querySelectorAll(
                    "canvas.clorad-rainradar-tile"
                  );


                for (
                  const canvas of canvases
                ) {

                  configureCanvas(
                    canvas
                  );
                }
              }
            }
          }
        }
      );


    /*
     * Только tile panes.
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
            .cloradRainRadarSquare ===
          "1"
        ) {
          continue;
        }


        pane.dataset
          .cloradRainRadarSquare =
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
      300
    );


    setTimeout(
      attach,
      1000
    );


    setTimeout(
      attach,
      2500
    );


    setTimeout(
      attach,
      5000
    );
  }


  /* =========================================================
     INIT
     ========================================================= */

  function init() {

    installCSS();

    processExistingTiles();

    installObserver();
  }


  /* =========================================================
     START
     ========================================================= */

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
