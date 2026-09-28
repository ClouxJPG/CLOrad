/* =========================================================
   CLOrad — RADAR CONTOUR SMOOTHING
   ---------------------------------------------------------
   • Кнопка находится внутри «Настройки»
   • После «Кол. кадров»
   • 0% = оригинальный радар
   • 1–100% = сглаживание геометрии контуров
   • Никаких квадратов
   • Никаких скруглённых квадратов
   • Никакого CSS blur
   • Никакого размытия цветов
   • Никаких новых цветов
   • Исходные радарные пиксели не фильтруются
   • Фон GIF никогда не становится радаром
   • Сглаживаются границы между уровнями
   • Разные уровни остаются вложенными
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
     SETTINGS IDS
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
     RADAR PALETTE
     ======================================================= */

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

  /*
     0 и 1 — серые служебные/фоновые значения.

     Сглаживание начинается только с класса 2.
  */

  const RADAR_CLASS_START = 2;

  /*
     Небольшой допуск нужен для PNG/GIF,
     но он намеренно не большой.
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

  let frameObserverStarted = false;

  /* =======================================================
     HELPERS
     ======================================================= */

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  function hexToRGB(hex) {
    if (
      typeof hex !== "string"
    ) {
      return null;
    }

    let value = hex.trim();

    if (
      value[0] === "#"
    ) {
      value = value.slice(1);
    }

    if (
      value.length === 3
    ) {
      value = value
        .split("")
        .map(x => x + x)
        .join("");
    }

    if (
      value.length !== 6
    ) {
      return null;
    }

    const n = parseInt(
      value,
      16
    );

    if (
      !Number.isFinite(n)
    ) {
      return null;
    }

    return {
      r: (n >> 16) & 255,
      g: (n >> 8) & 255,
      b: n & 255
    };
  }

  function rgbDistance(
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
          Array.isArray(result.colors) &&
          result.colors.length >= 19
        ) {
          const colors =
            result.colors
              .slice(0, 19)
              .map(hexToRGB);

          if (
            colors.every(Boolean)
          ) {
            return colors;
          }
        }
      }
    } catch (error) {
      console.warn(
        "CLOrad smoothing palette:",
        error
      );
    }

    return DEFAULT_TARGET_COLORS.map(
      hexToRGB
    );
  }

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
      let i = images.length - 1;
      i >= 0;
      i--
    ) {
      const image = images[i];

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
      (resolve, reject) => {
        const image =
          new Image();

        image.decoding =
          "async";

        image.onload =
          () => resolve(image);

        image.onerror =
          () =>
            reject(
              new Error(
                "Не удалось загрузить кадр радара"
              )
            );

        image.src = url;
      }
    );
  }

  /* =======================================================
     SOURCE PALETTE DETECTION
     ======================================================= */

  function detectSourcePalette(
    imageData
  ) {
    const data =
      imageData.data;

    const sourceColors =
      SOURCE_OY_COLORS.map(
        hexToRGB
      );

    const counters =
      new Array(
        sourceColors.length
      ).fill(0);

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

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      let best = -1;
      let bestDistance =
        Infinity;

      for (
        let c = 0;
        c < sourceColors.length;
        c++
      ) {
        const distance =
          rgbDistance(
            r,
            g,
            b,
            sourceColors[c]
          );

        if (
          distance <
          bestDistance
        ) {
          bestDistance =
            distance;

          best = c;
        }
      }

      if (
        best >= 0 &&
        bestDistance <=
          MAX_COLOR_DISTANCE
      ) {
        counters[best]++;
      }
    }

    let matches = 0;

    for (
      let i = 0;
      i < counters.length;
      i++
    ) {
      matches += counters[i];
    }

    return {
      colors: sourceColors,
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
      imageData.data.length / 4;

    /*
       Если кадр реально содержит
       исходные цвета Meteoinfo —
       классифицируем по ним.

       Иначе используем текущую
       палитру CLOrad.
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
     LABEL MAP
     -------------------------------------------------------
     -1 = прозрачный/фон
      0 = служебный
      1 = служебный
      2..18 = реальные радарные уровни
     ======================================================= */

  function buildLabelMap(
    imageData,
    width,
    height,
    palette
  ) {
    const data =
      imageData.data;

    const labels =
      new Int8Array(
        width * height
      );

    labels.fill(-1);

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

        const alpha =
          data[p + 3];

        if (
          alpha < 32
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
          labels[index] =
            cache.get(key);

          continue;
        }

        let best =
          -1;

        let bestDistance =
          Infinity;

        /*
           КРИТИЧЕСКИ ВАЖНО:

           Никогда не классифицируем
           цвета 0 и 1.

           Поэтому серый фон не может
           превратиться в зелёный/радарный
           прямоугольник.
        */

        for (
          let i =
            RADAR_CLASS_START;
          i < palette.length;
          i++
        ) {
          const color =
            palette[i];

          if (
            !color
          ) {
            continue;
          }

          const distance =
            rgbDistance(
              r,
              g,
              b,
              color
            );

          if (
            distance <
            bestDistance
          ) {
            bestDistance =
              distance;

            best = i;
          }
        }

        if (
          best <
          RADAR_CLASS_START ||
          bestDistance >
            MAX_COLOR_DISTANCE
        ) {
          best = -1;
        }

        cache.set(
          key,
          best
        );

        labels[index] =
          best;
      }
    }

    return labels;
  }

  /* =======================================================
     CUMULATIVE MASK
     -------------------------------------------------------
     ЭТО ГЛАВНОЕ ИЗМЕНЕНИЕ.

     Раньше каждый цвет сглаживался
     отдельно.

     Теперь строится вложенное поле:

       level >= 2
       level >= 3
       level >= 4
       ...
       level >= 18

     Поэтому границы цветов физически
     остаются вложенными друг в друга.
     ======================================================= */

  function buildLevelMask(
    labels,
    width,
    height,
    level
  ) {
    const total =
      width * height;

    const mask =
      new Uint8Array(
        total
      );

    for (
      let i = 0;
      i < total;
      i++
    ) {
      if (
        labels[i] >= level
      ) {
        mask[i] = 1;
      }
    }

    return mask;
  }

  /* =======================================================
     MARCHING SQUARES
     ======================================================= */

  function buildSegments(
    mask,
    width,
    height
  ) {
    const segments = [];

    function inside(x, y) {
      if (
        x < 0 ||
        y < 0 ||
        x >= width ||
        y >= height
      ) {
        return false;
      }

      return mask[
        y * width + x
      ] !== 0;
    }

    function add(
      ax,
      ay,
      bx,
      by
    ) {
      segments.push([
        ax,
        ay,
        bx,
        by
      ]);
    }

    for (
      let y = 0;
      y < height - 1;
      y++
    ) {
      for (
        let x = 0;
        x < width - 1;
        x++
      ) {
        const tl =
          inside(x, y)
            ? 1
            : 0;

        const tr =
          inside(x + 1, y)
            ? 1
            : 0;

        const br =
          inside(
            x + 1,
            y + 1
          )
            ? 1
            : 0;

        const bl =
          inside(
            x,
            y + 1
          )
            ? 1
            : 0;

        const code =
          tl |
          (tr << 1) |
          (br << 2) |
          (bl << 3);

        if (
          code === 0 ||
          code === 15
        ) {
          continue;
        }

        const top = [
          2 * x + 1,
          2 * y
        ];

        const right = [
          2 * x + 2,
          2 * y + 1
        ];

        const bottom = [
          2 * x + 1,
          2 * y + 2
        ];

        const left = [
          2 * x,
          2 * y + 1
        ];

        switch (code) {
          case 1:
            add(
              left[0],
              left[1],
              top[0],
              top[1]
            );
            break;

          case 2:
            add(
              top[0],
              top[1],
              right[0],
              right[1]
            );
            break;

          case 3:
            add(
              left[0],
              left[1],
              right[0],
              right[1]
            );
            break;

          case 4:
            add(
              right[0],
              right[1],
              bottom[0],
              bottom[1]
            );
            break;

          case 5:
            /*
               Асимметричный случай.
               Используем две независимые
               границы, не соединяем их.
            */

            add(
              left[0],
              left[1],
              top[0],
              top[1]
            );

            add(
              right[0],
              right[1],
              bottom[0],
              bottom[1]
            );
            break;

          case 6:
            add(
              top[0],
              top[1],
              bottom[0],
              bottom[1]
            );
            break;

          case 7:
            add(
              left[0],
              left[1],
              bottom[0],
              bottom[1]
            );
            break;

          case 8:
            add(
              bottom[0],
              bottom[1],
              left[0],
              left[1]
            );
            break;

          case 9:
            add(
              top[0],
              top[1],
              bottom[0],
              bottom[1]
            );
            break;

          case 10:
            add(
              top[0],
              top[1],
              left[0],
              left[1]
            );

            add(
              right[0],
              right[1],
              bottom[0],
              bottom[1]
            );
            break;

          case 11:
            add(
              right[0],
              right[1],
              bottom[0],
              bottom[1]
            );
            break;

          case 12:
            add(
              right[0],
              right[1],
              left[0],
              left[1]
            );
            break;

          case 13:
            add(
              top[0],
              top[1],
              right[0],
              right[1]
            );
            break;

          case 14:
            add(
              top[0],
              top[1],
              left[0],
              left[1]
            );
            break;
        }
      }
    }

    return segments;
  }

  /* =======================================================
     SEGMENT CHAINING
     ======================================================= */

  function pointKey(x, y) {
    return (
      x +
      ":" +
      y
    );
  }

  function chainSegments(
    segments
  ) {
    const result = [];

    if (
      !segments.length
    ) {
      return result;
    }

    const connections =
      new Map();

    function connect(
      key,
      index
    ) {
      let list =
        connections.get(key);

      if (
        !list
      ) {
        list = [];
        connections.set(
          key,
          list
        );
      }

      list.push(index);
    }

    for (
      let i = 0;
      i < segments.length;
      i++
    ) {
      const s =
        segments[i];

      connect(
        pointKey(
          s[0],
          s[1]
        ),
        i
      );

      connect(
        pointKey(
          s[2],
          s[3]
        ),
        i
      );
    }

    const used =
      new Uint8Array(
        segments.length
      );

    for (
      let start = 0;
      start < segments.length;
      start++
    ) {
      if (
        used[start]
      ) {
        continue;
      }

      const first =
        segments[start];

      const startX =
        first[0];

      const startY =
        first[1];

      let currentX =
        first[2];

      let currentY =
        first[3];

      used[start] =
        1;

      const points = [
        [
          first[0] / 2,
          first[1] / 2
        ],
        [
          currentX / 2,
          currentY / 2
        ]
      ];

      let guard = 0;

      while (
        guard++ <
        segments.length + 20
      ) {
        if (
          currentX === startX &&
          currentY === startY
        ) {
          break;
        }

        const list =
          connections.get(
            pointKey(
              currentX,
              currentY
            )
          );

        if (
          !list
        ) {
          break;
        }

        let next =
          -1;

        for (
          let i = 0;
          i < list.length;
          i++
        ) {
          if (
            !used[list[i]]
          ) {
            next =
              list[i];

            break;
          }
        }

        if (
          next < 0
        ) {
          break;
        }

        used[next] =
          1;

        const s =
          segments[next];

        if (
          s[0] === currentX &&
          s[1] === currentY
        ) {
          currentX =
            s[2];

          currentY =
            s[3];
        } else {
          currentX =
            s[0];

          currentY =
            s[1];
        }

        points.push([
          currentX / 2,
          currentY / 2
        ]);
      }

      if (
        points.length >= 4 &&
        currentX === startX &&
        currentY === startY
      ) {
        points.pop();

        result.push(
          points
        );
      }
    }

    return result;
  }

  /* =======================================================
     CONTOUR CLEANUP
     -------------------------------------------------------
     Только удаляем абсолютно одинаковые
     соседние точки.

     НИКАКИХ удалений пикселей,
     morphology, erosion, dilation.
     ======================================================= */

  function cleanContour(
    points
  ) {
    if (
      points.length < 4
    ) {
      return points;
    }

    const result = [];

    for (
      let i = 0;
      i < points.length;
      i++
    ) {
      const current =
        points[i];

      const previous =
        points[
          (i - 1 + points.length) %
            points.length
        ];

      if (
        current[0] ===
          previous[0] &&
        current[1] ===
          previous[1]
      ) {
        continue;
      }

      result.push(
        current
      );
    }

    return result;
  }

  /* =======================================================
     SMOOTH CLOSED CONTOUR
     -------------------------------------------------------
     Здесь нет квадратов.

     Контур сначала слегка пересэмплируется,
     затем проходит через Catmull-Rom/
     cubic Bezier интерполяцию при рисовании.
     ======================================================= */

  function chaikinOnce(
    points,
    amount
  ) {
    if (
      points.length < 4
    ) {
      return points;
    }

    const result = [];

    for (
      let i = 0;
      i < points.length;
      i++
    ) {
      const a =
        points[i];

      const b =
        points[
          (i + 1) %
            points.length
        ];

      result.push([
        a[0] +
          (b[0] - a[0]) *
            amount,

        a[1] +
          (b[1] - a[1]) *
            amount
      ]);

      result.push([
        b[0] -
          (b[0] - a[0]) *
            amount,

        b[1] -
          (b[1] - a[1]) *
            amount
      ]);
    }

    return result;
  }

  function smoothContour(
    points,
    strength
  ) {
    let result =
      cleanContour(
        points
      );

    if (
      result.length < 4
    ) {
      return result;
    }

    const s =
      clamp(
        strength,
        0,
        100
      ) / 100;

    /*
       При 1–5% изменение небольшое.

       При 100% контур становится
       значительно более плавным,
       но исходная топология остаётся.
    */

    const amount =
      0.015 +
      s * 0.085;

    let iterations = 0;

    if (
      strength >= 1
    ) {
      iterations = 1;
    }

    if (
      strength >= 25
    ) {
      iterations = 2;
    }

    if (
      strength >= 55
    ) {
      iterations = 3;
    }

    if (
      strength >= 80
    ) {
      iterations = 4;
    }

    for (
      let i = 0;
      i < iterations;
      i++
    ) {
      result =
        chaikinOnce(
          result,
          amount
        );
    }

    return result;
  }

  /* =======================================================
     DRAW SMOOTH CLOSED CONTOUR
     -------------------------------------------------------
     Используем кубические кривые.

     Поэтому между точками НЕТ прямоугольных
     ступенек и НЕТ квадратных ячеек.
     ======================================================= */

  function drawSmoothContour(
    ctx,
    contour
  ) {
    if (
      contour.length < 3
    ) {
      return;
    }

    const count =
      contour.length;

    ctx.moveTo(
      contour[0][0],
      contour[0][1]
    );

    /*
       Каждая точка становится
       управляющей точкой плавной кривой.
    */

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const p0 =
        contour[
          (i - 1 + count) %
            count
        ];

      const p1 =
        contour[i];

      const p2 =
        contour[
          (i + 1) %
            count
        ];

      const p3 =
        contour[
          (i + 2) %
            count
        ];

      const c1x =
        p1[0] +
        (p2[0] - p0[0]) /
          6;

      const c1y =
        p1[1] +
        (p2[1] - p0[1]) /
          6;

      const c2x =
        p2[0] -
        (p3[0] - p1[0]) /
          6;

      const c2y =
        p2[1] -
        (p3[1] - p1[1]) /
          6;

      ctx.bezierCurveTo(
        c1x,
        c1y,
        c2x,
        c2y,
        p2[0],
        p2[1]
      );
    }

    ctx.closePath();
  }

  /* =======================================================
     DRAW LEVEL
     ======================================================= */

  function drawLevel(
    ctx,
    contours,
    color
  ) {
    if (
      !contours.length ||
      !color
    ) {
      return;
    }

    ctx.save();

    ctx.beginPath();

    for (
      const contour of contours
    ) {
      if (
        contour.length < 3
      ) {
        continue;
      }

      drawSmoothContour(
        ctx,
        contour
      );
    }

    ctx.fillStyle =
      `rgb(${color.r},${color.g},${color.b})`;

    ctx.globalAlpha = 1;

    /*
       Even-odd позволяет корректно
       сохранять внутренние отверстия.
    */

    ctx.fill(
      "evenodd"
    );

    ctx.restore();
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
     INSTALL SMOOTHED IMAGE
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
     PROCESS CURRENT FRAME
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

      /*
         Сначала читаем оригинальный
         кадр полностью.
      */

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

      let imageData;

      try {
        imageData =
          ctx.getImageData(
            0,
            0,
            width,
            height
          );
      } catch (error) {
        console.error(
          "CLOrad smoothing canvas:",
          error
        );

        throw new Error(
          "Canvas заблокирован"
        );
      }

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

      /*
         Классифицируем КАЖДЫЙ исходный
         радарный пиксель.

         Никакого cleanup.
         Никакого удаления одиночных
         пикселей.
      */

      const labels =
        buildLabelMap(
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

      let radarPixels = 0;

      for (
        let i = 0;
        i < labels.length;
        i++
      ) {
        if (
          labels[i] >=
          RADAR_CLASS_START
        ) {
          radarPixels++;
        }
      }

      /*
         Если радара действительно нет,
         ничего не рисуем.
      */

      if (
        radarPixels < 1
      ) {
        return;
      }

      /*
         Теперь полностью очищаем
         canvas.

         Фон останется ПРОЗРАЧНЫМ.
      */

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      /* ===================================================
         ВЛОЖЕННЫЕ УРОВНИ
         ===================================================

         Для каждого уровня:

           level 2 = все >= 2
           level 3 = все >= 3
           level 4 = все >= 4
           ...

         Поэтому следующий цвет
         всегда лежит внутри предыдущего.

         Это принципиально отличается
         от старого алгоритма.
         =================================================== */

      for (
        let level =
          RADAR_CLASS_START;
        level <
          palette.length;
        level++
      ) {
        if (
          token !==
          processToken
        ) {
          return;
        }

        const mask =
          buildLevelMask(
            labels,
            width,
            height,
            level
          );

        const segments =
          buildSegments(
            mask,
            width,
            height
          );

        if (
          !segments.length
        ) {
          continue;
        }

        const contours =
          chainSegments(
            segments
          );

        if (
          !contours.length
        ) {
          continue;
        }

        const smoothed = [];

        for (
          const contour of contours
        ) {
          if (
            contour.length < 3
          ) {
            continue;
          }

          const curve =
            smoothContour(
              contour,
              strength
            );

          if (
            curve.length >= 3
          ) {
            smoothed.push(
              curve
            );
          }
        }

        if (
          !smoothed.length
        ) {
          continue;
        }

        /*
           ВАЖНО:

           Каждый уровень рисуется
           своим реальным цветом.

           Никаких промежуточных RGB.
        */

        drawLevel(
          ctx,
          smoothed,
          palette[level]
        );
      }

      if (
        token !==
        processToken
      ) {
        return;
      }

      const result =
        canvas.toDataURL(
          "image/png"
        );

      if (
        !result ||
        result === "data:,"
      ) {
        return;
      }

      installSmoothedLayer(
        result
      );

    } catch (error) {
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
       OPEN / CLOSE
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
       INPUT
       ===================================================== */

    range?.addEventListener(
      "input",
      () => {
        smoothingValue =
          clamp(
            Number(range.value),
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
           Во время движения ничего
           тяжёлого не вычисляем.

           Только убираем предыдущий
           результат, если он был.
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
          smoothingValue === 0
        ) {
          restoreOriginal();
        }
      }
    );

    /* =====================================================
       RELEASE
       ===================================================== */

    const scheduleRelease =
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
      scheduleRelease
    );

    range?.addEventListener(
      "touchend",
      scheduleRelease
    );

    range?.addEventListener(
      "mouseup",
      scheduleRelease
    );

    installed =
      true;
  }

  /* =======================================================
     WATCH GIF FRAME
     ======================================================= */

  function watchGIFFrame() {
    if (
      frameObserverStarted
    ) {
      return;
    }

    frameObserverStarted =
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

            /*
               Старый сглаженный кадр
               больше не соответствует
               новому GIF-кадру.
            */

            processToken++;

            removeSmoothedLayer();

            processing =
              false;

            /*
               Новый кадр сразу показываем
               без старого сглаживания.
            */

            target.style.opacity =
              "1";

            sourceOriginalOpacity =
              "1";

            /*
               Если сглаживание включено,
               обрабатываем новый кадр.
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
        smoothingValue === 0
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
