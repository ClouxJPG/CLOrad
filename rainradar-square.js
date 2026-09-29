/* =========================================================
   CLOrad — RainRadar 1×1 / Nowcast-style square cells

   ВАЖНО:
   - НЕ создаёт новый Leaflet-слой
   - НЕ меняет RainRadar API
   - НЕ меняет источник данных
   - НЕ меняет палитру
   - НЕ меняет таймлайн
   - НЕ меняет legend
   - НЕ меняет координаты / bounds
   - НЕ использует MutationObserver
   - НЕ использует CSS transform
   - НЕ масштабирует весь tile

   ДЕЛАЕТ:
   - работает только с уже существующими
     RainRadar canvas
   - делает радарные ячейки визуально
     крупнее и квадратнее
   - сохраняет резкие границы
   - сохраняет размер каждого Leaflet tile = 256×256
   - не создаёт зазоров между tile
   - сетка квадратов начинается с 0,0
     каждого tile, поэтому границы tile
     остаются ровными

   ВАЖНО ПРО 1×1:
   - исходные данные RainRadar не меняются
   - API получает те же самые PNG
   - визуальная обработка происходит
     только после отрисовки PNG на canvas

   DISPLAY_BLOCK = 2 означает:
   1 исходная raster-ячейка визуально
   показывается как квадрат 2×2 px.

   Это сделано специально для вида,
   близкого к Nowcast.
   ========================================================= */

