/* =========================================================
   CLOrad — Radar Smoothing
   Data-aware smoothing без фейковых цветов

   0%  = оригинальный GIF
   1–100% = сглаживание формы радарных пикселей

   ВАЖНО:
   - RGB никогда не интерполируется
   - используются только цвета исходной палитры
   - прозрачный фон не превращается в осадки
   - GIF остаётся привязанным к GIF_BOUNDS
   - при 0% обработка полностью отключена
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const DEFAULT_LEVEL = 0;
  const MIN_LEVEL = 0;
  const MAX_LEVEL = 100;

  /*
     Максимальное увеличение растра.

     2x достаточно для плавных границ и значительно
     дешевле для iPhone, чем 3x/4x.
  */
  const OUTPUT_SCALE = 2;

  /*
     Минимальная непрозрачность антиалиасинга.
     Цвет при этом ВСЕГДА остаётся настоящим цветом палитры.
  */
  const MIN_EDGE_ALPHA = 0.12;

  /*
     Кэш обработанных кадров.
     Ограничиваем количество, чтобы не съедать память iPhone.
  */
  const MAX_CACHE = 6;

  /* =======================================================
     STATE
     ======================================================= */

  let smoothingLevel = DEFAULT_LEVEL;

  const imageStates = new WeakMap();

  const processedCache = new Map();

  let processingGeneration = 0;

  let settingsObserver = null;
  let imageObserver = null;
  let bodyObserver = null;

  /* =======================================================
     HELPERS
     ======================================================= */

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getSmoothingLevel() {
    return smoothingLevel;
  }

  function getRadarImages() {
    return Array.from(
      document.querySelectorAll(
        "img.clorad-gif-radar-image"
      )
    );
  }

  /* =======================================================
     PALETTE
     ======================================================= */

  /*
     Получаем цвета прямо из легенды CLOrad.

     Это позволяет работать и с РГМЦ, и с ИРАМ,
     и с пользовательскими палитрами.
  */

  function readPalette() {
    const colors = [];

    for (let i = 1; i <= 19; i++) {
      const element = document.querySelector(
        ".l" + i
      );

      if (!element) {
        colors.push(null);
        continue;
      }

      const style = getComputedStyle(element);

      let color =
        style.backgroundColor ||
        style.background ||
        "";

      const match = color.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i
      );

      if (match) {
        colors.push([
          Number(match[1]),
          Number(match[2]),
          Number(match[3])
        ]);

        continue;
      }

      if (
        color.startsWith("#")
      ) {
        let hex = color.slice(1);

        if (hex.length === 3) {
          hex =
            hex[0] + hex[0] +
            hex[1] + hex[1] +
            hex[2] + hex[2];
        }

        if (hex.length === 6) {
          colors.push([
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16)
          ]);

          continue;
        }
      }

      colors.push(null);
    }

    /*
       Если легенда ещё не готова,
       используем палитру из gif-radar.js.
    */

    if (
      colors.filter(Boolean).length !== 19 &&
      Array.isArray(window.RGMC_OY_PALETTE)
    ) {
      return window.RGMC_OY_PALETTE.map(hexToRGB);
    }

    if (
      colors.filter(Boolean).length !== 19 &&
      Array.isArray(window.IRAM_OY_PALETTE)
    ) {
      return window.IRAM_OY_PALETTE.map(hexToRGB);
    }

    return colors;
  }

  function hexToRGB(hex) {
    if (
      typeof hex !== "string"
    ) {
      return [0, 0, 0];
    }

    let value = hex.replace(
      "#",
      ""
    );

    if (value.length === 3) {
      value =
        value[0] + value[0] +
        value[1] + value[1] +
        value[2] + value[2];
    }

    return [
      parseInt(value.slice(0, 2), 16) || 0,
      parseInt(value.slice(2, 4), 16) || 0,
      parseInt(value.slice(4, 6), 16) || 0
    ];
  }

  /* =======================================================
     COLOR → RADAR CLASS
     ======================================================= */

  function colorDistanceSquared(
    r,
    g,
    b,
    color
  ) {
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];

    return (
      dr * dr +
      dg * dg +
      db * db
    );
  }

  function nearestPaletteIndex(
    r,
    g,
    b,
    palette
  ) {
    let bestIndex = -1;
    let bestDistance = Infinity;

    for (
      let i = 0;
      i < palette.length;
      i++
    ) {
      const color = palette[i];

      if (!color) {
        continue;
      }

      const distance =
        colorDistanceSquared(
          r,
          g,
          b,
          color
        );

      if (
        distance <
        bestDistance
      ) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  /* =======================================================
     IMAGE LOADING
     ======================================================= */

  function loadImage(url) {
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        image.crossOrigin =
          "anonymous";

        image.onload = () =>
          resolve(image);

        image.onerror = reject;

        image.src = url;
      }
    );
  }

  /* =======================================================
     SOURCE RASTER
     ======================================================= */

  function readSourceRaster(image) {
    const width =
      image.naturalWidth ||
      image.width;

    const height =
      image.naturalHeight ||
      image.height;

    if (
      !width ||
      !height
    ) {
      return null;
    }

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = width;
    canvas.height = height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );

    ctx.drawImage(
      image,
      0,
      0,
      width,
      height
    );

    const data =
      ctx.getImageData(
        0,
        0,
        width,
        height
      ).data;

    return {
      width,
      height,
      data
    };
  }

  /* =======================================================
     CLASS FIELD
     ======================================================= */

  /*
     Вместо RGB создаём поле классов.

     -1 = прозрачный/фон
      0..18 = реальный радарный уровень
  */

  function buildClassField(
    raster,
    palette
  ) {
    const {
      width,
      height,
      data
    } = raster;

    const field =
      new Int8Array(
        width * height
      );

    field.fill(-1);

    for (
      let y = 0;
      y < height;
      y++
    ) {
      const row =
        y * width;

      for (
        let x = 0;
        x < width;
        x++
      ) {
        const index =
          (row + x) * 4;

        const alpha =
          data[index + 3];

        /*
           Полностью прозрачные пиксели
           никогда не участвуют в сглаживании.
        */

        if (
          alpha < 30
        ) {
          continue;
        }

        const r =
          data[index];

        const g =
          data[index + 1];

        const b =
          data[index + 2];

        /*
           Почти белые/прозрачные служебные
           области считаем фоном.
        */

        if (
          alpha < 60 &&
          r > 180 &&
          g > 180 &&
          b > 180
        ) {
          continue;
        }

        const paletteIndex =
          nearestPaletteIndex(
            r,
            g,
            b,
            palette
          );

        if (
          paletteIndex >= 0
        ) {
          field[row + x] =
            paletteIndex;
        }
      }
    }

    return field;
  }

  /* =======================================================
     LOCAL DATA SMOOTHING
     ======================================================= */

  /*
     Сглаживаем именно поле данных.

     Мы НЕ смешиваем RGB.

     Это важно:
       зелёный + жёлтый
     никогда не превращается в
       какой-нибудь "грязно-зелёный".

     В результате будет либо зелёный,
     либо жёлтый.
  */

  function smoothClassField(
    field,
    width,
    height,
    amount
  ) {
    if (
      amount <= 0
    ) {
      return field;
    }

    const result =
      new Int8Array(
        field.length
      );

    result.set(field);

    /*
       Радиус зависит от силы сглаживания.
       Максимум 2 исходных пикселя.

       Это предотвращает сильное
       расползание радарных ячеек.
    */

    const radius =
      amount < 25
        ? 1
        : amount < 65
          ? 1
          : 2;

    /*
       Чем выше уровень,
       тем сильнее влияние соседей.
    */

    const strength =
      amount / 100;

    for (
      let y = 0;
      y < height;
      y++
    ) {
      for (
        let x = 0;
        x < width;
        x++
      ) {
        const center =
          field[
            y * width + x
          ];

        /*
           Фон не превращаем
           в радар.
        */

        if (
          center < 0
        ) {
          continue;
        }

        const scores =
          new Float32Array(
            19
          );

        let total =
          0;

        /*
           Небольшой локальный
           data-aware kernel.
        */

        for (
          let dy = -radius;
          dy <= radius;
          dy++
        ) {
          const yy =
            y + dy;

          if (
            yy < 0 ||
            yy >= height
          ) {
            continue;
          }

          for (
            let dx = -radius;
            dx <= radius;
            dx++
          ) {
            const xx =
              x + dx;

            if (
              xx < 0 ||
              xx >= width
            ) {
              continue;
            }

            const value =
              field[
                yy * width + xx
              ];

            if (
              value < 0
            ) {
              continue;
            }

            const distance =
              Math.abs(dx) +
              Math.abs(dy);

            let weight;

            if (
              distance === 0
            ) {
              weight = 1;
            } else if (
              distance === 1
            ) {
              weight =
                0.55 *
                strength;
            } else if (
              distance === 2
            ) {
              weight =
                0.20 *
                strength;
            } else {
              weight =
                0.08 *
                strength;
            }

            scores[value] +=
              weight;

            total +=
              weight;
          }
        }

        if (
          total <= 0
        ) {
          continue;
        }

        /*
           Центр всегда имеет
           дополнительный вес.

           Поэтому соседний цвет
           не сможет просто "перекрыть"
           реальные данные.
        */

        scores[center] +=
          1.5;

        let best =
          center;

        let bestScore =
          scores[center];

        for (
          let i = 0;
          i < 19;
          i++
        ) {
          if (
            scores[i] >
            bestScore
          ) {
            bestScore =
              scores[i];

            best = i;
          }
        }

        result[
          y * width + x
        ] = best;
      }
    }

    return result;
  }

  /* =======================================================
     EDGE COVERAGE
     ======================================================= */

  /*
     Эта функция делает края визуально
     округлыми.

     ВАЖНО:
     альфа меняется,
     RGB НЕ меняется.

     Поэтому новые цвета не появляются.
  */

  function getCoverage(
    field,
    width,
    height,
    x,
    y,
    level
  ) {
    const index =
      y * width + x;

    if (
      field[index] < 0
    ) {
      return 0;
    }

    /*
       При 0% вообще не вызывается.
    */

    if (
      level <= 0
    ) {
      return 1;
    }

    let neighbors = 0;
    let valid = 0;

    /*
       Проверяем 8 соседей.
    */

    for (
      let dy = -1;
      dy <= 1;
      dy++
    ) {
      for (
        let dx = -1;
        dx <= 1;
        dx++
      ) {
        if (
          dx === 0 &&
          dy === 0
        ) {
          continue;
        }

        const xx =
          x + dx;

        const yy =
          y + dy;

        if (
          xx < 0 ||
          yy < 0 ||
          xx >= width ||
          yy >= height
        ) {
          continue;
        }

        valid++;

        if (
          field[
            yy * width + xx
          ] >= 0
        ) {
          neighbors++;
        }
      }
    }

    /*
       Внутренние пиксели
       остаются полностью непрозрачными.
    */

    if (
      neighbors >= 7
    ) {
      return 1;
    }

    /*
       Крайние пиксели получают
       плавную геометрическую маску.
    */

    const ratio =
      neighbors /
      Math.max(1, valid);

    /*
       Чем сильнее сглаживание,
       тем сильнее округляем край.
    */

    const smoothing =
      level / 100;

    const coverage =
      0.35 +
      ratio * 0.65 +
      smoothing * 0.12;

    return clamp(
      coverage,
      MIN_EDGE_ALPHA,
      1
    );
  }

  /* =======================================================
     RENDER
     ======================================================= */

  function renderSmoothed(
    field,
    width,
    height,
    palette,
    level
  ) {
    const outWidth =
      width *
      OUTPUT_SCALE;

    const outHeight =
      height *
      OUTPUT_SCALE;

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      outWidth;

    canvas.height =
      outHeight;

    const ctx =
      canvas.getContext(
        "2d"
      );

    const output =
      ctx.createImageData(
        outWidth,
        outHeight
      );

    const data =
      output.data;

    /*
       Сначала вычисляем каждый
       выходной пиксель.

       Используем nearest source class,
       а не RGB interpolation.
    */

    for (
      let oy = 0;
      oy < outHeight;
      oy++
    ) {
      const sourceY =
        Math.min(
          height - 1,
          Math.floor(
            oy /
            OUTPUT_SCALE
          )
        );

      for (
        let ox = 0;
        ox < outWidth;
        ox++
      ) {
        const sourceX =
          Math.min(
            width - 1,
            Math.floor(
              ox /
              OUTPUT_SCALE
            )
          );

        const classIndex =
          field[
            sourceY *
              width +
            sourceX
          ];

        const outputIndex =
          (
            oy *
              outWidth +
            ox
          ) * 4;

        if (
          classIndex < 0
        ) {
          data[
            outputIndex + 3
          ] = 0;

          continue;
        }

        const color =
          palette[
            classIndex
          ];

        if (!color) {
          data[
            outputIndex + 3
          ] = 0;

          continue;
        }

        data[
          outputIndex
        ] = color[0];

        data[
          outputIndex + 1
        ] = color[1];

        data[
          outputIndex + 2
        ] = color[2];

        const coverage =
          getCoverage(
            field,
            width,
            height,
            sourceX,
            sourceY,
            level
          );

        data[
          outputIndex + 3
        ] =
          Math.round(
            255 *
            coverage
          );
      }
    }

    ctx.putImageData(
      output,
      0,
      0
    );

    return canvas;
  }

  /* =======================================================
     CACHE
     ======================================================= */

  function cacheKey(
    url,
    level
  ) {
    return (
      String(url) +
      "|" +
      String(level)
    );
  }

  function getCached(
    key
  ) {
    if (
      !processedCache.has(
        key
      )
    ) {
      return null;
    }

    const value =
      processedCache.get(
        key
      );

    /*
       LRU:
       переносим элемент
       в конец Map.
    */

    processedCache.delete(
      key
    );

    processedCache.set(
      key,
      value
    );

    return value;
  }

  function putCached(
    key,
    value
  ) {
    processedCache.delete(
      key
    );

    processedCache.set(
      key,
      value
    );

    while (
      processedCache.size >
      MAX_CACHE
    ) {
      const first =
        processedCache.keys()
          .next()
          .value;

      processedCache.delete(
        first
      );
    }
  }

  function clearCache() {
    processedCache.clear();
  }

  /* =======================================================
     PROCESS IMAGE
     ======================================================= */

  async function processImage(
    img
  ) {
    if (!img) {
      return;
    }

    const level =
      smoothingLevel;

    /*
       0% = оригинал.
       Никакой обработки.
    */

    if (
      level <= 0
    ) {
      restoreOriginal(
        img
      );

      return;
    }

    const state =
      imageStates.get(
        img
      ) || {};

    const originalURL =
      state.sourceURL ||
      img.dataset.cloradOriginalSrc ||
      img.currentSrc ||
      img.src;

    if (!originalURL) {
      return;
    }

    const key =
      cacheKey(
        originalURL,
        level
      );

    const cached =
      getCached(key);

    if (cached) {
      applyProcessedURL(
        img,
        cached,
        originalURL
      );

      return;
    }

    const generation =
      processingGeneration;

    /*
       Небольшая пауза позволяет
       не запускать обработку каждого
       промежуточного src при быстрой
       смене кадров.
    */

    await new Promise(
      resolve =>
        requestAnimationFrame(
          resolve
        )
    );

    if (
      generation !==
      processingGeneration
    ) {
      return;
    }

    let image;

    try {
      image =
        await loadImage(
          originalURL
        );
    } catch {
      return;
    }

    if (
      generation !==
      processingGeneration
    ) {
      return;
    }

    const raster =
      readSourceRaster(
        image
      );

    if (!raster) {
      return;
    }

    const palette =
      readPalette();

    if (
      !palette ||
      palette.filter(Boolean)
        .length !== 19
    ) {
      return;
    }

    const field =
      buildClassField(
        raster,
        palette
      );

    if (
      generation !==
      processingGeneration
    ) {
      return;
    }

    const smoothed =
      smoothClassField(
        field,
        raster.width,
        raster.height,
        level
      );

    if (
      generation !==
      processingGeneration
    ) {
      return;
    }

    const canvas =
      renderSmoothed(
        smoothed,
        raster.width,
        raster.height,
        palette,
        level
      );

    const resultURL =
      canvas.toDataURL(
        "image/png"
      );

    putCached(
      key,
      resultURL
    );

    applyProcessedURL(
      img,
      resultURL,
      originalURL
    );
  }

  /* =======================================================
     APPLY URL
     ======================================================= */

  function applyProcessedURL(
    img,
    url,
    originalURL
  ) {
    if (!img) {
      return;
    }

    let state =
      imageStates.get(
        img
      );

    if (!state) {
      state = {};
      imageStates.set(
        img,
        state
      );
    }

    state.sourceURL =
      originalURL;

    state.outputURL =
      url;

    img.dataset.cloradOriginalSrc =
      originalURL;

    if (
      img.src !== url
    ) {
      img.src = url;
    }
  }

  /* =======================================================
     RESTORE ORIGINAL
     ======================================================= */

  function restoreOriginal(
    img
  ) {
    if (!img) {
      return;
    }

    const state =
      imageStates.get(
        img
      );

    const original =
      state?.sourceURL ||
      img.dataset.cloradOriginalSrc;

    if (!original) {
      return;
    }

    if (
      img.src !== original
    ) {
      img.src =
        original;
    }

    if (state) {
      state.outputURL =
        null;
    }
  }

  /* =======================================================
     PROCESS ALL
     ======================================================= */

  function processAll() {
    processingGeneration++;

    const images =
      getRadarImages();

    for (
      const img of images
    ) {
      processImage(img);
    }
  }

  /* =======================================================
     SET LEVEL
     ======================================================= */

  function setSmoothingLevel(
    value
  ) {
    let level =
      Number(value);

    if (
      !Number.isFinite(level)
    ) {
      level =
        DEFAULT_LEVEL;
    }

    level =
      Math.round(
        clamp(
          level,
          MIN_LEVEL,
          MAX_LEVEL
        )
      );

    if (
      level ===
      smoothingLevel
    ) {
      updateUI();

      return;
    }

    smoothingLevel =
      level;

    /*
       Старые операции больше
       не должны применяться.
    */

    processingGeneration++;

    clearCache();

    updateUI();

    /*
       0% сразу возвращает
       оригинальные GIF-кадры.
    */

    if (
      smoothingLevel === 0
    ) {
      getRadarImages()
        .forEach(
          restoreOriginal
        );

      return;
    }

    processAll();
  }

  /* =======================================================
     UI
     ======================================================= */

  function createUI() {
    if (
      document.getElementById(
        "cloradSmoothingSetting"
      )
    ) {
      return;
    }

    const settings =
      document.getElementById(
        "settings"
      );

    if (!settings) {
      return;
    }

    const block =
      document.createElement(
        "div"
      );

    block.id =
      "cloradSmoothingSetting";

    block.innerHTML = `
      <div style="
        margin-top:12px;
        padding-top:12px;
        border-top:1px solid rgba(255,255,255,.12);
      ">
        <div style="
          font-size:13px;
          font-weight:600;
          margin-bottom:8px;
        ">
          Сглаживание радара
        </div>

        <div style="
          display:flex;
          align-items:center;
          gap:10px;
        ">
          <input
            id="cloradSmoothingRange"
            type="range"
            min="0"
            max="100"
            step="1"
            value="0"
            style="
              flex:1;
              min-width:0;
            "
          >

          <span
            id="cloradSmoothingValue"
            style="
              width:42px;
              text-align:right;
              font-variant-numeric:tabular-nums;
            "
          >0%</span>
        </div>
      </div>
    `;

    /*
       Ставим после настройки кадров,
       если она существует.

       Иначе просто в конец settings.
    */

    const framesSetting =
      document.getElementById(
        "framesSetting"
      );

    const gifResolutionSetting =
      document.getElementById(
        "gifResolutionSetting"
      );

    if (
      framesSetting &&
      framesSetting.parentNode ===
        settings
    ) {
      framesSetting.after(
        block
      );
    } else if (
      gifResolutionSetting &&
      gifResolutionSetting.parentNode ===
        settings
    ) {
      gifResolutionSetting.after(
        block
      );
    } else {
      settings.appendChild(
        block
      );
    }

    const range =
      document.getElementById(
        "cloradSmoothingRange"
      );

    if (range) {
      range.addEventListener(
        "input",
        () => {
          setSmoothingLevel(
            range.value
          );
        }
      );
    }

    updateUI();
  }

  function updateUI() {
    const range =
      document.getElementById(
        "cloradSmoothingRange"
      );

    const value =
      document.getElementById(
        "cloradSmoothingValue"
      );

    if (range) {
      range.value =
        String(
          smoothingLevel
        );
    }

    if (value) {
      value.textContent =
        smoothingLevel +
        "%";
    }
  }

  /* =======================================================
     IMAGE WATCHER
     ======================================================= */

  function watchImages() {
    if (
      imageObserver
    ) {
      imageObserver.disconnect();
    }

    imageObserver =
      new MutationObserver(
        mutations => {
          let changed = false;

          for (
            const mutation of mutations
          ) {
            if (
              mutation.type ===
              "childList"
            ) {
              changed = true;
            }

            if (
              mutation.type ===
              "attributes" &&
              mutation.attributeName ===
              "src"
            ) {
              changed = true;
            }
          }

          if (
            changed
          ) {
            /*
               Не обрабатываем оригинальный
               GIF повторно после того, как
               сами установили PNG.
            */

            if (
              smoothingLevel > 0
            ) {
              processAll();
            }
          }
        }
      );

    imageObserver.observe(
      document.body,
      {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "src",
          "class"
        ]
      }
    );
  }

  /* =======================================================
     SETTINGS WATCHER
     ======================================================= */

  function watchSettings() {
    if (
      settingsObserver
    ) {
      settingsObserver.disconnect();
    }

    const settings =
      document.getElementById(
        "settings"
      );

    if (!settings) {
      return;
    }

    settingsObserver =
      new MutationObserver(
        () => {
          createUI();
          updateUI();
        }
      );

    settingsObserver.observe(
      settings,
      {
        childList: true,
        subtree: true
      }
    );
  }

  /* =======================================================
     BODY WATCHER
     ======================================================= */

  function watchBody() {
    if (
      bodyObserver
    ) {
      bodyObserver.disconnect();
    }

    bodyObserver =
      new MutationObserver(
        () => {
          createUI();
        }
      );

    bodyObserver.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  /* =======================================================
     LEAFLET IMAGE POSITION
     ======================================================= */

  /*
     ВАЖНЫЙ МОМЕНТ.

     Этот файл НЕ делает transform,
     НЕ меняет position,
     НЕ меняет bounds и НЕ двигает
     Leaflet ImageOverlay.

     Географическая привязка должна
     полностью оставаться у:

       L.imageOverlay(
         url,
         GIF_BOUNDS,
         ...
       )

     Поэтому обработанный PNG
     сохраняет абсолютно те же
     размеры и тот же aspect ratio.

     Никакого CSS position:fixed,
     translate или transform здесь нет.
  */

  function enforceLeafletImageStyle() {
    const images =
      getRadarImages();

    for (
      const img of images
    ) {
      img.style.position =
        "";

      img.style.transform =
        "";

      img.style.left =
        "";

      img.style.top =
        "";

      img.style.width =
        "";

      img.style.height =
        "";

      img.style.objectFit =
        "";

      img.style.filter =
        "";

      img.style.imageRendering =
        "auto";
    }
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRadarSmoothing = {
    getLevel:
      getSmoothingLevel,

    setLevel:
      setSmoothingLevel,

    clearCache,

    refresh:
      processAll
  };

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    /*
       Жёстко устанавливаем 0%
       при каждом запуске.
    */

    smoothingLevel =
      DEFAULT_LEVEL;

    createUI();
    updateUI();

    watchImages();
    watchSettings();
    watchBody();

    enforceLeafletImageStyle();

    /*
       Даём gif-radar.js время
       создать первый ImageOverlay.
    */

    setTimeout(
      () => {
        createUI();
        enforceLeafletImageStyle();

        /*
           При 0% здесь намеренно
           ничего не обрабатываем.
        */
      },
      300
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }

})();
