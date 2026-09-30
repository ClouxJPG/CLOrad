/* =========================================================
   CLOrad — RainRadar Square Renderer
   =========================================================

   ВАЖНО:

   Этот файл НЕ рисует радар заново.

   Он НЕ:
   - перехватывает drawImage
   - меняет tile x/y
   - меняет tile z
   - меняет API
   - меняет URL
   - создаёт новые Leaflet layers
   - копирует содержимое одного tile в другой
   - использует getImageData()
   - использует putImageData()
   - изменяет canvas.width / canvas.height
   - использует MutationObserver

   Его задача ТОЛЬКО:
   - отключить сглаживание;
   - оставить пиксели квадратными;
   - убрать CSS interpolation;
   - не вмешиваться в геометрию Leaflet.

   ========================================================= */

(() => {

  "use strict";


  /* =======================================================
     STYLE
     ======================================================= */

  const STYLE_ID =
    "clorad-rainradar-square";


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

      display:
        block !important;

      width:
        256px !important;

      height:
        256px !important;

      margin:
        0 !important;

      padding:
        0 !important;

      border:
        0 !important;

      box-sizing:
        border-box !important;


      /*
       * Главное:
       * браузер не сглаживает
       * радарные пиксели.
       */

      image-rendering:
        pixelated !important;

      image-rendering:
        crisp-edges !important;

      image-rendering:
        -moz-crisp-edges !important;


      /*
       * Никаких фильтров.
       */

      filter:
        none !important;


      /*
       * Не трогаем transform Leaflet.
       */

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
     * Контейнер тайлов.
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


  /* =======================================================
     DISABLE CANVAS SMOOTHING
     ======================================================= */

  function disableSmoothing() {

    const canvases =
      document.querySelectorAll(
        "canvas.clorad-rainradar-tile"
      );


    for (
      const canvas of canvases
    ) {

      const ctx =
        canvas.getContext(
          "2d"
        );


      if (!ctx) {
        continue;
      }


      ctx.imageSmoothingEnabled =
        false;
    }
  }


  /* =======================================================
     INITIAL RUN
     ======================================================= */

  disableSmoothing();


  /*
   * RainRadar создаёт canvas асинхронно.
   *
   * Поэтому только периодически проверяем
   * уже существующие canvas.
   *
   * Никакого перерисовывания данных нет.
   */

  let checks =
    0;


  const timer =
    setInterval(
      () => {

        disableSmoothing();

        checks++;


        /*
         * После нескольких секунд
         * прекращаем проверку.
         */

        if (
          checks >= 20
        ) {

          clearInterval(
            timer
          );
        }

      },
      250
    );

})();
