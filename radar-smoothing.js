/* =========================================================
   CLOrad — RADAR CONTOUR SMOOTHING
   ---------------------------------------------------------
   Векторное сглаживание границ радарных уровней.

   • Кнопка внутри «Настройки»
   • После «Кол. кадров»
   • 0% = оригинальный радар
   • 1–100% = сглаживание
   • НЕТ CSS blur
   • НЕТ квадратных ячеек
   • НЕТ скруглённых квадратов
   • НЕТ новых цветов
   • НЕТ исчезновения исходного радара при ошибке
   • Границы строятся между соседними уровнями
   • Слабые уровни сохраняются
   • Фон карты не превращается в радар
   • Обработка после отпускания ползунка
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
     ORIGINAL OY PALETTE
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

  /* =======================================================
     DEFAULT RGMC PALETTE
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

  /* =======================================================
     CLASSIFICATION
     ======================================================= */

  const COLOR_DISTANCE =
    30;

  /*
     Слабые серые уровни допускаются
     только рядом с реальным цветным радаром.
  */

  const WEAK_RADAR_DISTANCE =
    48;

  /*
     После построения маски выполняется
     только классификационная фильтрация.

     Никакого удаления пикселей радара.
  */

  /* =======================================================
     STATE
     ======================================================= */

  let smoothingValue =
    0;

  let smoothingLayer =
    null;

  let sourceOriginalOpacity =
    "1";

  let sourceImageElement =
    null;

  let processing =
    false;

  let processToken =
    0;

  let releaseTimer =
    null;

  let installed =
    false;

  let frameObserver =
    null;

  /* =======================================================
     HELPERS
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
      typeof hex !==
      "string"
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

    const number =
      parseInt(
        value,
        16
      );

    if (
      !Number.isFinite(
        number
      )
    ) {
      return null;
    }

    return {
      r:
        (number >> 16) & 255,

      g:
        (number >> 8) & 255,

      b:
        number & 255
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
          Array.isArray(
            result.colors
          ) &&
          result.colors.length >= 19
        ) {
          const colors =
            result.colors
              .slice(0, 19)
              .map(hexToRGB);

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

  /* =======================================================
     LOAD CURRENT FRAME
     ======================================================= */

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
          () => {
            resolve(
              image
            );
          };

        image.onerror =
          () => {
            reject(
              new Error(
                "Не удалось загрузить кадр"
              )
            );
          };

        image.src =
          url;
      }
    );
  }

  /* =======================================================
     PALETTE DETECTION
     ======================================================= */

  function paletteScore(
    imageData,
    palette
  ) {
    if (
      !palette ||
      palette.length <
        19
    ) {
      return 0;
    }

    const data =
      imageData.data;

    /*
       Проверяем не каждый пиксель,
       а через небольшой шаг.
       Этого достаточно для выбора
       исходной палитры.
    */

    let score =
      0;

    const step =
      16;

    for (
      let i = 0;
      i < data.length;
      i +=
        4 * step
    ) {
      if (
        data[i + 3] <
        20
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
        c < 19;
        c++
      ) {
        const color =
          palette[c];

        if (
          !color
        ) {
          continue;
        }

        const d =
          rgbDistance(
            r,
            g,
            b,
            color
          );

        if (
          d < best
        ) {
          best =
            d;
        }
      }

      if (
        best <=
        COLOR_DISTANCE
      ) {
        score++;
      }
    }

    return score;
  }

  function choosePalette(
    imageData
  ) {
    const target =
      getCurrentPalette();

    const source =
      SOURCE_OY_COLORS.map(
        hexToRGB
      );

    const targetScore =
      paletteScore(
        imageData,
        target
      );

    const sourceScore =
      paletteScore(
        imageData,
        source
      );

    if (
      sourceScore >
      targetScore
    ) {
      return source;
    }

    return target;
  }

  /* =======================================================
     INITIAL LABEL MAP
     -------------------------------------------------------
     Каждый пиксель получает уровень
     0–18 или -1 = не радар.
     ======================================================= */

  function buildRawLabels(
    imageData,
    width,
    height,
    palette
  ) {
    const data =
      imageData.data;

    const total =
      width * height;

    const labels =
      new Int8Array(
        total
      );

    labels.fill(-1);

    /*
       Быстрый кеш RGB -> класс.
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

        const alpha =
          data[p + 3];

        if (
          alpha < 20
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

        for (
          let c = 0;
          c < palette.length;
          c++
        ) {
          const color =
            palette[c];

          if (
            !color
          ) {
            continue;
          }

          const d =
            rgbDistance(
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

            best =
              c;
          }
        }

        if (
          bestDistance >
          COLOR_DISTANCE
        ) {
          best =
            -1;
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
     STRONG RADAR MASK
     -------------------------------------------------------
     Классы 2–18 — цветной радар.
     ======================================================= */

  function buildStrongMask(
    labels,
    width,
    height
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
        labels[i] >= 2
      ) {
        mask[i] =
          1;
      }
    }

    return mask;
  }

  /* =======================================================
     DISTANCE FROM STRONG RADAR
     -------------------------------------------------------
     BFS до WEAK_RADAR_DISTANCE пикселей.

     Используется только для определения
     слабых серых уровней.
     ======================================================= */

  function buildStrongDistance(
    strongMask,
    width,
    height
  ) {
    const total =
      width * height;

    const distance =
      new Int16Array(
        total
      );

    distance.fill(-1);

    const queue =
      new Int32Array(
        total
      );

    let head =
      0;

    let tail =
      0;

    for (
      let i = 0;
      i < total;
      i++
    ) {
      if (
        strongMask[i]
      ) {
        distance[i] =
          0;

        queue[tail++] =
          i;
      }
    }

    while (
      head < tail
    ) {
      const index =
        queue[head++];

      const d =
        distance[index];

      if (
        d >=
        WEAK_RADAR_DISTANCE
      ) {
        continue;
      }

      const x =
        index % width;

      const y =
        (index / width) |
        0;

      const nextDistance =
        d + 1;

      if (
        x > 0
      ) {
        const n =
          index - 1;

        if (
          distance[n] <
          0
        ) {
          distance[n] =
            nextDistance;

          queue[tail++] =
            n;
        }
      }

      if (
        x <
        width - 1
      ) {
        const n =
          index + 1;

        if (
          distance[n] <
          0
        ) {
          distance[n] =
            nextDistance;

          queue[tail++] =
            n;
        }
      }

      if (
        y > 0
      ) {
        const n =
          index - width;

        if (
          distance[n] <
          0
        ) {
          distance[n] =
            nextDistance;

          queue[tail++] =
            n;
        }
      }

      if (
        y <
        height - 1
      ) {
        const n =
          index + width;

        if (
          distance[n] <
          0
        ) {
          distance[n] =
            nextDistance;

          queue[tail++] =
            n;
        }
      }
    }

    return distance;
  }

  /* =======================================================
     FINAL RADAR LABELS
     -------------------------------------------------------
     Серые уровни 0/1 сохраняются только
     возле реального цветного радара.

     Поэтому фон карты не превращается
     в огромный серый прямоугольник.
     ======================================================= */

  function buildFinalLabels(
    rawLabels,
    strongDistance,
    width,
    height
  ) {
    const total =
      width * height;

    const labels =
      new Int8Array(
        total
      );

    labels.fill(-1);

    for (
      let i = 0;
      i < total;
      i++
    ) {
      const value =
        rawLabels[i];

      if (
        value >= 2
      ) {
        labels[i] =
          value;

        continue;
      }

      if (
        value === 0 ||
        value === 1
      ) {
        const d =
          strongDistance[i];

        if (
          d >= 0 &&
          d <=
            WEAK_RADAR_DISTANCE
        ) {
          labels[i] =
            value;
        }
      }
    }

    return labels;
  }

  /* =======================================================
     BOUNDS
     ======================================================= */

  function findRadarBounds(
    labels,
    width,
    height
  ) {
    let minX =
      width;

    let minY =
      height;

    let maxX =
      -1;

    let maxY =
      -1;

    let count =
      0;

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
        if (
          labels[row + x] <
          0
        ) {
          continue;
        }

        count++;

        if (
          x < minX
        ) {
          minX =
            x;
        }

        if (
          y < minY
        ) {
          minY =
            y;
        }

        if (
          x > maxX
        ) {
          maxX =
            x;
        }

        if (
          y > maxY
        ) {
          maxY =
            y;
        }
      }
    }

    if (
      count === 0
    ) {
      return null;
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      count
    };
  }

  /* =======================================================
     THRESHOLD MASK
     -------------------------------------------------------
     ВАЖНЕЙШАЯ ЧАСТЬ.

     Мы НЕ сглаживаем каждый цвет отдельно.

     Для уровня N строится:

       class >= N

     Поэтому все контуры автоматически
     вложены друг в друга.
     ======================================================= */

  function buildThresholdMask(
    labels,
    width,
    height,
    threshold
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
        labels[i] >=
        threshold
      ) {
        mask[i] =
          1;
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
    height,
    bounds
  ) {
    const segments =
      [];

    if (
      !bounds
    ) {
      return segments;
    }

    const minX =
      Math.max(
        0,
        bounds.minX - 1
      );

    const minY =
      Math.max(
        0,
        bounds.minY - 1
      );

    const maxX =
      Math.min(
        width - 2,
        bounds.maxX + 1
      );

    const maxY =
      Math.min(
        height - 2,
        bounds.maxY + 1
      );

    function inside(
      x,
      y
    ) {
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
      let y = minY;
      y <= maxY;
      y++
    ) {
      for (
        let x = minX;
        x <= maxX;
        x++
      ) {
        const tl =
          inside(
            x,
            y
          )
            ? 1
            : 0;

        const tr =
          inside(
            x + 1,
            y
          )
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

        switch (
          code
        ) {
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
               Для неоднозначной клетки
               используем разбиение,
               сохраняющее два отдельных
               радара.
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
     CHAIN
     ======================================================= */

  function pointKey(
    x,
    y
  ) {
    return (
      x +
      "," +
      y
    );
  }

  function chainSegments(
    segments
  ) {
    const result =
      [];

    if (
      !segments.length
    ) {
      return result;
    }

    const connections =
      new Map();

    function connect(
      x,
      y,
      index
    ) {
      const key =
        pointKey(
          x,
          y
        );

      let list =
        connections.get(
          key
        );

      if (
        !list
      ) {
        list =
          [];

        connections.set(
          key,
          list
        );
      }

      list.push(
        index
      );
    }

    for (
      let i = 0;
      i < segments.length;
      i++
    ) {
      const s =
        segments[i];

      connect(
        s[0],
        s[1],
        i
      );

      connect(
        s[2],
        s[3],
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

      let startX =
        first[0];

      let startY =
        first[1];

      let currentX =
        first[2];

      let currentY =
        first[3];

      const points =
        [];

      points.push([
        startX / 2,
        startY / 2
      ]);

      points.push([
        currentX / 2,
        currentY / 2
      ]);

      used[start] =
        1;

      let guard =
        0;

      while (
        guard++ <
        segments.length + 8
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
          const candidate =
            list[i];

          if (
            !used[candidate]
          ) {
            next =
              candidate;

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
          s[0] ===
            currentX &&
          s[1] ===
            currentY
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

      /*
         Для сглаживания нужны замкнутые
         контуры.

         Если контур замкнулся —
         сохраняем его.

         Если он упирается в край
         изображения — тоже сохраняем,
         но замыкаем по краю.
      */

      if (
        points.length >= 3
      ) {
        const firstPoint =
          points[0];

        const lastPoint =
          points[
            points.length - 1
          ];

        const closed =
          Math.abs(
            firstPoint[0] -
            lastPoint[0]
          ) < 0.01 &&
          Math.abs(
            firstPoint[1] -
            lastPoint[1]
          ) < 0.01;

        if (
          closed
        ) {
          points.pop();

          if (
            points.length >= 3
          ) {
            result.push(
              points
            );
          }
        }
      }
    }

    return result;
  }

  /* =======================================================
     CONTOUR SIMPLIFICATION
     -------------------------------------------------------
     Убираем только дублирующиеся точки.
     Никакие радарные пиксели здесь
     не удаляются.
     ======================================================= */

  function simplifyContour(
    points
  ) {
    if (
      points.length < 4
    ) {
      return points;
    }

    const result =
      [];

    let last =
      null;

    for (
      const p of points
    ) {
      if (
        !last
      ) {
        result.push(
          p
        );

        last =
          p;

        continue;
      }

      const dx =
        p[0] -
        last[0];

      const dy =
        p[1] -
        last[1];

      if (
        Math.abs(dx) >
          0.001 ||
        Math.abs(dy) >
          0.001
      ) {
        result.push(
          p
        );

        last =
          p;
      }
    }

    return result;
  }

  /* =======================================================
     SMOOTH CLOSED CONTOUR
     -------------------------------------------------------
     Сначала слегка смещаем точки
     к соседям.

     Затем рисуем через середины
     соседних точек.

     Поэтому видимых квадратных
     радарных клеток не остаётся.
     ======================================================= */

  function smoothContour(
    points,
    strength
  ) {
    let result =
      simplifyContour(
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
       Очень маленький эффект
       на малых значениях.

       При 5%:
       почти исходная геометрия.

       При 100%:
       сильное сглаживание.
    */

    const factor =
      0.008 +
      s * 0.105;

    let iterations =
      1;

    if (
      strength >= 35
    ) {
      iterations =
        2;
    }

    if (
      strength >= 70
    ) {
      iterations =
        3;
    }

    if (
      strength >= 92
    ) {
      iterations =
        4;
    }

    for (
      let pass = 0;
      pass < iterations;
      pass++
    ) {
      const next =
        new Array(
          result.length
        );

      const count =
        result.length;

      for (
        let i = 0;
        i < count;
        i++
      ) {
        const previous =
          result[
            (i - 1 + count) %
              count
          ];

        const current =
          result[i];

        const following =
          result[
            (i + 1) %
              count
          ];

        /*
           Локальное сглаживание.

           Не происходит масштабного
           сжатия всей области.
        */

        const targetX =
          (
            previous[0] +
            current[0] +
            following[0]
          ) / 3;

        const targetY =
          (
            previous[1] +
            current[1] +
            following[1]
          ) / 3;

        next[i] = [
          current[0] +
            (
              targetX -
              current[0]
            ) *
              factor,

          current[1] +
            (
              targetY -
              current[1]
            ) *
              factor
        ];
      }

      result =
        next;
    }

    return result;
  }

  /* =======================================================
     DRAW CONTOURS
     ======================================================= */

  function drawContours(
    ctx,
    contours,
    color
  ) {
    if (
      !contours.length
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

      const count =
        contour.length;

      const first =
        contour[0];

      const second =
        contour[1];

      /*
         Начинаем не с вершины,
         а с середины первой пары.

         Это создаёт непрерывную
         кривую без углов квадратов.
      */

      const startX =
        (
          first[0] +
          second[0]
        ) / 2;

      const startY =
        (
          first[1] +
          second[1]
        ) / 2;

      ctx.moveTo(
        startX,
        startY
      );

      for (
        let i = 1;
        i <= count;
        i++
      ) {
        const current =
          contour[
            i % count
          ];

        const next =
          contour[
            (i + 1) %
              count
          ];

        const middleX =
          (
            current[0] +
            next[0]
          ) / 2;

        const middleY =
          (
            current[1] +
            next[1]
          ) / 2;

        ctx.quadraticCurveTo(
          current[0],
          current[1],
          middleX,
          middleY
        );
      }

      ctx.closePath();
    }

    /*
       ВАЖНО:
       никаких alpha,
       никаких blend,
       никаких фильтров.
    */

    ctx.globalAlpha =
      1;

    ctx.globalCompositeOperation =
      "source-over";

    ctx.fillStyle =
      color;

    ctx.fill(
      "evenodd"
    );

    ctx.restore();
  }

  /* =======================================================
     REMOVE SMOOTHING LAYER
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
        "1";

      sourceImageElement =
        source;

      sourceOriginalOpacity =
        "1";
    }

    processing =
      false;
  }

  /* =======================================================
     INSTALL LAYER
     -------------------------------------------------------
     Оригинал скрывается ТОЛЬКО после
     загрузки нового слоя.

     Если новый слой не загрузился —
     GIF остаётся видимой.
     ======================================================= */

  function installSmoothedLayer(
    dataURL,
    token
  ) {
    return new Promise(
      resolve => {
        if (
          token !==
          processToken
        ) {
          resolve(
            false
          );

          return;
        }

        if (
          !window.map
        ) {
          resolve(
            false
          );

          return;
        }

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

        let finished =
          false;

        const cleanup =
          () => {
            if (
              finished
            ) {
              return;
            }

            finished =
              true;
          };

        layer.once(
          "load",
          () => {
            if (
              token !==
              processToken
            ) {
              if (
                window.map.hasLayer(
                  layer
                )
              ) {
                window.map.removeLayer(
                  layer
                );
              }

              cleanup();

              resolve(
                false
              );

              return;
            }

            /*
               Новый слой реально
               загрузился.

               Только сейчас
               скрываем GIF.
            */

            const source =
              getSourceImage();

            if (
              source
            ) {
              sourceImageElement =
                source;

              sourceOriginalOpacity =
                "1";

              source.style.opacity =
                "0";
            }

            smoothingLayer =
              layer;

            try {
              layer.bringToFront();
            } catch (
              error
            ) {}

            cleanup();

            resolve(
              true
            );
          }
        );

        layer.once(
          "error",
          () => {
            if (
              window.map.hasLayer(
                layer
              )
            ) {
              window.map.removeLayer(
                layer
              );
            }

            /*
               Оригинал намеренно
               НЕ скрываем.
            */

            const source =
              getSourceImage();

            if (
              source
            ) {
              source.style.opacity =
                "1";
            }

            cleanup();

            resolve(
              false
            );
          }
        );

        layer.addTo(
          window.map
        );
      }
    );
  }

  /* =======================================================
     BUILD SMOOTH RADAR
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
        () => {
          if (
            token ===
            processToken
          ) {
            processCurrentFrame(
              strength
            );
          }
        },
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
            alpha: true,
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
         Получаем исходный кадр.
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

      /*
         Определяем, какая палитра
         реально находится в кадре.
      */

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
         Строим исходную карту классов.
      */

      const rawLabels =
        buildRawLabels(
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

      /*
         Сильный радар.
      */

      const strongMask =
        buildStrongMask(
          rawLabels,
          width,
          height
        );

      let strongCount =
        0;

      for (
        let i = 0;
        i < strongMask.length;
        i++
      ) {
        strongCount +=
          strongMask[i];
      }

      /*
         Если реального радара нет,
         ничего не меняем.
      */

      if (
        strongCount <
        5
      ) {
        return;
      }

      /*
         Определяем, какие слабые
         серые пиксели действительно
         относятся к радару.
      */

      const strongDistance =
        buildStrongDistance(
          strongMask,
          width,
          height
        );

      if (
        token !==
        processToken
      ) {
        return;
      }

      const labels =
        buildFinalLabels(
          rawLabels,
          strongDistance,
          width,
          height
        );

      const radarBounds =
        findRadarBounds(
          labels,
          width,
          height
        );

      if (
        !radarBounds
      ) {
        return;
      }

      /*
         Полностью очищаем canvas.

         Поэтому фон карты/GIF сюда
         вообще не копируется.
      */

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      /*
         ====================================================
         СТРОИМ РАДАР С НАРУЖИ ВНУТРЬ
         ====================================================

         threshold 0:
           вся область слабого радара

         threshold 1:
           уровень >= 1

         threshold 2:
           уровень >= 2

         ...

         threshold 18:
           самый сильный уровень

         Каждый следующий уровень
         рисуется поверх предыдущего.

         Поэтому:
         • нет отдельных квадратов;
         • границы непрерывны;
         • цвета не смешиваются;
         • уровни не сливаются;
         • внутренние области остаются
           внутри внешних.
         ====================================================
      */

      for (
        let threshold = 0;
        threshold <= 18;
        threshold++
      ) {
        if (
          token !==
          processToken
        ) {
          return;
        }

        /*
           Проверяем, существует ли
           вообще такой уровень.
        */

        let exists =
          false;

        for (
          let i = 0;
          i < labels.length;
          i++
        ) {
          if (
            labels[i] >=
            threshold
          ) {
            exists =
              true;

            break;
          }
        }

        if (
          !exists
        ) {
          continue;
        }

        const mask =
          buildThresholdMask(
            labels,
            width,
            height,
            threshold
          );

        /*
           Контуры строятся по общей
           маске уровня, а не по
           отдельным цветным пикселям.
        */

        const segments =
          buildSegments(
            mask,
            width,
            height,
            radarBounds
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

        const smooth =
          [];

        for (
          const contour of contours
        ) {
          if (
            contour.length <
            4
          ) {
            continue;
          }

          const curve =
            smoothContour(
              contour,
              strength
            );

          if (
            curve.length >=
            4
          ) {
            smooth.push(
              curve
            );
          }
        }

        if (
          !smooth.length
        ) {
          continue;
        }

        const color =
          palette[
            threshold
          ];

        if (
          !color
        ) {
          continue;
        }

        const cssColor =
          `rgb(${color.r},${color.g},${color.b})`;

        drawContours(
          ctx,
          smooth,
          cssColor
        );
      }

      if (
        token !==
        processToken
      ) {
        return;
      }

      /*
         PNG с прозрачным фоном.

         Здесь нет карты,
         нет серого прямоугольника,
         нет CSS blur.
      */

      const dataURL =
        canvas.toDataURL(
          "image/png"
        );

      if (
        !dataURL ||
        dataURL ===
          "data:,"
      ) {
        return;
      }

      if (
        token !==
        processToken
      ) {
        return;
      }

      /*
         Устанавливаем новый слой.

         Важно:
         оригинал всё ещё виден,
         пока PNG реально не загрузился.
      */

      await installSmoothedLayer(
        dataURL,
        token
      );
    } catch (
      error
    ) {
      /*
         Самое важное:
         при ЛЮБОЙ ошибке оригинальный
         радар остаётся видимым.
      */

      console.error(
        "CLOrad radar smoothing:",
        error
      );

      const source =
        getSourceImage();

      if (
        source
      ) {
        source.style.opacity =
          "1";
      }

      removeSmoothedLayer();
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
       Ставим строго после
       «Кол. кадров».
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
       INPUT
       -----------------------------------------------------
       Здесь НЕ запускается тяжёлая
       обработка.
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
           0% сразу возвращает
           оригинальный радар.
        */

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
      event => {
        if (
          event
        ) {
          event.preventDefault();
        }

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
      release,
      {
        passive: false
      }
    );

    range?.addEventListener(
      "mouseup",
      release
    );

    installed =
      true;
  }

  /* =======================================================
     FRAME WATCHER
     ======================================================= */

  function watchGIFFrame() {
    if (
      frameObserver
    ) {
      return;
    }

    frameObserver =
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
               Новый кадр.

               Старый сглаженный слой
               больше не используется.
            */

            processToken++;

            removeSmoothedLayer();

            processing =
              false;

            /*
               НОВАЯ GIF ВСЕГДА
               ОСТАЁТСЯ ВИДИМОЙ.
            */

            target.style.opacity =
              "1";

            sourceImageElement =
              target;

            sourceOriginalOpacity =
              "1";

            /*
               Если сглаживание включено,
               после появления нового
               кадра строим его заново.
            */

            if (
              smoothingValue >
              0
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
                  180
                );
            }
          }
        }
      );

    frameObserver.observe(
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
