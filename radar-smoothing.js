/* =========================================================
   CLOrad — RADAR CONTOUR SMOOTHING
   ---------------------------------------------------------
   • Кнопка находится внутри «Настройки»
   • Располагается после «Кол. кадров»
   • 0% = оригинальный радар
   • 1–100% = сглаживание контуров
   • Без CSS blur
   • Без размытия цветов
   • Без появления новых цветов
   • Фон GIF не классифицируется как радар
   • Сглаживаются именно контуры областей
   • Обработка запускается после отпускания ползунка
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
     RADAR PALETTES
     -------------------------------------------------------
     Первые два цвета — фон / самые слабые служебные
     значения. Их НЕ сглаживаем.
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

  const SOURCE_CLASS_START = 2;

  /*
     Очень важно:

     Слишком большое расстояние превращает фон
     в радар. Поэтому классификация должна быть
     достаточно строгой.
  */

  const MAX_COLOR_DISTANCE = 22;

  /* =======================================================
     STATE
     ======================================================= */

  let smoothingValue = 0;

  let smoothingLayer = null;

  let sourceImageElement = null;

  let sourceOriginalOpacity = "1";

  let processing = false;

  let processToken = 0;

  let releaseTimer = null;

  let installed = false;

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

    const number =
      parseInt(
        value,
        16
      );

    if (
      !Number.isFinite(number)
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
          return result.colors
            .slice(0, 19)
            .map(hexToRGB);
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
          () => resolve(image);

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
     SOURCE PALETTE DETECTION
     ======================================================= */

  function detectSourcePalette(
    imageData
  ) {
    const data =
      imageData.data;

    const counters =
      new Array(
        SOURCE_OY_COLORS.length
      ).fill(0);

    const sourceColors =
      SOURCE_OY_COLORS.map(
        hexToRGB
      );

    /*
       Считаем только достаточно частые
       точные/близкие цвета.
    */

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      const alpha =
        data[i + 3];

      if (
        alpha < 20
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
        -1;

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

          best =
            c;
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

    let sourceMatches =
      0;

    for (
      let i = 0;
      i < counters.length;
      i++
    ) {
      sourceMatches +=
        counters[i];
    }

    /*
       Если исходная GIF действительно
       использует исходную ОЯ-палитру,
       возвращаем её.

       Если кадр уже перекрашен,
       дальше будет использована
       текущая палитра.
    */

    return {
      colors:
        sourceColors,

      matches:
        sourceMatches,

      counters
    };
  }

  /* =======================================================
     PALETTE MODE
     ======================================================= */

  function choosePalette(
    imageData
  ) {
    const target =
      getCurrentPalette();

    const source =
      detectSourcePalette(
        imageData
      );

    /*
       Если обнаружено много цветов
       исходной GIF — используем
       исходную палитру.

       Иначе кадр уже, скорее всего,
       перекрашен CLOrad.
    */

    if (
      source.matches >
      imageData.data.length / 4 * 0.01
    ) {
      return source.colors;
    }

    return target;
  }

  /* =======================================================
     LABEL MAP
     -------------------------------------------------------
     ВАЖНО:
     0 и 1 НИКОГДА не превращаются
     в область сглаживания.
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

    const boxes =
      [];

    for (
      let i = 0;
      i < palette.length;
      i++
    ) {
      boxes.push({
        minX: width,
        minY: height,
        maxX: -1,
        maxY: -1,
        count: 0
      });
    }

    /*
       Кеш цветов.

       GIF имеет ограниченную палитру,
       поэтому это сильно экономит CPU
       на iPhone.
    */

    const colorCache =
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

        /*
           Прозрачность — не радар.
        */

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

        let classIndex;

        if (
          colorCache.has(key)
        ) {
          classIndex =
            colorCache.get(key);
        } else {
          let best =
            -1;

          let bestDistance =
            Infinity;

          /*
             НАЧИНАЕМ С 2.

             Поэтому серый фон
             физически не может
             попасть в маску.
          */

          for (
            let i =
              SOURCE_CLASS_START;
            i < palette.length;
            i++
          ) {
            const color =
              palette[i];

            if (!color) {
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

              best =
                i;
            }
          }

          if (
            best < SOURCE_CLASS_START ||
            bestDistance >
              MAX_COLOR_DISTANCE
          ) {
            best =
              -1;
          }

          colorCache.set(
            key,
            best
          );

          classIndex =
            best;
        }

        if (
          classIndex <
          SOURCE_CLASS_START
        ) {
          continue;
        }

        labels[index] =
          classIndex;

        const box =
          boxes[classIndex];

        if (
          x < box.minX
        ) {
          box.minX =
            x;
        }

        if (
          y < box.minY
        ) {
          box.minY =
            y;
        }

        if (
          x > box.maxX
        ) {
          box.maxX =
            x;
        }

        if (
          y > box.maxY
        ) {
          box.maxY =
            y;
        }

        box.count++;
      }
    }

    return {
      labels,
      boxes
    };
  }

  /* =======================================================
     MORPHOLOGICAL CLEANUP
     -------------------------------------------------------
     Убирает мелкие одиночные пиксели,
     но НЕ расширяет весь радар.
     ======================================================= */

  function cleanupMask(
    labels,
    width,
    height,
    classIndex,
    strength
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
        labels[i] ===
        classIndex
      ) {
        mask[i] =
          1;
      }
    }

    /*
       На малых значениях
       почти не меняем исходные данные.
    */

    const radius =
      Math.max(
        0,
        Math.min(
          3,
          Math.floor(
            strength / 32
          )
        )
      );

    if (
      radius <= 0
    ) {
      return mask;
    }

    /*
       Закрытие маленьких дыр
       внутри области.
    */

    let current =
      mask;

    for (
      let pass = 0;
      pass < radius;
      pass++
    ) {
      const dilated =
        new Uint8Array(
          total
        );

      for (
        let y = 1;
        y < height - 1;
        y++
      ) {
        const row =
          y * width;

        for (
          let x = 1;
          x < width - 1;
          x++
        ) {
          let found =
            false;

          for (
            let dy = -1;
            dy <= 1 &&
            !found;
            dy++
          ) {
            for (
              let dx = -1;
              dx <= 1;
              dx++
            ) {
              if (
                current[
                  row +
                  dy * width +
                  x +
                  dx
                ]
              ) {
                found =
                  true;

                break;
              }
            }
          }

          if (
            found
          ) {
            dilated[
              row + x
            ] = 1;
          }
        }
      }

      current =
        dilated;
    }

    /*
       Затем erosion.
       Это возвращает границу
       ближе к исходному размеру.
    */

    for (
      let pass = 0;
      pass < radius;
      pass++
    ) {
      const eroded =
        new Uint8Array(
          total
        );

      for (
        let y = 1;
        y < height - 1;
        y++
      ) {
        const row =
          y * width;

        for (
          let x = 1;
          x < width - 1;
          x++
        ) {
          let all =
            true;

          for (
            let dy = -1;
            dy <= 1 &&
            all;
            dy++
          ) {
            for (
              let dx = -1;
              dx <= 1;
              dx++
            ) {
              if (
                !current[
                  row +
                  dy * width +
                  x +
                  dx
                ]
              ) {
                all =
                  false;

                break;
              }
            }
          }

          if (
            all
          ) {
            eroded[
              row + x
            ] = 1;
          }
        }
      }

      current =
        eroded;
    }

    return current;
  }

  /* =======================================================
     MARCHING SQUARES
     ======================================================= */

  function pointKey(
    x,
    y
  ) {
    return (
      x +
      ":" +
      y
    );
  }

  function buildSegments(
    mask,
    width,
    height,
    box
  ) {
    const segments =
      [];

    if (
      !box ||
      box.count <= 0
    ) {
      return segments;
    }

    const minX =
      Math.max(
        0,
        box.minX - 1
      );

    const minY =
      Math.max(
        0,
        box.minY - 1
      );

    const maxX =
      Math.min(
        width - 2,
        box.maxX
      );

    const maxY =
      Math.min(
        height - 2,
        box.maxY
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

      return Boolean(
        mask[
          y * width + x
        ]
      );
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
     CHAIN SEGMENTS
     -------------------------------------------------------
     В отличие от старой версии,
     здесь учитываются оба конца сегмента.
     ======================================================= */

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

    function addConnection(
      key,
      index
    ) {
      if (
        !connections.has(key)
      ) {
        connections.set(
          key,
          []
        );
      }

      connections
        .get(key)
        .push(index);
    }

    for (
      let i = 0;
      i < segments.length;
      i++
    ) {
      const s =
        segments[i];

      addConnection(
        pointKey(
          s[0],
          s[1]
        ),
        i
      );

      addConnection(
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

      const points =
        [];

      let currentX =
        first[0];

      let currentY =
        first[1];

      const startX =
        currentX;

      const startY =
        currentY;

      used[start] =
        1;

      points.push([
        currentX / 2,
        currentY / 2
      ]);

      let nextX =
        first[2];

      let nextY =
        first[3];

      points.push([
        nextX / 2,
        nextY / 2
      ]);

      currentX =
        nextX;

      currentY =
        nextY;

      let guard =
        0;

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

        const key =
          pointKey(
            currentX,
            currentY
          );

        const candidates =
          connections.get(
            key
          );

        if (
          !candidates
        ) {
          break;
        }

        let nextIndex =
          -1;

        for (
          let i = 0;
          i < candidates.length;
          i++
        ) {
          const candidate =
            candidates[i];

          if (
            !used[candidate]
          ) {
            nextIndex =
              candidate;

            break;
          }
        }

        if (
          nextIndex < 0
        ) {
          break;
        }

        used[nextIndex] =
          1;

        const segment =
          segments[nextIndex];

        const ax =
          segment[0];

        const ay =
          segment[1];

        const bx =
          segment[2];

        const by =
          segment[3];

        if (
          ax === currentX &&
          ay === currentY
        ) {
          currentX =
            bx;

          currentY =
            by;
        } else {
          currentX =
            ax;

          currentY =
            ay;
        }

        points.push([
          currentX / 2,
          currentY / 2
        ]);
      }

      if (
        points.length >= 4
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

          result.push(
            points
          );
        }
      }
    }

    return result;
  }

  /* =======================================================
     CONTOUR CLEANUP
     ======================================================= */

  function cleanContour(
    points
  ) {
    if (
      points.length < 4
    ) {
      return points;
    }

    const result =
      [];

    let previous =
      null;

    for (
      const point of points
    ) {
      if (
        !previous
      ) {
        result.push(
          point
        );

        previous =
          point;

        continue;
      }

      const dx =
        point[0] -
        previous[0];

      const dy =
        point[1] -
        previous[1];

      if (
        Math.abs(dx) +
        Math.abs(dy) >=
        0.05
      ) {
        result.push(
          point
        );

        previous =
          point;
      }
    }

    return result;
  }

  /* =======================================================
     CHAikin CURVE
     -------------------------------------------------------
     Именно он превращает ступенчатый
     контур в плавную округлую границу.
     ======================================================= */

  function chaikin(
    points,
    amount
  ) {
    if (
      points.length < 4
    ) {
      return points;
    }

    const result =
      [];

    const count =
      points.length;

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const a =
        points[i];

      const b =
        points[
          (i + 1) % count
        ];

      const q = [
        a[0] +
          (b[0] - a[0]) *
            amount,

        a[1] +
          (b[1] - a[1]) *
            amount
      ];

      const r = [
        b[0] -
          (b[0] - a[0]) *
            amount,

        b[1] -
          (b[1] - a[1]) *
            amount
      ];

      result.push(q);
      result.push(r);
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
       Даже при 5% сглаживание
       уже заметно, но не разрушает
       исходную форму.
    */

    const amount =
      0.045 +
      s * 0.18;

    let iterations =
      1;

    if (
      strength >= 30
    ) {
      iterations =
        2;
    }

    if (
      strength >= 65
    ) {
      iterations =
        3;
    }

    if (
      strength >= 88
    ) {
      iterations =
        4;
    }

    for (
      let i = 0;
      i < iterations;
      i++
    ) {
      result =
        chaikin(
          result,
          amount
        );
    }

    return result;
  }

  /* =======================================================
     DRAW
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

      const first =
        contour[0];

      ctx.moveTo(
        first[0],
        first[1]
      );

      /*
         Используем плавные квадратичные
         переходы между соседними
         точками вместо ломаной.
      */

      for (
        let i = 0;
        i < contour.length;
        i++
      ) {
        const current =
          contour[i];

        const next =
          contour[
            (i + 1) %
              contour.length
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

    ctx.fillStyle =
      color;

    /*
       Никакой полупрозрачности.
       Цвет остаётся исходным.
    */

    ctx.globalAlpha =
      1;

    ctx.fill(
      "evenodd"
    );

    ctx.restore();
  }

  /* =======================================================
     REMOVE SMOOTHING
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

    sourceImageElement =
      source;

    processing =
      false;
  }

  /* =======================================================
     INSTALL SMOOTHED LAYER
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

    /*
       Только теперь скрываем
       исходный квадратный растр.
    */

    const source =
      getSourceImage();

    if (
      source
    ) {
      sourceImageElement =
        source;

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
        150
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

      let imageData;

      try {
        imageData =
          ctx.getImageData(
            0,
            0,
            width,
            height
          );
      } catch (
        error
      ) {
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
        !Array.isArray(
          palette
        ) ||
        palette.length <
          19
      ) {
        return;
      }

      const mapData =
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

      /*
         Считаем только реальные
         цветные радарные пиксели.
      */

      let radarPixels =
        0;

      for (
        let i = 0;
        i < mapData.labels.length;
        i++
      ) {
        if (
          mapData.labels[i] >=
          SOURCE_CLASS_START
        ) {
          radarPixels++;
        }
      }

      /*
         Защита от серого прямоугольника.
      */

      if (
        radarPixels <
        20
      ) {
        return;
      }

      /*
         Новый прозрачный слой.

         Исходный фон вообще
         сюда не копируется.
      */

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      /*
         Для каждого класса
         строим собственную маску.
      */

      for (
        let classIndex =
          SOURCE_CLASS_START;
        classIndex <
          palette.length;
        classIndex++
      ) {
        if (
          token !==
          processToken
        ) {
          return;
        }

        const box =
          mapData.boxes[
            classIndex
          ];

        if (
          !box ||
          box.count <
            3
        ) {
          continue;
        }

        /*
           Отбрасываем очень маленькие
           одиночные цветовые шумы.
        */

        const minimumPixels =
          strength >= 70
            ? 2
            : 1;

        if (
          box.count <
          minimumPixels
        ) {
          continue;
        }

        const mask =
          cleanupMask(
            mapData.labels,
            width,
            height,
            classIndex,
            strength
          );

        /*
           Пересчитываем bounding box
           после очистки маски.
        */

        let maskCount =
          0;

        let minX =
          width;

        let minY =
          height;

        let maxX =
          -1;

        let maxY =
          -1;

        const scanMinX =
          Math.max(
            0,
            box.minX - 3
          );

        const scanMinY =
          Math.max(
            0,
            box.minY - 3
          );

        const scanMaxX =
          Math.min(
            width - 1,
            box.maxX + 3
          );

        const scanMaxY =
          Math.min(
            height - 1,
            box.maxY + 3
          );

        for (
          let y = scanMinY;
          y <= scanMaxY;
          y++
        ) {
          const row =
            y * width;

          for (
            let x = scanMinX;
            x <= scanMaxX;
            x++
          ) {
            if (
              mask[
                row + x
              ]
            ) {
              maskCount++;

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
        }

        if (
          maskCount <
          3 ||
          maxX < minX ||
          maxY < minY
        ) {
          continue;
        }

        const cleanBox = {
          minX,
          minY,
          maxX,
          maxY,
          count:
            maskCount
        };

        const segments =
          buildSegments(
            mask,
            width,
            height,
            cleanBox
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

        const smoothed =
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

        const color =
          palette[
            classIndex
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
          smoothed,
          cssColor
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
        result ===
          "data:,"
      ) {
        return;
      }

      installSmoothedLayer(
        result
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
       ВАЖНО:
       именно после «Кол. кадров».
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
       SLIDER
       -----------------------------------------------------
       Во время движения только
       меняем число.
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
           Если пользователь начал
           двигать ползунок,
           временно убираем старый
           результат.
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
     FRAME CHANGE WATCHER
     ======================================================= */

  function watchGIFFrame() {
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
               Новый кадр:
               старое сглаживание
               больше не соответствует
               изображению.
            */

            processToken++;

            removeSmoothedLayer();

            processing =
              false;

            /*
               Пока новый кадр не
               обработан — показываем
               оригинал.
            */

            target.style.opacity =
              "1";

            sourceImageElement =
              target;

            sourceOriginalOpacity =
              "1";

            /*
               Если сглаживание уже
               включено — автоматически
               строим его для нового кадра.
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
