/* =========================================================
   CLOrad — RainRadar Square / 1×1 Renderer
   =========================================================

   ЗАДАЧА:
   Сделать радарные ячейки квадратными и пиксельными,
   визуально близкими к 1×1 км ДМРЛ-С на скриншоте.

   ВАЖНО:
   - rainradar.js НЕ изменяется
   - API НЕ изменяется
   - z/x/y НЕ изменяются
   - URL тайлов НЕ изменяется
   - Leaflet geometry НЕ изменяется
   - тайлы НЕ объединяются
   - каждый canvas обрабатывается отдельно
   - глобальный drawImage НЕ перехватывается
   - другие canvas сайта НЕ затрагиваются

   PIXEL_SIZE:
   4 CSS px

   Это визуальный размер блока.
   Физическое разрешение исходных данных остаётся
   разрешением PNG RainRadar.
   ========================================================= */

(() => {

  "use strict";


  /* =======================================================
     SETTINGS
     ======================================================= */

  /*
   * Размер одного отображаемого квадратного
   * радарного блока.
   *
   * На твоём скриншоте визуально подходит
   * примерно 4×4 экранных пикселя.
   */

  const PIXEL_SIZE = 4;


  /*
   * Уникальный ID стиля.
   */

  const STYLE_ID =
    "clorad-rainradar-square-1x1";


  /*
   * Не обрабатывать один canvas несколько раз
   * подряд.
   */

  const PROCESSED_ATTR =
    "data-clorad-square-rendered";


  /* =======================================================
     CSS
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
       * RainRadar tile.
       *
       * Leaflet сам отвечает за position,
       * width, height и transform.
       */

      canvas.clorad-rainradar-tile {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        image-rendering:
          -moz-crisp-edges !important;

        filter:
          none !important;

        transition:
          none !important;

        animation:
          none !important;
      }


      /*
       * RainRadar layer.
       */

      .clorad-rainradar-layer {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;
      }


      /*
       * Tile container.
       *
       * НИЧЕГО не меняем в geometry.
       */

      .clorad-rainradar-layer
      .leaflet-tile-container {

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;
      }


      /*
       * Сам tile.
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
     CHECK
     ======================================================= */

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


  /* =======================================================
     PIXELATE ONE TILE
     ======================================================= */

  function pixelateTile(
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
     * Не обрабатываем один и тот же
     * готовый canvas повторно.
     */

    if (
      canvas.getAttribute(
        PROCESSED_ATTR
      ) === "1"
    ) {
      return;
    }


    /*
     * RainRadar canvas должен быть
     * стандартным 256×256.
     *
     * Если нет — не вмешиваемся.
     */

    if (
      canvas.width !== 256 ||
      canvas.height !== 256
    ) {
      return;
    }


    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true
        }
      );


    if (!ctx) {
      return;
    }


    /*
     * Получаем bitmap конкретно ЭТОГО tile.
     *
     * Никаких соседних canvas.
     */

    let image;

    try {

      image =
        ctx.getImageData(
          0,
          0,
          256,
          256
        );

    } catch (_) {

      return;
    }


    const data =
      image.data;


    /*
     * Если PIXEL_SIZE = 1,
     * ничего дополнительно делать не надо.
     */

    if (
      PIXEL_SIZE <= 1
    ) {

      ctx.imageSmoothingEnabled =
        false;

      canvas.setAttribute(
        PROCESSED_ATTR,
        "1"
      );

      return;
    }


    /*
     * Квадратная пикселизация.
     *
     * Каждый блок получает цвет
     * своего верхнего левого пикселя.
     *
     * Это nearest-neighbor,
     * без среднего цвета и без blur.
     */

    for (
      let y = 0;
      y < 256;
      y += PIXEL_SIZE
    ) {

      for (
        let x = 0;
        x < 256;
        x += PIXEL_SIZE
      ) {

        const sx =
          x;

        const sy =
          y;


        const sourceIndex =
          (
            sy * 256 +
            sx
          ) * 4;


        const r =
          data[sourceIndex];

        const g =
          data[sourceIndex + 1];

        const b =
          data[sourceIndex + 2];

        const a =
          data[sourceIndex + 3];


        /*
         * Заполняем только этот блок.
         */

        const maxY =
          Math.min(
            y + PIXEL_SIZE,
            256
          );

        const maxX =
          Math.min(
            x + PIXEL_SIZE,
            256
          );


        for (
          let py = y;
          py < maxY;
          py++
        ) {

          for (
            let px = x;
            px < maxX;
            px++
          ) {

            const index =
              (
                py * 256 +
                px
              ) * 4;


            data[index] =
              r;

            data[index + 1] =
              g;

            data[index + 2] =
              b;

            data[index + 3] =
              a;
          }
        }
      }
    }


    /*
     * Возвращаем изменённый bitmap
     * обратно В ЭТОТ ЖЕ canvas.
     */

    ctx.imageSmoothingEnabled =
      false;


    ctx.putImageData(
      image,
      0,
      0
    );


    /*
     * CSS pixelated.
     */

    canvas.style.imageRendering =
      "pixelated";


    /*
     * Отмечаем обработанный tile.
     */

    canvas.setAttribute(
      PROCESSED_ATTR,
      "1"
    );
  }


  /* =======================================================
     PROCESS EXISTING TILES
     ======================================================= */

  function processExistingTiles() {

    const canvases =
      document.querySelectorAll(
        "canvas.clorad-rainradar-tile"
      );


    for (
      const canvas of canvases
    ) {

      pixelateTile(
        canvas
      );
    }
  }


  /* =======================================================
     OBSERVER
     ======================================================= */

  function installObserver() {

    /*
     * Следим только за Leaflet tile pane.
     *
     * Не наблюдаем весь document.body.
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
               * Если добавили сам canvas.
               */

              if (
                node instanceof
                  HTMLCanvasElement &&
                isRainRadarCanvas(
                  node
                )
              ) {

                /*
                 * RainRadar должен сначала
                 * закончить рисование.
                 */

                setTimeout(
                  () => {

                    pixelateTile(
                      node
                    );

                  },
                  0
                );
              }


              /*
               * Если canvas находится
               * внутри добавленного элемента.
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

                  setTimeout(
                    () => {

                      pixelateTile(
                        canvas
                      );

                    },
                    0
                  );
                }
              }
            }
          }
        }
      );


    /*
     * Leaflet создаёт pane динамически,
     * поэтому ищем его несколько раз.
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
            .cloradRainRadarSquare1x1 ===
          "1"
        ) {
          continue;
        }


        pane.dataset
          .cloradRainRadarSquare1x1 =
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

    processExistingTiles();

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
