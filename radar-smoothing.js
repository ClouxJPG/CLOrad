/* =========================================================
   CLOrad — RADAR CONTOUR SMOOTHING
   ---------------------------------------------------------
   • Кнопка внутри «Настройки»
   • После «Кол. кадров»
   • 0% = исходный радар
   • 1–100% = сглаживание границ уровней
   • НЕ blur
   • НЕ CSS blur
   • НЕТ квадратных ячеек
   • НЕТ морфологического удаления пикселей
   • НЕТ новых цветовых классов
   • Фон не считается радаром
   • Слоистая облачность не затрагивается
   • iDarkMeteo не затрагивается
   • Обработка только после отпускания шкалы
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
     IDS
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

  const TRACK_ID =
    "cloradSmoothingTrack";

  const FILL_ID =
    "cloradSmoothingFill";

  const THUMB_ID =
    "cloradSmoothingThumb";

  /* =======================================================
     PALETTES
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
     0 и 1:
     слабые/служебные серые области.
     Они не участвуют в сглаживании.

     2–18:
     реальные цветовые уровни радара.
  */

  const RADAR_START_CLASS = 2;

  /*
     Строгий допуск.
     Не даём фону случайно стать радаром.
  */

  const MAX_COLOR_DISTANCE = 24;

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

  let sliderDragging = false;

  let sliderPointerId = null;

  let frameObserver = null;

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

  function colorToCSS(
    color
  ) {
    return (
      "rgb(" +
      color.r +
      "," +
      color.g +
      "," +
      color.b +
      ")"
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

  /* =======================================================
     FIND ONLY RADAR GIF
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
       Берём последний настоящий
       GIF-слой.

       Никогда не ищем
       idarkmeteo-raster.
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

  function loadImage(
    url
  ) {
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
          () => resolve(
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

  function scorePalette(
    imageData,
    palette
  ) {
    const data =
      imageData.data;

    let score = 0;

    /*
       Берём каждый 4-й пиксель.
       Этого достаточно для определения
       используемой палитры и сильно
       уменьшает нагрузку на iPhone.
    */

    for (
      let p = 0;
      p < data.length;
      p += 16
    ) {
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

      let best =
        Infinity;

      for (
        let c =
          RADAR_START_CLASS;
        c < palette.length;
        c++
      ) {
        const color =
          palette[c];

        if (!color) {
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
        MAX_COLOR_DISTANCE
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
      scorePalette(
        imageData,
        target
      );

    const sourceScore =
      scorePalette(
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
     BUILD RADAR CLASS MAP
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

    /*
       -1 = не радар.
    */

    labels.fill(-1);

    const boxes =
      new Array(
        palette.length
      );

    for (
      let i = 0;
      i < palette.length;
      i++
    ) {
      boxes[i] = {
        minX: width,
        minY: height,
        maxX: -1,
        maxY: -1,
        count: 0
      };
    }

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

        let cls;

        if (
          cache.has(key)
        ) {
          cls =
            cache.get(key);
        } else {
          cls = -1;

          let best =
            Infinity;

          for (
            let c =
              RADAR_START_CLASS;
            c < palette.length;
            c++
          ) {
            const color =
              palette[c];

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
              best
            ) {
              best =
                distance;

              cls =
                c;
            }
          }

          if (
            best >
            MAX_COLOR_DISTANCE
          ) {
            cls = -1;
          }

          cache.set(
            key,
            cls
          );
        }

        if (
          cls <
          RADAR_START_CLASS
        ) {
          continue;
        }

        labels[index] =
          cls;

        const box =
          boxes[cls];

        box.count++;

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
      }
    }

    return {
      labels,
      boxes
    };
  }

  /* =======================================================
     CUMULATIVE BOUNDING BOXES
     -------------------------------------------------------
     Для каждого уровня строим область:
     
       class >= level

     Поэтому все контуры автоматически
     вложены друг в друга.
     ======================================================= */

  function buildLevelBoxes(
    boxes,
    paletteLength
  ) {
    const result =
      new Array(
        paletteLength
      );

    let current = {
      minX: Infinity,
      minY: Infinity,
      maxX: -1,
      maxY: -1,
      count: 0
    };

    for (
      let level =
        paletteLength - 1;
      level >= RADAR_START_CLASS;
      level--
    ) {
      const box =
        boxes[level];

      if (
        box &&
        box.count > 0
      ) {
        current = {
          minX:
            Math.min(
              current.minX,
              box.minX
            ),

          minY:
            Math.min(
              current.minY,
              box.minY
            ),

          maxX:
            Math.max(
              current.maxX,
              box.maxX
            ),

          maxY:
            Math.max(
              current.maxY,
              box.maxY
            ),

          count:
            current.count +
            box.count
        };
      }

      result[level] = {
        minX:
          current.minX,

        minY:
          current.minY,

        maxX:
          current.maxX,

        maxY:
          current.maxY,

        count:
          current.count
      };
    }

    return result;
  }

  /* =======================================================
     MARCHING SQUARES
     ======================================================= */

  function buildLevelSegments(
    labels,
    width,
    height,
    level,
    box
  ) {
    const segments =
      [];

    if (
      !box ||
      box.count <= 0 ||
      box.maxX < 0
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

      return (
        labels[
          y * width + x
        ] >= level
      );
    }

    function add(
      a,
      b
    ) {
      segments.push([
        a[0],
        a[1],
        b[0],
        b[1]
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
           Полупиксельные точки.
           Никаких квадратов в результате.
        */

        const top = [
          x + 0.5,
          y
        ];

        const right = [
          x + 1,
          y + 0.5
        ];

        const bottom = [
          x + 0.5,
          y + 1
        ];

        const left = [
          x,
          y + 0.5
        ];

        switch (
          code
        ) {
          case 1:
            add(
              left,
              top
            );
            break;

          case 2:
            add(
              top,
              right
            );
            break;

          case 3:
            add(
              left,
              right
            );
            break;

          case 4:
            add(
              right,
              bottom
            );
            break;

          case 5:
            add(
              left,
              top
            );

            add(
              right,
              bottom
            );
            break;

          case 6:
            add(
              top,
              bottom
            );
            break;

          case 7:
            add(
              left,
              bottom
            );
            break;

          case 8:
            add(
              bottom,
              left
            );
            break;

          case 9:
            add(
              top,
              bottom
            );
            break;

          case 10:
            add(
              top,
              left
            );

            add(
              right,
              bottom
            );
            break;

          case 11:
            add(
              right,
              bottom
            );
            break;

          case 12:
            add(
              right,
              left
            );
            break;

          case 13:
            add(
              top,
              right
            );
            break;

          case 14:
            add(
              top,
              left
            );
            break;
        }
      }
    }

    return segments;
  }

  /* =======================================================
     CHAIN SEGMENTS
     ======================================================= */

  function chainSegments(
    segments
  ) {
    const contours =
      [];

    if (
      !segments.length
    ) {
      return contours;
    }

    const connections =
      new Map();

    function key(
      x,
      y
    ) {
      return (
        Math.round(x * 2) +
        ":" +
        Math.round(y * 2)
      );
    }

    function connect(
      k,
      index
    ) {
      if (
        !connections.has(k)
      ) {
        connections.set(
          k,
          []
        );
      }

      connections
        .get(k)
        .push(index);
    }

    for (
      let i = 0;
      i < segments.length;
      i++
    ) {
      const s =
        segments[i];

      connect(
        key(
          s[0][0],
          s[0][1]
        ),
        i
      );

      connect(
        key(
          s[1][0],
          s[1][1]
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

      let current =
        [
          first[0][0],
          first[0][1]
        ];

      const startPoint =
        [
          current[0],
          current[1]
        ];

      points.push(
        current
      );

      current =
        [
          first[1][0],
          first[1][1]
        ];

      points.push(
        current
      );

      used[start] =
        1;

      let guard = 0;

      while (
        guard++ <
        segments.length + 10
      ) {
        const k =
          key(
            current[0],
            current[1]
          );

        const candidates =
          connections.get(k);

        if (
          !candidates
        ) {
          break;
        }

        let next =
          -1;

        for (
          const index of candidates
        ) {
          if (
            !used[index]
          ) {
            next =
              index;

            break;
          }
        }

        if (
          next < 0
        ) {
          break;
        }

        const segment =
          segments[next];

        used[next] =
          1;

        const a =
          segment[0];

        const b =
          segment[1];

        if (
          Math.abs(
            a[0] -
            current[0]
          ) <
            0.001 &&
          Math.abs(
            a[1] -
            current[1]
          ) <
            0.001
        ) {
          current =
            [
              b[0],
              b[1]
            ];
        } else {
          current =
            [
              a[0],
              a[1]
            ];
        }

        points.push(
          current
        );

        if (
          Math.abs(
            current[0] -
            startPoint[0]
          ) <
            0.001 &&
          Math.abs(
            current[1] -
            startPoint[1]
          ) <
            0.001
        ) {
          break;
        }
      }

      if (
        points.length >= 4
      ) {
        const last =
          points[
            points.length - 1
          ];

        if (
          Math.abs(
            last[0] -
            startPoint[0]
          ) <
            0.01 &&
          Math.abs(
            last[1] -
            startPoint[1]
          ) <
            0.01
        ) {
          points.pop();

          contours.push(
            points
          );
        }
      }
    }

    return contours;
  }

  /* =======================================================
     CONTOUR AREA
     ======================================================= */

  function contourArea(
    points
  ) {
    let area = 0;

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

      area +=
        a[0] * b[1] -
        b[0] * a[1];
    }

    return Math.abs(
      area
    ) / 2;
  }

  /* =======================================================
     CONTOUR SIMPLIFICATION
     ======================================================= */

  function simplifyContour(
    points,
    tolerance
  ) {
    if (
      points.length < 8 ||
      tolerance <= 0
    ) {
      return points.slice();
    }

    const result =
      [];

    /*
       Сначала удаляем только
       абсолютно близкие точки.
    */

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

      const dx =
        b[0] - a[0];

      const dy =
        b[1] - a[1];

      if (
        Math.hypot(
          dx,
          dy
        ) >= tolerance
      ) {
        result.push(
          a
        );
      }
    }

    return result;
  }

  /* =======================================================
     CHAIKIN
     -------------------------------------------------------
     Не рисует квадраты.
     Получается непрерывная закрытая
     кривая.
     ======================================================= */

  function chaikin(
    points,
    amount
  ) {
    if (
      points.length < 4
    ) {
      return points.slice();
    }

    const result =
      [];

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

  /* =======================================================
     SMOOTH CONTOUR
     ======================================================= */

  function smoothContour(
    points,
    strength
  ) {
    if (
      points.length < 4
    ) {
      return points.slice();
    }

    const s =
      clamp(
        strength,
        0,
        100
      ) / 100;

    /*
       Чем сильнее сглаживание,
       тем меньше остаётся исходной
       пиксельной ломаности.

       Но сама область не
       морфологически расширяется
       и не сжимается.
    */

    const tolerance =
      0.15 +
      s * 0.8;

    let result =
      simplifyContour(
        points,
        tolerance
      );

    if (
      result.length < 4
    ) {
      result =
        points.slice();
    }

    /*
       5% = очень мягкое
       100% = сильное.
    */

    let iterations = 1;

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

    const amount =
      0.025 +
      s * 0.10;

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
     DRAW SMOOTH LEVEL
     ======================================================= */

  function drawSmoothLevel(
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

      /*
         Очень маленькие области
         всё равно рисуем.
         Никакого удаления пикселей.
      */

      const first =
        contour[0];

      ctx.moveTo(
        first[0],
        first[1]
      );

      /*
         Квадратичная интерполяция
         через середины сегментов.

         Поэтому итоговая линия
         получается непрерывной,
         без видимых ступеней.
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

        const midX =
          (
            current[0] +
            next[0]
          ) / 2;

        const midY =
          (
            current[1] +
            next[1]
          ) / 2;

        ctx.quadraticCurveTo(
          current[0],
          current[1],
          midX,
          midY
        );
      }

      ctx.closePath();
    }

    /*
       Только существующий цвет
       текущей палитры.
    */

    ctx.fillStyle =
      colorToCSS(
        color
      );

    ctx.globalAlpha =
      1;

    ctx.fill(
      "evenodd"
    );

    ctx.restore();
  }

  /* =======================================================
     REMOVE ONLY OUR LAYER
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
     RESTORE ORIGINAL GIF
     -------------------------------------------------------
     НИКАКИХ activeLayer.
     НИКАКИХ iDarkMeteo.
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

      source.dataset.cloradSmoothing =
        "0";

      sourceImageElement =
        source;
    }

    processing =
      false;
  }

  /* =======================================================
     INSTALL SMOOTH LAYER
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

    /*
       ВАЖНО:

       iDarkMeteo activeLayer находится
       на zIndex 5.

       GIF radar — zIndex 6.

       Сглаживание — zIndex 6.

       Мы не создаём новый слой поверх
       облачности с неправильным порядком.
    */

    const layer =
      L.imageOverlay(
        dataURL,
        GIF_BOUNDS,
        {
          opacity: 1,
          interactive: false,
          zIndex: 6,
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
       Скрываем ТОЛЬКО DOM-картинку
       GIF-радара.

       activeLayer / облачность
       вообще не трогаются.
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

      source.dataset.cloradSmoothing =
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
      processing =
        false;

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
         Читаем исходный GIF.
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
         Получаем дискретное поле
         радарных уровней.
      */

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
         Считаем реальные радарные
         пиксели.
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
          RADAR_START_CLASS
        ) {
          radarPixels++;
        }
      }

      /*
         Защита от пустого/неверного
         кадра.
      */

      if (
        radarPixels < 3
      ) {
        return;
      }

      /*
         Полностью очищаем canvas.

         Поэтому фон GIF,
         серые области,
         карта и прочее

         НЕ ПОПАДАЮТ
         в результат.
      */

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      const levelBoxes =
        buildLevelBoxes(
          mapData.boxes,
          palette.length
        );

      /*
         ====================================================
         ГЛАВНОЕ ИЗМЕНЕНИЕ

         Мы НЕ сглаживаем отдельные цвета.

         Вместо этого строим:

           уровень 2+
           уровень 3+
           уровень 4+
           уровень 5+
           ...

         Получаются вложенные области.

         Это именно то, что нужно для вида:

              ┌─────────────┐
              │   зелёный   │
              │  ┌───────┐  │
              │  │ жёлтый│  │
              │  │ ┌───┐ │  │
              │  │ │крас│ │  │
              │  │ └───┘ │  │
              │  └───────┘  │
              └─────────────┘

         без квадратных пикселей.
         ====================================================
      */

      for (
        let level =
          RADAR_START_CLASS;
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

        const box =
          levelBoxes[level];

        if (
          !box ||
          box.count <= 0
        ) {
          continue;
        }

        const segments =
          buildLevelSegments(
            mapData.labels,
            width,
            height,
            level,
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

        const smoothed =
          [];

        for (
          const contour of contours
        ) {
          if (
            contour.length < 3
          ) {
            continue;
          }

          /*
             Не отбрасываем маленькие
             области.

             Это важно для условия
             "пиксели не пропадают".
          */

          const area =
            contourArea(
              contour
            );

          /*
             Очень маленькие контуры
             не прогоняем через сильную
             геометрическую деформацию.
          */

          if (
            area < 2
          ) {
            smoothed.push(
              contour
            );

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

        const color =
          palette[level];

        if (
          !color
        ) {
          continue;
        }

        drawSmoothLevel(
          ctx,
          smoothed,
          color
        );
      }

      if (
        token !==
        processToken
      ) {
        return;
      }

      /*
         Готовый прозрачный PNG.

         Вне радарных областей
         alpha = 0.
      */

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
     CUSTOM SLIDER
     -------------------------------------------------------
     Нажать рядом с линией = ничего.
     Двигается только сама линия/ползунок.
     ======================================================= */

  function updateSliderVisual(
    value
  ) {
    const fill =
      $(FILL_ID);

    const thumb =
      $(THUMB_ID);

    const valueElement =
      $(VALUE_ID);

    const v =
      clamp(
        Number(value) || 0,
        0,
        100
      );

    if (
      fill
    ) {
      fill.style.width =
        v + "%";
    }

    if (
      thumb
    ) {
      thumb.style.left =
        v + "%";
    }

    if (
      valueElement
    ) {
      valueElement.textContent =
        v + "%";
    }
  }

  function sliderValueFromPointer(
    event
  ) {
    const track =
      $(TRACK_ID);

    if (
      !track
    ) {
      return smoothingValue;
    }

    const rect =
      track.getBoundingClientRect();

    if (
      rect.width <= 0
    ) {
      return smoothingValue;
    }

    const x =
      clamp(
        event.clientX -
          rect.left,
        0,
        rect.width
      );

    return Math.round(
      x /
        rect.width *
        100
    );
  }

  function beginSlider(
    event
  ) {
    const track =
      $(TRACK_ID);

    if (
      !track
    ) {
      return;
    }

    /*
       Только нажатие непосредственно
       на track или thumb.
    */

    if (
      event.target !== track &&
      event.target.id !==
        THUMB_ID &&
      event.target.id !==
        FILL_ID
    ) {
      return;
    }

    sliderDragging =
      true;

    sliderPointerId =
      event.pointerId;

    try {
      track.setPointerCapture(
        event.pointerId
      );
    } catch {}

    setSliderFromEvent(
      event
    );

    event.preventDefault();
    event.stopPropagation();
  }

  function moveSlider(
    event
  ) {
    if (
      !sliderDragging
    ) {
      return;
    }

    if (
      sliderPointerId !== null &&
      event.pointerId !==
        sliderPointerId
    ) {
      return;
    }

    setSliderFromEvent(
      event
    );

    event.preventDefault();
    event.stopPropagation();
  }

  function endSlider(
    event
  ) {
    if (
      !sliderDragging
    ) {
      return;
    }

    if (
      sliderPointerId !== null &&
      event.pointerId !==
        sliderPointerId
    ) {
      return;
    }

    sliderDragging =
      false;

    sliderPointerId =
      null;

    clearTimeout(
      releaseTimer
    );

    /*
       Только здесь начинается
       тяжёлая обработка.
    */

    releaseTimer =
      setTimeout(
        () => {
          processCurrentFrame(
            smoothingValue
          );
        },
        180
      );

    event.preventDefault();
    event.stopPropagation();
  }

  function setSliderFromEvent(
    event
  ) {
    const value =
      sliderValueFromPointer(
        event
      );

    smoothingValue =
      value;

    updateSliderVisual(
      value
    );

    /*
       Во время движения
       не считаем сглаживание.

       Только убираем старый
       результат, если он есть.
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
      value === 0
    ) {
      restoreOriginal();
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
            margin-bottom:12px;
          "
        >
          Сглаживание контуров
        </div>

        <div
          id="${TRACK_ID}"
          style="
            position:relative;
            width:100%;
            height:24px;
            touch-action:none;
            user-select:none;
            -webkit-user-select:none;
          "
        >
          <div
            style="
              position:absolute;
              left:0;
              right:0;
              top:10px;
              height:4px;
              border-radius:999px;
              background:#39434a;
              pointer-events:none;
            "
          ></div>

          <div
            id="${FILL_ID}"
            style="
              position:absolute;
              left:0;
              top:10px;
              width:0%;
              height:4px;
              border-radius:999px;
              background:#53e39b;
              pointer-events:none;
            "
          ></div>

          <div
            id="${THUMB_ID}"
            style="
              position:absolute;
              left:0%;
              top:4px;
              width:16px;
              height:16px;
              margin-left:-8px;
              border-radius:50%;
              background:#ffffff;
              border:2px solid #53e39b;
              box-sizing:border-box;
              pointer-events:none;
              box-shadow:0 0 0 1px rgba(0,0,0,.25);
            "
          ></div>
        </div>

        <div
          id="${VALUE_ID}"
          style="
            margin-top:5px;
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
      $(BUTTON_ID);

    const track =
      $(TRACK_ID);

    /*
       Открытие/закрытие.
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
       Своя шкала.

       Нажатие по остальному
       settingBody сюда вообще
       не приходит.
    */

    track?.addEventListener(
      "pointerdown",
      beginSlider
    );

    track?.addEventListener(
      "pointermove",
      moveSlider
    );

    track?.addEventListener(
      "pointerup",
      endSlider
    );

    track?.addEventListener(
      "pointercancel",
      endSlider
    );

    updateSliderVisual(
      0
    );

    installed =
      true;
  }

  /* =======================================================
     WATCH GIF FRAME
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
               Новый GIF-кадр.

               Удаляем ТОЛЬКО наше
               сглаживание.

               iDarkMeteo activeLayer
               здесь вообще не вызывается.
            */

            processToken++;

            removeSmoothedLayer();

            processing =
              false;

            target.style.opacity =
              "1";

            target.dataset.cloradSmoothing =
              "0";

            sourceImageElement =
              target;

            sourceOriginalOpacity =
              "1";

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

    setValue(
      value
    ) {
      smoothingValue =
        clamp(
          Number(value) || 0,
          0,
          100
        );

      updateSliderVisual(
        smoothingValue
      );

      if (
        smoothingValue ===
        0
      ) {
        restoreOriginal();
      } else {
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
    },

    restore() {
      smoothingValue =
        0;

      updateSliderVisual(
        0
      );

      restoreOriginal();
    }
  };

})();
