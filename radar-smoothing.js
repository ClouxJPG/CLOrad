/* =========================================================
   CLOrad — RADAR FIELD SMOOTHING
   ---------------------------------------------------------
   • Кнопка внутри «Настройки»
   • После «Кол. кадров»
   • 0% = оригинальный радар
   • 1–100% = сглаживание радарного поля
   • Никаких квадратов
   • Никаких скруглённых квадратов
   • Никаких CSS filter / blur
   • В финальном изображении нет новых цветов
   • Исходные радарные уровни сохраняются
   • Маленькие интенсивные ядра не удаляются
   • Фон не превращается в радар
   • Обрабатывается всё поле как единое значение
   • Обработка только после отпускания ползунка
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     GEOGRAPHIC BOUNDS
     ======================================================= */

  const GIF_BOUNDS = [
    [38.2155955810, 14.9892981264],
    [69.6543707199, 72.9237642948]
  ];

  /* =======================================================
     SETTINGS
     ======================================================= */

  const SETTING_ID =
    "cloradSmoothingSetting";

  const BUTTON_ID =
    "cloradSmoothingButton";

  const PANEL_ID =
    "cloradSmoothingPanel";

  const RANGE_ID =
    "cloradSmoothingRange";

  const VALUE_ID =
    "cloradSmoothingValue";

  /* =======================================================
     RADAR PALETTES
     ======================================================= */

  const SOURCE_OY_COLORS = [
    "#b9c1c7",
    "#a9a9a9",
    "#00ff00",
    "#00cc00",
    "#009900",
    "#00ffff",
    "#4da6ff",
    "#3366ff",
    "#0000cc",
    "#ff66cc",
    "#ff00ff",
    "#cc0099",
    "#ffff00",
    "#ff9900",
    "#ff0000",
    "#cc99ff",
    "#cc33ff",
    "#9900cc",
    "#000000"
  ];

  const DEFAULT_TARGET_COLORS = [
    "#b9c1c7",
    "#a9c7f4",
    "#63eda5",
    "#43cf89",
    "#4db84e",
    "#fff89c",
    "#75a6ef",
    "#5279ed",
    "#504a9b",
    "#ffc0a8",
    "#fa82a0",
    "#ff4d4d",
    "#db9248",
    "#ad7544",
    "#924b48",
    "#f2aaf0",
    "#e85ae7",
    "#ca3cc7",
    "#777c91"
  ];

  /*
     Первые два значения не сглаживаем.
     Реальное радарное поле начинается с 2.
  */

  const RADAR_START = 2;

  /*
     Цветовой допуск.

     Он специально небольшой, чтобы фон
     карты никогда не стал радаром.
  */

  const MAX_COLOR_DISTANCE = 20;

  /* =======================================================
     STATE
     ======================================================= */

  let smoothingValue = 0;

  let smoothingLayer = null;

  let sourceOriginalOpacity = "1";

  let processing = false;

  let processToken = 0;

  let releaseTimer = null;

  let installed = false;

  let observerStarted = false;

  /* =======================================================
     BASIC HELPERS
     ======================================================= */

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(
    value,
    min,
    max
  ) {
    return Math.max(
      min,
      Math.min(
        max,
        value
      )
    );
  }

  function hexToRGB(hex) {
    if (
      typeof hex !== "string"
    ) {
      return null;
    }

    let value =
      hex.trim();

    if (
      value[0] === "#"
    ) {
      value =
        value.slice(1);
    }

    if (
      value.length === 3
    ) {
      value =
        value
          .split("")
          .map(
            x => x + x
          )
          .join("");
    }

    if (
      value.length !== 6
    ) {
      return null;
    }

    const n =
      parseInt(
        value,
        16
      );

    if (
      !Number.isFinite(n)
    ) {
      return null;
    }

    return {
      r:
        (n >> 16) & 255,

      g:
        (n >> 8) & 255,

      b:
        n & 255
    };
  }

  function colorDistance(
    r,
    g,
    b,
    color
  ) {
    const dr =
      r - color.r;

    const dg =
      g - color.g;

    const db =
      b - color.b;

    return Math.sqrt(
      dr * dr +
      dg * dg +
      db * db
    );
  }

  /* =======================================================
     CURRENT PALETTE
     ======================================================= */

  function getCurrentPalette() {
    try {
      if (
        typeof window.CLOradGetCurrentPalette ===
        "function"
      ) {
        const result =
          window.CLOradGetCurrentPalette();

        if (
          result &&
          Array.isArray(
            result.colors
          ) &&
          result.colors.length >= 19
        ) {
          const colors =
            result.colors
              .slice(0, 19)
              .map(
                hexToRGB
              );

          if (
            colors.every(
              Boolean
            )
          ) {
            return colors;
          }
        }
      }
    } catch (
      error
    ) {
      console.warn(
        "CLOrad smoothing palette:",
        error
      );
    }

    return DEFAULT_TARGET_COLORS.map(
      hexToRGB
    );
  }

  /* =======================================================
     SOURCE IMAGE
     ======================================================= */

  function getSourceImage() {
    const images =
      Array.from(
        document.querySelectorAll(
          "img.clorad-gif-radar-image"
        )
      );

    if (
      !images.length
    ) {
      return null;
    }

    for (
      let i =
        images.length - 1;
      i >= 0;
      i--
    ) {
      const image =
        images[i];

      if (
        image &&
        image.dataset &&
        image.dataset.cloradSmoothing !==
          "1"
      ) {
        return image;
      }
    }

    return null;
  }

  function loadImage(url) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        const image =
          new Image();

        image.decoding =
          "async";

        image.onload =
          () =>
            resolve(
              image
            );

        image.onerror =
          () =>
            reject(
              new Error(
                "Не удалось загрузить кадр радара"
              )
            );

        image.src =
          url;
      }
    );
  }

  /* =======================================================
     PALETTE DETECTION
     ======================================================= */

  function detectSourcePalette(
    imageData
  ) {
    const data =
      imageData.data;

    const colors =
      SOURCE_OY_COLORS.map(
        hexToRGB
      );

    let matches = 0;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      if (
        data[i + 3] < 32
      ) {
        continue;
      }

      const r =
        data[i];

      const g =
        data[i + 1];

      const b =
        data[i + 2];

      let best =
        Infinity;

      for (
        let c = 0;
        c < colors.length;
        c++
      ) {
        const d =
          colorDistance(
            r,
            g,
            b,
            colors[c]
          );

        if (
          d < best
        ) {
          best = d;
        }
      }

      if (
        best <=
        MAX_COLOR_DISTANCE
      ) {
        matches++;
      }
    }

    return {
      colors,
      matches
    };
  }

  function choosePalette(
    imageData
  ) {
    const target =
      getCurrentPalette();

    const source =
      detectSourcePalette(
        imageData
      );

    const pixels =
      imageData.data.length /
      4;

    /*
       Если кадр всё ещё в исходной
       ОЯ-палитре — используем её.
    */

    if (
      source.matches >
      pixels * 0.01
    ) {
      return source.colors;
    }

    return target;
  }

  /* =======================================================
     BUILD RADAR FIELD
     -------------------------------------------------------
     Здесь каждый исходный пиксель получает
     целочисленный радарный уровень.

     -1 = фон
      0 = служебный
      1 = служебный
      2..18 = радар
     ======================================================= */

  function buildField(
    imageData,
    width,
    height,
    palette
  ) {
    const data =
      imageData.data;

    const field =
      new Int8Array(
        width * height
      );

    field.fill(-1);

    /*
       Кеш цветов очень сильно
       снижает нагрузку на iPhone.
    */

    const cache =
      new Map();

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
          row + x;

        const p =
          index * 4;

        if (
          data[p + 3] < 32
        ) {
          continue;
        }

        const r =
          data[p];

        const g =
          data[p + 1];

        const b =
          data[p + 2];

        const key =
          (r << 16) |
          (g << 8) |
          b;

        if (
          cache.has(key)
        ) {
          field[index] =
            cache.get(key);

          continue;
        }

        let best =
          -1;

        let bestDistance =
          Infinity;

        /*
           Только настоящие радарные
           классы.
        */

        for (
          let c =
            RADAR_START;
          c < palette.length;
          c++
        ) {
          const color =
            palette[c];

          const d =
            colorDistance(
              r,
              g,
              b,
              color
            );

          if (
            d <
            bestDistance
          ) {
            bestDistance =
              d;

            best = c;
          }
        }

        if (
          best <
          RADAR_START ||
          bestDistance >
            MAX_COLOR_DISTANCE
        ) {
          best = -1;
        }

        cache.set(
          key,
          best
        );

        field[index] =
          best;
      }
    }

    return field;
  }

  /* =======================================================
     RADAR PRESENCE
     ======================================================= */

  function countRadarPixels(
    field
  ) {
    let count = 0;

    for (
      let i = 0;
      i < field.length;
      i++
    ) {
      if (
        field[i] >=
        RADAR_START
      ) {
        count++;
      }
    }

    return count;
  }

  /* =======================================================
     FIELD INTERPOLATION
     -------------------------------------------------------
     НЕ РИСУЕМ КВАДРАТЫ.

     Вместо этого вычисляем непрерывное
     значение радарного поля вокруг
     каждой точки.

     В финальный canvas попадут только
     существующие классы.
     ======================================================= */

  function sampleField(
    field,
    width,
    height,
    x,
    y
  ) {
    const x0 =
      Math.floor(x);

    const y0 =
      Math.floor(y);

    const x1 =
      Math.min(
        width - 1,
        x0 + 1
      );

    const y1 =
      Math.min(
        height - 1,
        y0 + 1
      );

    const fx =
      x - x0;

    const fy =
      y - y0;

    function value(
      px,
      py
    ) {
      if (
        px < 0 ||
        py < 0 ||
        px >= width ||
        py >= height
      ) {
        return -1;
      }

      return field[
        py * width + px
      ];
    }

    const a =
      value(
        x0,
        y0
      );

    const b =
      value(
        x1,
        y0
      );

    const c =
      value(
        x0,
        y1
      );

    const d =
      value(
        x1,
        y1
      );

    /*
       Фон не участвует как числовой
       уровень.

       Если рядом есть радар,
       используем только радарные
       значения.
    */

    let sum = 0;
    let weight = 0;

    const values = [
      [a, (1 - fx) * (1 - fy)],
      [b, fx * (1 - fy)],
      [c, (1 - fx) * fy],
      [d, fx * fy]
    ];

    for (
      const pair of values
    ) {
      const v =
        pair[0];

      const w =
        pair[1];

      if (
        v >=
        RADAR_START
      ) {
        sum +=
          v * w;

        weight +=
          w;
      }
    }

    if (
      weight <= 0
    ) {
      return -1;
    }

    return (
      sum / weight
    );
  }

  /* =======================================================
     SMOOTH FIELD
     -------------------------------------------------------
     Сила определяет размер
     непрерывной интерполяции.

     5% = лёгкое изменение.
     100% = сильное сглаживание.
     ======================================================= */

  function getSmoothRadius(
    strength
  ) {
    const s =
      clamp(
        strength,
        0,
        100
      ) / 100;

    /*
       Радиус специально ограничен.

       Нам не нужно уничтожать
       структуру реального радара.
    */

    return (
      0.20 +
      s * 2.4
    );
  }

  /* =======================================================
     CONTINUOUS FIELD SAMPLE
     ======================================================= */

  function sampleSmoothField(
    field,
    width,
    height,
    x,
    y,
    radius
  ) {
    /*
       При маленьком сглаживании
       достаточно bilinear sample.
    */

    if (
      radius <= 0.5
    ) {
      return sampleField(
        field,
        width,
        height,
        x,
        y
      );
    }

    /*
       Усредняем значения
       по небольшому кругу.

       Это используется только для
       определения ГРАНИЦЫ.

       В canvas никогда не рисуется
       получившийся промежуточный цвет.
    */

    const r =
      Math.min(
        3,
        Math.ceil(radius)
      );

    let sum = 0;
    let weight = 0;

    for (
      let dy = -r;
      dy <= r;
      dy++
    ) {
      for (
        let dx = -r;
        dx <= r;
        dx++
      ) {
        const distance =
          Math.sqrt(
            dx * dx +
            dy * dy
          );

        if (
          distance >
          radius
        ) {
          continue;
        }

        const sx =
          x + dx;

        const sy =
          y + dy;

        if (
          sx < 0 ||
          sy < 0 ||
          sx >= width ||
          sy >= height
        ) {
          continue;
        }

        const value =
          field[
            Math.floor(sy) *
              width +
            Math.floor(sx)
          ];

        if (
          value <
          RADAR_START
        ) {
          continue;
        }

        /*
           Чем ближе исходный пиксель,
           тем больше его влияние.
        */

        const w =
          1 /
          (
            1 +
            distance
          );

        sum +=
          value * w;

        weight +=
          w;
      }
    }

    if (
      weight <= 0
    ) {
      return -1;
    }

    return (
      sum / weight
    );
  }

  /* =======================================================
     CLASS PRESERVATION
     -------------------------------------------------------
     Не позволяем сглаживанию
     уничтожить редкий класс.

     Если исходный класс присутствует
     в кадре, его центры сохраняются.
     ======================================================= */

  function collectClassSeeds(
    field,
    width,
    height
  ) {
    const seeds =
      new Map();

    for (
      let i = 0;
      i < field.length;
      i++
    ) {
      const level =
        field[i];

      if (
        level <
        RADAR_START
      ) {
        continue;
      }

      let list =
        seeds.get(level);

      if (
        !list
      ) {
        list = [];
        seeds.set(
          level,
          list
        );
      }

      /*
         Не требуется хранить
         каждый пиксель как объект.
      */

      if (
        list.length < 600
      ) {
        const x =
          i % width;

        const y =
          Math.floor(
            i / width
          );

        list.push([
          x,
          y
        ]);
      }
    }

    return seeds;
  }

  /* =======================================================
     RENDER
     -------------------------------------------------------
     Суперсэмплинг:

     сначала создаём более плотное
     непрерывное поле, затем каждый
     результат получает только один
     существующий радарный цвет.

     Поэтому на выходе нет новых RGB.
     ======================================================= */

  function renderSmoothRadar(
    field,
    width,
    height,
    palette,
    strength,
    token
  ) {
    /*
       Увеличение разрешения позволяет
       получить плавную границу без
       квадратных ячеек.
    */

    const scale =
      strength < 20
        ? 2
        : strength < 60
          ? 2
          : 3;

    const outWidth =
      width * scale;

    const outHeight =
      height * scale;

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

    if (
      !ctx
    ) {
      return null;
    }

    ctx.clearRect(
      0,
      0,
      outWidth,
      outHeight
    );

    const radius =
      getSmoothRadius(
        strength
      );

    /*
       Рисуем только существующие
       радарные классы.

       Фон остаётся прозрачным.
    */

    const image =
      ctx.createImageData(
        outWidth,
        outHeight
      );

    const output =
      image.data;

    /*
       Для каждого суперпикселя
       вычисляется непрерывное значение
       поля.

       После этого оно квантуется
       обратно к существующему уровню.
    */

    for (
      let oy = 0;
      oy < outHeight;
      oy++
    ) {
      if (
        token !==
        processToken
      ) {
        return null;
      }

      const sourceY =
        oy / scale;

      for (
        let ox = 0;
        ox < outWidth;
        ox++
      ) {
        const sourceX =
          ox / scale;

        const value =
          sampleSmoothField(
            field,
            width,
            height,
            sourceX,
            sourceY,
            radius
          );

        if (
          value <
          RADAR_START
        ) {
          continue;
        }

        /*
           Округление обратно
           к существующему классу.

           Никакого нового цвета.
        */

        let level =
          Math.round(
            value
          );

        level =
          clamp(
            level,
            RADAR_START,
            palette.length - 1
          );

        const color =
          palette[level];

        if (
          !color
        ) {
          continue;
        }

        const p =
          (
            oy *
              outWidth +
            ox
          ) * 4;

        output[p] =
          color.r;

        output[p + 1] =
          color.g;

        output[p + 2] =
          color.b;

        output[p + 3] =
          255;
      }
    }

    /*
       Возвращаем исходные редкие
       интенсивные классы.

       Они не могут исчезнуть
       из-за интерполяции.
    */

    const seeds =
      collectClassSeeds(
        field,
        width,
        height
      );

    for (
      const [level, points]
      of seeds
    ) {
      if (
        token !==
        processToken
      ) {
        return null;
      }

      const color =
        palette[level];

      if (
        !color
      ) {
        continue;
      }

      for (
        const point of points
      ) {
        const x =
          Math.round(
            point[0] *
            scale
          );

        const y =
          Math.round(
            point[1] *
            scale
          );

        /*
           Не рисуем квадрат.

           Сохраняем наличие исходного
           класса через маленькую
           радиальную область.
        */

        const seedRadius =
          Math.max(
            1,
            Math.min(
              3,
              Math.ceil(
                strength /
                35
              )
            )
          );

        for (
          let dy =
            -seedRadius;
          dy <=
            seedRadius;
          dy++
        ) {
          for (
            let dx =
              -seedRadius;
            dx <=
              seedRadius;
            dx++
          ) {
            const distance =
              Math.sqrt(
                dx * dx +
                dy * dy
              );

            if (
              distance >
              seedRadius
            ) {
              continue;
            }

            const px =
              x + dx;

            const py =
              y + dy;

            if (
              px < 0 ||
              py < 0 ||
              px >= outWidth ||
              py >= outHeight
            ) {
              continue;
            }

            const p =
              (
                py *
                  outWidth +
                px
              ) * 4;

            /*
               Только если здесь уже
               есть радарное значение
               или это сам центр исходного
               пикселя.
            */

            if (
              dx === 0 &&
              dy === 0
            ) {
              output[p] =
                color.r;

              output[p + 1] =
                color.g;

              output[p + 2] =
                color.b;

              output[p + 3] =
                255;
            }
          }
        }
      }
    }

    /*
       Масштабированное изображение
       возвращаем обратно в исходный
       размер.

       Canvas imageSmoothingEnabled
       здесь используется только для
       геометрического ресэмплинга.

       Цвета после него снова
       квантуются палитрой.
    */

    const finalCanvas =
      document.createElement(
        "canvas"
      );

    finalCanvas.width =
      width;

    finalCanvas.height =
      height;

    const finalCtx =
      finalCanvas.getContext(
        "2d"
      );

    if (
      !finalCtx
    ) {
      return null;
    }

    finalCtx.clearRect(
      0,
      0,
      width,
      height
    );

    /*
       Это не CSS blur и не размытие
       радарных значений.

       Здесь только геометрическое
       уменьшение сверхплотного
       непрерывного изображения.
    */

    finalCtx.imageSmoothingEnabled =
      true;

    finalCtx.imageSmoothingQuality =
      "high";

    finalCtx.drawImage(
      canvas,
      0,
      0,
      width,
      height
    );

    /*
       После ресэмплинга снова
       жёстко возвращаем только
       существующие цвета палитры.

       Это гарантирует отсутствие
       новых RGB-цветов.
    */

    const finalData =
      finalCtx.getImageData(
        0,
        0,
        width,
        height
      );

    const pixels =
      finalData.data;

    const colorCache =
      new Map();

    for (
      let i = 0;
      i < pixels.length;
      i += 4
    ) {
      if (
        pixels[i + 3] <
        20
      ) {
        pixels[i + 3] =
          0;

        continue;
      }

      const r =
        pixels[i];

      const g =
        pixels[i + 1];

      const b =
        pixels[i + 2];

      const key =
        (
          r << 16
        ) |
        (
          g << 8
        ) |
        b;

      let level =
        colorCache.get(
          key
        );

      if (
        level ===
        undefined
      ) {
        let best =
          RADAR_START;

        let bestDistance =
          Infinity;

        for (
          let c =
            RADAR_START;
          c < palette.length;
          c++
        ) {
          const d =
            colorDistance(
              r,
              g,
              b,
              palette[c]
            );

          if (
            d <
            bestDistance
          ) {
            bestDistance =
              d;

            best = c;
          }
        }

        level =
          best;

        colorCache.set(
          key,
          level
        );
      }

      const color =
        palette[level];

      if (
        !color
      ) {
        pixels[i + 3] =
          0;

        continue;
      }

      pixels[i] =
        color.r;

      pixels[i + 1] =
        color.g;

      pixels[i + 2] =
        color.b;

      pixels[i + 3] =
        255;
    }

    finalCtx.putImageData(
      finalData,
      0,
      0
    );

    return finalCanvas;
  }

  /* =======================================================
     REMOVE SMOOTHED LAYER
     ======================================================= */

  function removeSmoothedLayer() {
    if (
      smoothingLayer &&
      window.map &&
      window.map.hasLayer(
        smoothingLayer
      )
    ) {
      window.map.removeLayer(
        smoothingLayer
      );
    }

    smoothingLayer =
      null;
  }

  /* =======================================================
     RESTORE ORIGINAL
     ======================================================= */

  function restoreOriginal() {
    processToken++;

    removeSmoothedLayer();

    const source =
      getSourceImage();

    if (
      source
    ) {
      source.style.opacity =
        sourceOriginalOpacity ||
        "1";
    }

    processing =
      false;
  }

  /* =======================================================
     INSTALL RESULT
     ======================================================= */

  function installSmoothedLayer(
    dataURL
  ) {
    if (
      !window.map
    ) {
      return;
    }

    removeSmoothedLayer();

    const layer =
      L.imageOverlay(
        dataURL,
        GIF_BOUNDS,
        {
          opacity: 1,
          interactive: false,
          zIndex: 7,
          className:
            "clorad-gif-radar-smoothed"
        }
      );

    layer.addTo(
      window.map
    );

    smoothingLayer =
      layer;

    const source =
      getSourceImage();

    if (
      source
    ) {
      sourceOriginalOpacity =
        source.style.opacity ||
        "1";

      source.style.opacity =
        "0";
    }

    if (
      typeof layer.bringToFront ===
      "function"
    ) {
      layer.bringToFront();
    }
  }

  /* =======================================================
     PROCESS FRAME
     ======================================================= */

  async function processCurrentFrame(
    strength
  ) {
    const token =
      ++processToken;

    if (
      strength <= 0
    ) {
      restoreOriginal();

      return;
    }

    const source =
      getSourceImage();

    if (
      !source
    ) {
      return;
    }

    if (
      !source.complete ||
      !source.naturalWidth ||
      !source.naturalHeight
    ) {
      setTimeout(
        () =>
          processCurrentFrame(
            strength
          ),
        120
      );

      return;
    }

    if (
      processing
    ) {
      return;
    }

    processing =
      true;

    try {
      const url =
        source.currentSrc ||
        source.src;

      if (
        !url
      ) {
        return;
      }

      const image =
        await loadImage(
          url
        );

      if (
        token !==
        processToken
      ) {
        return;
      }

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
        return;
      }

      const canvas =
        document.createElement(
          "canvas"
        );

      canvas.width =
        width;

      canvas.height =
        height;

      const ctx =
        canvas.getContext(
          "2d",
          {
            willReadFrequently:
              true
          }
        );

      if (
        !ctx
      ) {
        throw new Error(
          "Canvas недоступен"
        );
      }

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      ctx.drawImage(
        image,
        0,
        0,
        width,
        height
      );

      const imageData =
        ctx.getImageData(
          0,
          0,
          width,
          height
        );

      if (
        token !==
        processToken
      ) {
        return;
      }

      const palette =
        choosePalette(
          imageData
        );

      if (
        !palette ||
        palette.length <
          19
      ) {
        return;
      }

      const field =
        buildField(
          imageData,
          width,
          height,
          palette
        );

      if (
        token !==
        processToken
      ) {
        return;
      }

      const radarPixels =
        countRadarPixels(
          field
        );

      /*
         Защита от пустого изображения.
      */

      if (
        radarPixels <
        1
      ) {
        return;
      }

      const resultCanvas =
        renderSmoothRadar(
          field,
          width,
          height,
          palette,
          strength,
          token
        );

      if (
        !resultCanvas ||
        token !==
          processToken
      ) {
        return;
      }

      const dataURL =
        resultCanvas.toDataURL(
          "image/png"
        );

      if (
        !dataURL ||
        dataURL ===
          "data:,"
      ) {
        return;
      }

      installSmoothedLayer(
        dataURL
      );

    } catch (
      error
    ) {
      console.error(
        "CLOrad radar smoothing:",
        error
      );
    } finally {
      if (
        token ===
        processToken
      ) {
        processing =
          false;
      }
    }
  }

  /* =======================================================
     SETTINGS UI
     ======================================================= */

  function installSetting() {
    if (
      installed
    ) {
      return;
    }

    const settings =
      document.getElementById(
        "settings"
      );

    if (
      !settings
    ) {
      return;
    }

    if (
      document.getElementById(
        SETTING_ID
      )
    ) {
      installed =
        true;

      return;
    }

    const setting =
      document.createElement(
        "div"
      );

    setting.className =
      "setting";

    setting.id =
      SETTING_ID;

    setting.innerHTML = `
      <button
        class="settingHead"
        id="${BUTTON_ID}"
        type="button"
      >
        <span>Сглаживание радара</span>
        <span class="settingArrow">›</span>
      </button>

      <div
        class="settingBody"
        id="${PANEL_ID}"
      >
        <div
          style="
            font-size:12px;
            color:#9da7ad;
            margin-bottom:10px;
          "
        >
          Сглаживание контуров
        </div>

        <input
          id="${RANGE_ID}"
          type="range"
          min="0"
          max="100"
          step="1"
          value="0"
          style="
            width:100%;
            accent-color:#53e39b;
          "
        >

        <div
          id="${VALUE_ID}"
          style="
            margin-top:7px;
            font-size:13px;
            color:#dfe4e7;
            text-align:right;
          "
        >
          0%
        </div>
      </div>
    `;

    /*
       Сохраняем расположение:
       сразу после «Кол. кадров».
    */

    const framesSetting =
      document.getElementById(
        "framesSetting"
      );

    if (
      framesSetting
    ) {
      framesSetting.after(
        setting
      );
    } else {
      settings.appendChild(
        setting
      );
    }

    const button =
      document.getElementById(
        BUTTON_ID
      );

    const range =
      document.getElementById(
        RANGE_ID
      );

    const value =
      document.getElementById(
        VALUE_ID
      );

    /* =====================================================
       OPEN
       ===================================================== */

    button?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        setting.classList.toggle(
          "open"
        );
      }
    );

    /* =====================================================
       SLIDER
       ===================================================== */

    range?.addEventListener(
      "input",
      () => {
        smoothingValue =
          clamp(
            Number(
              range.value
            ),
            0,
            100
          );

        if (
          value
        ) {
          value.textContent =
            smoothingValue +
            "%";
        }

        /*
           Во время движения
           ничего тяжёлого не считаем.
        */

        if (
          smoothingLayer
        ) {
          removeSmoothedLayer();

          const source =
            getSourceImage();

          if (
            source
          ) {
            source.style.opacity =
              sourceOriginalOpacity ||
              "1";
          }
        }

        if (
          smoothingValue ===
          0
        ) {
          restoreOriginal();
        }
      }
    );

    /* =====================================================
       RELEASE
       ===================================================== */

    const release =
      () => {
        clearTimeout(
          releaseTimer
        );

        releaseTimer =
          setTimeout(
            () => {
              processCurrentFrame(
                smoothingValue
              );
            },
            220
          );
      };

    range?.addEventListener(
      "pointerup",
      release
    );

    range?.addEventListener(
      "touchend",
      release
    );

    range?.addEventListener(
      "mouseup",
      release
    );

    installed =
      true;
  }

  /* =======================================================
     WATCH GIF FRAME
     ======================================================= */

  function watchGIFFrame() {
    if (
      observerStarted
    ) {
      return;
    }

    observerStarted =
      true;

    const observer =
      new MutationObserver(
        mutations => {
          for (
            const mutation of mutations
          ) {
            if (
              mutation.type !==
              "attributes"
            ) {
              continue;
            }

            if (
              mutation.attributeName !==
              "src"
            ) {
              continue;
            }

            const target =
              mutation.target;

            if (
              !target.matches?.(
                "img.clorad-gif-radar-image"
              )
            ) {
              continue;
            }

            processToken++;

            removeSmoothedLayer();

            processing =
              false;

            target.style.opacity =
              "1";

            sourceOriginalOpacity =
              "1";

            /*
               Сглаживание автоматически
               переносится на новый кадр.
            */

            if (
              smoothingValue > 0
            ) {
              clearTimeout(
                releaseTimer
              );

              releaseTimer =
                setTimeout(
                  () => {
                    processCurrentFrame(
                      smoothingValue
                    );
                  },
                  120
                );
            }
          }
        }
      );

    observer.observe(
      document.body,
      {
        subtree: true,
        attributes: true,
        attributeFilter: [
          "src"
        ]
      }
    );
  }

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    installSetting();

    if (
      !installed
    ) {
      setTimeout(
        init,
        250
      );

      return;
    }

    watchGIFFrame();
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

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRadarSmoothing = {
    getValue() {
      return smoothingValue;
    },

    setValue(value) {
      smoothingValue =
        clamp(
          Number(value) || 0,
          0,
          100
        );

      const range =
        document.getElementById(
          RANGE_ID
        );

      const valueElement =
        document.getElementById(
          VALUE_ID
        );

      if (
        range
      ) {
        range.value =
          String(
            smoothingValue
          );
      }

      if (
        valueElement
      ) {
        valueElement.textContent =
          smoothingValue +
          "%";
      }

      if (
        smoothingValue ===
        0
      ) {
        restoreOriginal();
      } else {
        processCurrentFrame(
          smoothingValue
        );
      }
    },

    restore() {
      smoothingValue =
        0;

      const range =
        document.getElementById(
          RANGE_ID
        );

      const value =
        document.getElementById(
          VALUE_ID
        );

      if (
        range
      ) {
        range.value =
          "0";
      }

      if (
        value
      ) {
        value.textContent =
          "0%";
      }

      restoreOriginal();
    }
  };
})();