(() => {
  "use strict";


  /* =======================================================
     НАСТРОЙКИ
     ======================================================= */

  const TILE_SELECTOR =
    "canvas.clorad-rainradar-tile";

  const LAYER_SELECTOR =
    ".clorad-rainradar-layer";

  /*
   * Размер визуального квадрата.
   *
   * 1 = обычный вид
   * 2 = крупные квадратные ячейки
   *
   * Именно 2 сейчас нужен для вида
   * близкого к Nowcast.
   */
  const DISPLAY_BLOCK = 2;


  /*
   * Проверка новых / обновлённых
   * RainRadar canvas.
   *
   * Никакого MutationObserver.
   */
  const CHECK_INTERVAL = 500;


  /*
   * Минимальный размер canvas,
   * с которым вообще работаем.
   */
  const TILE_SIZE = 256;


  /* =======================================================
     CHECK CANVAS
     ======================================================= */

  function isRainRadarCanvas(canvas) {
    if (!canvas) {
      return false;
    }

    return canvas.matches(
      TILE_SELECTOR
    );
  }


  /* =======================================================
     PIXELATE CANVAS
     ======================================================= */

  function pixelateCanvas(canvas) {
    if (!isRainRadarCanvas(canvas)) {
      return;
    }

    /*
     * RainRadar tile должен быть 256×256.
     *
     * Если Leaflet ещё не закончил
     * создание canvas — пропускаем.
     */
    const width =
      canvas.width;

    const height =
      canvas.height;

    if (
      width !== TILE_SIZE ||
      height !== TILE_SIZE
    ) {
      return;
    }


    /*
     * Не используем CSS transform.
     *
     * Не меняем размеры canvas.
     *
     * Работаем непосредственно
     * с уже отображённым raster.
     */
    let ctx;

    try {
      ctx =
        canvas.getContext("2d", {
          willReadFrequently: true
        });
    } catch (_) {
      return;
    }

    if (!ctx) {
      return;
    }


    let imageData;

    try {
      imageData =
        ctx.getImageData(
          0,
          0,
          width,
          height
        );
    } catch (_) {
      return;
    }


    const source =
      imageData.data;


    /*
     * Новый массив такого же размера.
     *
     * Мы НЕ меняем геометрию tile.
     *
     * Всё остаётся строго 256×256.
     */
    const output =
      new Uint8ClampedArray(
        source.length
      );


    /*
     * DISPLAY_BLOCK = 2
     *
     * Поэтому карта 256×256
     * визуально разбивается на:
     *
     * 128 × 128 крупных блоков.
     *
     * Каждый блок занимает:
     *
     *     2 × 2 px
     *
     * на экране.
     *
     * Границы tile:
     *
     * 256 / 2 = 128
     *
     * делятся без остатка.
     *
     * Поэтому между соседними tile
     * не появляется смещение сетки.
     */
    const block =
      DISPLAY_BLOCK;


    const blocksX =
      Math.ceil(
        width / block
      );

    const blocksY =
      Math.ceil(
        height / block
      );


    /*
     * Проходим по визуальным блокам.
     */
    for (
      let blockY = 0;
      blockY < blocksY;
      blockY++
    ) {

      for (
        let blockX = 0;
        blockX < blocksX;
        blockX++
      ) {

        /*
         * Берём исходную ячейку
         * в левом верхнем углу
         * каждого блока.
         *
         * Это НЕ усреднение цветов.
         *
         * Поэтому цвет остаётся
         * именно цветом исходной
         * радарной категории.
         */
        const sourceX =
          Math.min(
            width - 1,
            blockX * block
          );

        const sourceY =
          Math.min(
            height - 1,
            blockY * block
          );


        const sourceIndex =
          (
            sourceY * width +
            sourceX
          ) * 4;


        const r =
          source[sourceIndex];

        const g =
          source[
            sourceIndex + 1
          ];

        const b =
          source[
            sourceIndex + 2
          ];

        const a =
          source[
            sourceIndex + 3
          ];


        /*
         * Заполняем весь квадрат
         * одним и тем же значением.
         */
        for (
          let py = 0;
          py < block;
          py++
        ) {

          const y =
            blockY * block +
            py;

          if (
            y >= height
          ) {
            continue;
          }


          for (
            let px = 0;
            px < block;
            px++
          ) {

            const x =
              blockX * block +
              px;

            if (
              x >= width
            ) {
              continue;
            }


            const outputIndex =
              (
                y * width +
                x
              ) * 4;


            output[
              outputIndex
            ] = r;

            output[
              outputIndex + 1
            ] = g;

            output[
              outputIndex + 2
            ] = b;

            output[
              outputIndex + 3
            ] = a;
          }
        }
      }
    }


    /*
     * Записываем готовую
     * пикселизированную картинку
     * обратно в тот же canvas.
     *
     * Никакого нового слоя.
     */
    try {
      ctx.putImageData(
        new ImageData(
          output,
          width,
          height
        ),
        0,
        0
      );
    } catch (_) {
      /*
       * Safari/iOS fallback.
       */
      try {
        imageData.data.set(
          output
        );

        ctx.putImageData(
          imageData,
          0,
          0
        );
      } catch (_) {
        return;
      }
    }


    /*
     * Дополнительная защита
     * от browser interpolation.
     */
    canvas.style.setProperty(
      "image-rendering",
      "pixelated",
      "important"
    );

    canvas.style.setProperty(
      "filter",
      "none",
      "important"
    );

    canvas.style.setProperty(
      "transition",
      "none",
      "important"
    );
  }


  /* =======================================================
     APPLY TO ONE CANVAS
     ======================================================= */

  function applyToCanvas(canvas) {
    if (
      !isRainRadarCanvas(canvas)
    ) {
      return;
    }


    /*
     * Canvas должен уже содержать
     * готовые радарные данные.
     *
     * Если он пустой — ничего страшного:
     * следующий проход обработает его
     * после загрузки.
     */
    pixelateCanvas(
      canvas
    );


    /*
     * Убираем interpolation.
     */
    try {
      const ctx =
        canvas.getContext(
          "2d"
        );

      if (ctx) {
        ctx.imageSmoothingEnabled =
          false;

        ctx.imageSmoothingQuality =
          "low";
      }
    } catch (_) {
      /*
       * Ничего.
       */
    }
  }


  /* =======================================================
     APPLY TO EXISTING RAINRADAR
     ======================================================= */

  function apply() {

    /*
     * Ищем только уже существующие
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
     * Устанавливаем CSS.
     */
    installCSS();


    /*
     * Обрабатываем уже существующие
     * RainRadar tiles.
     */
    apply();


    /*
     * Проверяем появление новых
     * canvas после смены кадра,
     * zoom или перезагрузки данных.
     *
     * MutationObserver специально
     * НЕ используется.
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
