/* =========================================================
   CLOrad — RADAR CONTOUR SMOOTHING
   ---------------------------------------------------------
   ВАЖНО:

   • Не использует CSS blur
   • Не перекрашивает фон
   • Не превращает весь GIF в один цвет
   • Не создаёт квадратов
   • Работает только с цветными радарными классами
   • Серые классы 0–1 сохраняются как есть
   • Контуры строятся через marching-squares
   • Затем сглаживаются Chaikin-кривыми
   • 0% = исходный кадр
   • Обработка запускается после отпускания ползунка
   • Результат остаётся географически привязан к GIF
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const GIF_BOUNDS = [
    [38.2155955810, 14.9892981264],
    [69.6543707199, 72.9237642948]
  ];

  const SETTING_ID = "cloradSmoothingSetting";
  const BUTTON_ID = "cloradSmoothingButton";
  const PANEL_ID = "cloradSmoothingPanel";
  const RANGE_ID = "cloradSmoothingRange";
  const VALUE_ID = "cloradSmoothingValue";

  const SOURCE_CLASS_START = 2;

  const MIN_COLOR_DISTANCE = 34;

  let smoothingValue = 0;

  let smoothingLayer = null;

  let processing = false;

  let processToken = 0;

  let releaseTimer = null;

  let sourceImageOpacity = null;

  let sourceImageElement = null;

  let installed = false;

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

  function rgbFromHex(hex) {
    if (
      typeof hex !== "string"
    ) {
      return null;
    }

    let value =
      hex
        .trim()
        .replace("#", "");

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
        (number >> 16) &
        255,

      g:
        (number >> 8) &
        255,

      b:
        number &
        255
    };
  }

  function getCurrentPalette() {
    if (
      typeof window.CLOradGetCurrentPalette ===
      "function"
    ) {
      const palette =
        window.CLOradGetCurrentPalette();

      if (
        palette &&
        Array.isArray(
          palette.colors
        )
      ) {
        return palette.colors
          .map(
            rgbFromHex
          )
          .filter(Boolean);
      }
    }

    const fallback = [
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

    return fallback
      .map(
        rgbFromHex
      )
      .filter(Boolean);
  }

  /* =======================================================
     FIND ORIGINAL GIF IMAGE
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

    /*
       Наш собственный слой имеет
       другой CSS-класс, поэтому
       здесь всегда берём именно
       оригинальный GIF-layer.
    */

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

  /* =======================================================
     LOAD IMAGE
     ======================================================= */

  function loadImage(url) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        const image =
          new Image();

        /*
           Для обычного same-origin
           URL это не мешает.
        */

        if (
          !String(url)
            .startsWith(
              "data:"
            )
        ) {
          image.crossOrigin =
            "anonymous";
        }

        image.onload =
          () => resolve(image);

        image.onerror =
          () =>
            reject(
              new Error(
                "Не удалось загрузить кадр для сглаживания"
              )
            );

        image.src = url;
      }
    );
  }

  /* =======================================================
     COLOR DISTANCE
     ======================================================= */

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
     BUILD LABEL MAP
     -------------------------------------------------------
     Очень важно:

     Мы НЕ пытаемся определить
     каждый неизвестный пиксель
     как радарный.

     Если цвет не похож на один
     из цветов палитры — он остаётся
     нетронутым.

     Классы 0 и 1 намеренно
     не сглаживаются.

     Поэтому серый фон больше
     не может превратиться
     в огромный прямоугольник.
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

    labels.fill(
      -1
    );

    /*
       Боксы каждого класса.
    */

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
       LUT для уже встреченных
       RGB-комбинаций.

       Это сильно сокращает
       количество вычислений
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
           Полностью прозрачный
           пиксель никогда не является
           радарным классом.
        */

        if (
          alpha < 16
        ) {
          continue;
        }

        const r =
          data[p];

        const g =
          data[p + 1];

        const b =
          data[p + 2];

        /*
           Сначала пробуем
           быстрый ключ.
        */

        const key =
          (
            r << 16
          ) |
          (
            g << 8
          ) |
          b;

        let classIndex;

        if (
          colorCache.has(
            key
          )
        ) {
          classIndex =
            colorCache.get(
              key
            );
        } else {
          let best =
            -1;

          let bestDistance =
            Infinity;

          /*
             Начинаем с 2.

             0 и 1 сохраняются
             оригинальными.
          */

          for (
            let i =
              SOURCE_CLASS_START;
            i < palette.length;
            i++
          ) {
            const distance =
              colorDistance(
                r,
                g,
                b,
                palette[i]
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

          /*
             Если цвет слишком далеко
             от палитры — это НЕ радар.

             Критически важно для фона.
          */

          if (
            best < 0 ||
            bestDistance >
              MIN_COLOR_DISTANCE
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
          classIndex < 0
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
          box.minX = x;
        }

        if (
          y < box.minY
        ) {
          box.minY = y;
        }

        if (
          x > box.maxX
        ) {
          box.maxX = x;
        }

        if (
          y > box.maxY
        ) {
          box.maxY = y;
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
     MARCHING SQUARES
     ======================================================= */

  function buildSegmentsForClass(
    labels,
    width,
    height,
    classIndex,
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

    /*
       Небольшой запас вокруг
       bounding box.
    */

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

      return (
        labels[
          y * width + x
        ] ===
        classIndex
      );
    }

    /*
       Координаты умножены
       на 2, чтобы все точки
       были целыми.

       Это исключает проблемы
       с floating-point keys.
    */

    function addSegment(
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

        /*
           Точки:

           top    = (2x+1, 2y)
           right  = (2x+2, 2y+1)
           bottom = (2x+1, 2y+2)
           left   = (2x,   2y+1)
        */

        const topX =
          2 * x + 1;

        const topY =
          2 * y;

        const rightX =
          2 * x + 2;

        const rightY =
          2 * y + 1;

        const bottomX =
          2 * x + 1;

        const bottomY =
          2 * y + 2;

        const leftX =
          2 * x;

        const leftY =
          2 * y + 1;

        switch (
          code
        ) {
          case 1:
            addSegment(
              leftX,
              leftY,
              topX,
              topY
            );
            break;

          case 2:
            addSegment(
              topX,
              topY,
              rightX,
              rightY
            );
            break;

          case 3:
            addSegment(
              leftX,
              leftY,
              rightX,
              rightY
            );
            break;

          case 4:
            addSegment(
              rightX,
              rightY,
              bottomX,
              bottomY
            );
            break;

          case 5:
            addSegment(
              leftX,
              leftY,
              topX,
              topY
            );

            addSegment(
              rightX,
              rightY,
              bottomX,
              bottomY
            );
            break;

          case 6:
            addSegment(
              topX,
              topY,
              bottomX,
              bottomY
            );
            break;

          case 7:
            addSegment(
              leftX,
              leftY,
              bottomX,
              bottomY
            );
            break;

          case 8:
            addSegment(
              bottomX,
              bottomY,
              leftX,
              leftY
            );
            break;

          case 9:
            addSegment(
              topX,
              topY,
              bottomX,
              bottomY
            );
            break;

          case 10:
            addSegment(
              topX,
              topY,
              leftX,
              leftY
            );

            addSegment(
              rightX,
              rightY,
              bottomX,
              bottomY
            );
            break;

          case 11:
            addSegment(
              rightX,
              rightY,
              bottomX,
              bottomY
            );
            break;

          case 12:
            addSegment(
              rightX,
              rightY,
              leftX,
              leftY
            );
            break;

          case 13:
            addSegment(
              topX,
              topY,
              rightX,
              rightY
            );
            break;

          case 14:
            addSegment(
              topX,
              topY,
              leftX,
              leftY
            );
            break;
        }
      }
    }

    return segments;
  }

  /* =======================================================
     SEGMENT KEY
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

  /* =======================================================
     CHAIN SEGMENTS
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

    const starts =
      new Map();

    for (
      let i = 0;
      i < segments.length;
      i++
    ) {
      const segment =
        segments[i];

      const key =
        pointKey(
          segment[0],
          segment[1]
        );

      if (
        !starts.has(
          key
        )
      ) {
        starts.set(
          key,
          []
        );
      }

      starts
        .get(key)
        .push(i);
    }

    const used =
      new Uint8Array(
        segments.length
      );

    /*
       Сначала пытаемся
       строить замкнутые контуры.
    */

    for (
      let startIndex = 0;
      startIndex <
        segments.length;
      startIndex++
    ) {
      if (
        used[startIndex]
      ) {
        continue;
      }

      const first =
        segments[
          startIndex
        ];

      const points =
        [];

      let currentIndex =
        startIndex;

      let guard =
        0;

      const startX =
        first[0];

      const startY =
        first[1];

      let currentX =
        first[2];

      let currentY =
        first[3];

      points.push([
        startX / 2,
        startY / 2
      ]);

      used[
        currentIndex
      ] = 1;

      points.push([
        currentX / 2,
        currentY / 2
      ]);

      while (
        guard++ <
        segments.length + 10
      ) {
        if (
          currentX ===
            startX &&
          currentY ===
            startY
        ) {
          break;
        }

        const key =
          pointKey(
            currentX,
            currentY
          );

        const candidates =
          starts.get(
            key
          );

        if (
          !candidates ||
          !candidates.length
        ) {
          break;
        }

        let nextIndex =
          -1;

        /*
           Обычно здесь только
           один следующий сегмент.

           Если несколько —
           выбираем первый
           неиспользованный.
        */

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

        used[
          nextIndex
        ] = 1;

        const next =
          segments[
            nextIndex
          ];

        currentX =
          next[2];

        currentY =
          next[3];

        points.push([
          currentX / 2,
          currentY / 2
        ]);
      }

      /*
         Оставляем только
         действительно замкнутые
         контуры.

         Открытые обрывки не
         рисуем — именно это
         помогает убрать пропуски.
      */

      if (
        points.length >= 4 &&
        Math.abs(
          points[0][0] -
          points[
            points.length - 1
          ][0]
        ) < 0.01 &&
        Math.abs(
          points[0][1] -
          points[
            points.length - 1
          ][1]
        ) < 0.01
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
     REMOVE DUPLICATE POINTS
     ======================================================= */

  function cleanContour(
    points
  ) {
    if (
      points.length <
      3
    ) {
      return [];
    }

    const result =
      [];

    let previous =
      null;

    for (
      const point of points
    ) {
      if (
        previous &&
        Math.abs(
          point[0] -
          previous[0]
        ) < 0.01 &&
        Math.abs(
          point[1] -
          previous[1]
        ) < 0.01
      ) {
        continue;
      }

      result.push(
        point
      );

      previous =
        point;
    }

    return result;
  }

  /* =======================================================
     CHAIKIN SMOOTHING
     ======================================================= */

  function chaikin(
    points,
    amount
  ) {
    if (
      points.length <
      3
    ) {
      return points;
    }

    const result =
      [];

    const t =
      clamp(
        amount,
        0.01,
        0.45
      );

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

      const q = [
        a[0] +
          (b[0] - a[0]) *
            t,

        a[1] +
          (b[1] - a[1]) *
            t
      ];

      const r = [
        b[0] -
          (b[0] - a[0]) *
            t,

        b[1] -
          (b[1] - a[1]) *
            t
      ];

      result.push(
        q,
        r
      );
    }

    return result;
  }

  /* =======================================================
     SMOOTH CONTOUR
     ======================================================= */

  function smoothContour(
    points,
    strength
  ) {
    let result =
      cleanContour(
        points
      );

    if (
      result.length <
      4
    ) {
      return result;
    }

    const normalized =
      strength /
      100;

    /*
       Даже 5% уже слегка
       округляет углы.

       При этом форма практически
       не меняется.
    */

    const amount =
      0.07 +
      normalized *
        0.31;

    let iterations =
      1;

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
        chaikin(
          result,
          amount
        );
    }

    return result;
  }

  /* =======================================================
     DRAW SMOOTH CONTOURS
     ======================================================= */

  function drawContours(
    ctx,
    contours,
    color,
    strength
  ) {
    if (
      !contours.length
    ) {
      return;
    }

    ctx.save();

    ctx.beginPath();

    /*
       Все контуры класса
       идут в один Path.

       evenodd позволяет
       сохранять отверстия.
    */

    for (
      const contour of contours
    ) {
      if (
        contour.length <
        3
      ) {
        continue;
      }

      const first =
        contour[0];

      ctx.moveTo(
        first[0],
        first[1]
      );

      for (
        let i = 1;
        i < contour.length;
        i++
      ) {
        ctx.lineTo(
          contour[i][0],
          contour[i][1]
        );
      }

      ctx.closePath();
    }

    ctx.fillStyle =
      color;

    ctx.strokeStyle =
      color;

    /*
       Небольшое перекрытие
       тем же самым цветом.

       Никаких новых RGB-цветов
       здесь не создаётся.
    */

    ctx.lineWidth =
      1.15 +
      strength *
        0.018;

    ctx.lineJoin =
      "round";

    ctx.lineCap =
      "round";

    ctx.fill(
      "evenodd"
    );

    ctx.stroke();

    ctx.restore();
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

    if (
      processing
    ) {
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

    processing =
      true;

    try {
      const image =
        await loadImage(
          source.currentSrc ||
          source.src
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

      const palette =
        getCurrentPalette();

      if (
        palette.length <
        3
      ) {
        return;
      }

      const map =
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

      const labels =
        map.labels;

      /*
         Если радарных цветных
         пикселей вообще нет —
         ничего не меняем.
      */

      let coloredPixels =
        0;

      for (
        let i = 0;
        i < labels.length;
        i++
      ) {
        if (
          labels[i] >=
          SOURCE_CLASS_START
        ) {
          coloredPixels++;
        }
      }

      if (
        coloredPixels <
        20
      ) {
        return;
      }

      /*
         Удаляем из изображения
         ТОЛЬКО цветные радарные
         классы.

         Серый фон и прочие
         неизвестные пиксели
         остаются полностью
         нетронутыми.
      */

      const data =
        imageData.data;

      for (
        let i = 0;
        i < labels.length;
        i++
      ) {
        if (
          labels[i] >=
          SOURCE_CLASS_START
        ) {
          const p =
            i * 4;

          data[p + 3] =
            0;
        }
      }

      ctx.putImageData(
        imageData,
        0,
        0
      );

      /*
         Теперь поверх оригинала
         строим настоящие
         сглаженные контуры.
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
          map.boxes[
            classIndex
          ];

        if (
          !box ||
          box.count <= 0
        ) {
          continue;
        }

        const segments =
          buildSegmentsForClass(
            labels,
            width,
            height,
            classIndex,
            box
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

        const smoothContours =
          contours
            .map(
              contour =>
                smoothContour(
                  contour,
                  strength
                )
            )
            .filter(
              contour =>
                contour.length >=
                3
            );

        if (
          !smoothContours.length
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

        drawContours(
          ctx,
          smoothContours,
          `rgb(${color.r},${color.g},${color.b})`,
          strength
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
        "CLOrad smoothing:",
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
     SMOOTHED LEAFLET LAYER
     ======================================================= */

  function installSmoothedLayer(
    url
  ) {
    if (
      !window.map
    ) {
      return;
    }

    removeSmoothedLayer();

    smoothingLayer =
      L.imageOverlay(
        url,
        GIF_BOUNDS,
        {
          opacity: 1,
          interactive: false,
          zIndex: 7,
          className:
            "clorad-gif-radar-smoothed"
        }
      );

    smoothingLayer.addTo(
      window.map
    );

    /*
       Исходный GIF скрываем
       только после того, как
       новый слой уже готов.
    */

    sourceImageElement =
      getSourceImage();

    if (
      sourceImageElement
    ) {
      if (
        sourceImageOpacity ===
        null
      ) {
        sourceImageOpacity =
          sourceImageElement.style.opacity ||
          "1";
      }

      sourceImageElement.style.opacity =
        "0";
    }

    if (
      typeof smoothingLayer.bringToFront ===
      "function"
    ) {
      smoothingLayer.bringToFront();
    }
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
        "1";
    }

    sourceImageElement =
      source;

    sourceImageOpacity =
      null;

    processing =
      false;
  }

  /* =======================================================
     INSTALL UI
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

    /*
       Именно сюда:

       Настройки
       ├─ Кол. кадров
       └─ Сглаживание радара
    */

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

    /*
       Открытие / закрытие
       настройки.
    */

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

    /*
       Ползунок.

       Во время движения
       НЕ запускаем тяжёлую
       обработку.
    */

    range?.addEventListener(
      "input",
      () => {
        const next =
          Number(
            range.value
          );

        smoothingValue =
          clamp(
            next,
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
           При начале нового
           движения убираем
           старый результат.

           Поэтому старый кадр
           никогда не остаётся
           поверх нового.
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
              "1";
          }
        }

        /*
           0% сразу возвращает
           оригинал.
        */

        if (
          smoothingValue ===
          0
        ) {
          restoreOriginal();

          return;
        }
      }
    );

    /*
       Обработка только после
       отпускания ползунка.
    */

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
     FRAME CHANGE OBSERVER
     ======================================================= */

  function watchGIFFrame() {
    /*
       Когда gif-radar.js меняет
       src исходного ImageOverlay,
       ждём загрузки нового кадра.

       Само сглаживание при этом
       автоматически не запускается:
       оно запускается только после
       отпускания ползунка.
    */

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
               Если кадр переключили,
               старый сглаженный слой
               больше не соответствует
               GIF.
            */

            if (
              smoothingLayer
            ) {
              removeSmoothedLayer();
            }

            target.style.opacity =
              "1";

            /*
               Если пользователь не
               двигает ползунок и
               сглаживание было включено,
               новый кадр не обрабатываем
               автоматически.

               Это специально снижает
               нагрузку на iPhone.
            */
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

  /*
     Запускаем после загрузки
     gif-radar.js и интерфейса.
  */

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
          smoothingValue;
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
