/* =========================================================
   CLOrad — RADAR CONTOUR SMOOTHING
   ---------------------------------------------------------
   • Кнопка находится внутри «Настройки»
   • Располагается после «Кол. кадров»
   • 0% = оригинальный радар
   • 1–100% = сглаживание контуров
   • НЕТ CSS blur
   • НЕТ размытия цветов
   • НЕТ новых цветов
   • НЕТ квадратных / скруглённых квадратов
   • Исходные радарные пиксели не удаляются фильтрами
   • Сглаживаются границы уровней отражаемости
   • Фон GIF остаётся прозрачным
   • GIF остаётся привязанным к географическим bounds
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
     PALETTE
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
     0 и 1 — серые служебные/фоновые значения.

     Реальный цветной радар начинается с 2.
  */

  const RADAR_START =
    2;

  /*
     Очень строгая классификация.

     Это специально не 30–50:
     серый фон никогда не должен
     превращаться в радар.
  */

  const MAX_COLOR_DISTANCE =
    24;

  /* =======================================================
     STATE
     ======================================================= */

  let smoothingValue =
    0;

  let smoothingLayer =
    null;

  let processing =
    false;

  let processToken =
    0;

  let releaseTimer =
    null;

  let installed =
    false;

  let observerStarted =
    false;

  let sourceImageElement =
    null;

  let sourceOriginalOpacity =
    "1";

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
            .map(
              hexToRGB
            );
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

    /*
       Берём последний реальный
       GIF-слой, а не smoothing-layer.
    */

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
     RESTORE ORIGINAL GIF
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

    sourceImageElement =
      source;

    processing =
      false;
  }

  /* =======================================================
     READ CURRENT GIF DIRECTLY
     -------------------------------------------------------
     НЕ создаём новую загрузку Image().
     Работаем с уже отображаемым GIF
     кадром Leaflet.

     Это важно:
     smoothing никогда не должен
     заставлять GIF исчезать.
     ======================================================= */

  function readCurrentFrame() {
    const source =
      getSourceImage();

    if (
      !source
    ) {
      return null;
    }

    if (
      !source.complete ||
      !source.naturalWidth ||
      !source.naturalHeight
    ) {
      return null;
    }

    const width =
      source.naturalWidth;

    const height =
      source.naturalHeight;

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
      return null;
    }

    /*
       Рисуем именно текущий
       отображаемый кадр.
    */

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    ctx.drawImage(
      source,
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
        "CLOrad smoothing:",
        error
      );

      return null;
    }

    return {
      canvas,
      ctx,
      imageData,
      width,
      height,
      source
    };
  }

  /* =======================================================
     CLASSIFICATION
     -------------------------------------------------------
     ВАЖНО:

     Мы НЕ удаляем отдельные пиксели.
     Мы НЕ делаем erosion/dilation.
     Мы НЕ выбрасываем маленькие области.

     Каждый распознанный радарный пиксель
     остаётся в исходной карте классов.
     ======================================================= */

  function buildScalarField(
    imageData,
    width,
    height,
    palette
  ) {
    const data =
      imageData.data;

    const total =
      width * height;

    /*
       Int8:
       -1 = фон
        2..18 = реальный уровень
    */

    const field =
      new Int8Array(
        total
      );

    field.fill(-1);

    const colorCache =
      new Map();

    let radarPixels =
      0;

    /*
       Для каждого пикселя
       ищем ближайший цвет
       только среди 2..18.
    */

    for (
      let i = 0;
      i < total;
      i++
    ) {
      const p =
        i * 4;

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
        colorCache.has(key)
      ) {
        const cached =
          colorCache.get(key);

        field[i] =
          cached;

        if (
          cached >=
          RADAR_START
        ) {
          radarPixels++;
        }

        continue;
      }

      let best =
        -1;

      let bestDistance =
        Infinity;

      for (
        let c =
          RADAR_START;
        c <
          palette.length;
        c++
      ) {
        const color =
          palette[c];

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

          best =
            c;
        }
      }

      if (
        best <
          RADAR_START ||
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

      field[i] =
        best;

      if (
        best >=
        RADAR_START
      ) {
        radarPixels++;
      }
    }

    return {
      field,
      radarPixels
    };
  }

  /* =======================================================
     BINARY MASK FOR ISOLINE
     -------------------------------------------------------
     threshold = 2.5 ... 17.5

     Например:

     threshold 2.5:
       все классы 2..18

     threshold 5.5:
       все классы 6..18

     threshold 10.5:
       все классы 11..18

     Поэтому контуры автоматически
     вложены друг в друга.

     Это принципиально отличается
     от сглаживания каждого цвета
     отдельно.
     ======================================================= */

  function buildThresholdMask(
    field,
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
      const value =
        field[i];

      if (
        value >=
        threshold
      ) {
        mask[i] =
          1;
      }
    }

    return mask;
  }

  /* =======================================================
     CONTOUR EXTRACTION
     ======================================================= */

  function contourSegments(
    mask,
    width,
    height
  ) {
    const segments =
      [];

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

    /*
       Координаты идут в пикселях.

       Пересечения границы находятся
       строго посередине между пикселями.
    */

    for (
      let y = 0;
      y <
        height - 1;
      y++
    ) {
      for (
        let x = 0;
        x <
          width - 1;
        x++
      ) {
        const tl =
          inside(x, y)
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
     CHAIN CONTOURS
     ======================================================= */

  function chainContours(
    segments
  ) {
    const contours =
      [];

    if (
      !segments.length
    ) {
      return contours;
    }

    const map =
      new Map();

    function key(
      x,
      y
    ) {
      return (
        Math.round(
          x * 2
        ) +
        ":" +
        Math.round(
          y * 2
        )
      );
    }

    function connect(
      k,
      index
    ) {
      let list =
        map.get(k);

      if (
        !list
      ) {
        list =
          [];

        map.set(
          k,
          list
        );
      }

      list.push(
        index
      );
    }

    for (
      let i = 0;
      i <
        segments.length;
      i++
    ) {
      const s =
        segments[i];

      connect(
        key(
          s[0],
          s[1]
        ),
        i
      );

      connect(
        key(
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
      let start =
        0;
      start <
        segments.length;
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

      let sx =
        first[0];

      let sy =
        first[1];

      let cx =
        first[0];

      let cy =
        first[1];

      used[start] =
        1;

      points.push([
        cx,
        cy
      ]);

      let nx =
        first[2];

      let ny =
        first[3];

      points.push([
        nx,
        ny
      ]);

      cx =
        nx;

      cy =
        ny;

      const startKey =
        key(
          sx,
          sy
        );

      let guard =
        0;

      while (
        guard++ <
        segments.length + 50
      ) {
        const currentKey =
          key(
            cx,
            cy
          );

        if (
          currentKey ===
          startKey
        ) {
          break;
        }

        const list =
          map.get(
            currentKey
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
          i <
            list.length;
          i++
        ) {
          if (
            !used[
              list[i]
            ]
          ) {
            next =
              list[i];

            break;
          }
        }

        if (
          next <
          0
        ) {
          break;
        }

        used[next] =
          1;

        const s =
          segments[next];

        const aKey =
          key(
            s[0],
            s[1]
          );

        if (
          aKey ===
          currentKey
        ) {
          cx =
            s[2];

          cy =
            s[3];
        } else {
          cx =
            s[0];

          cy =
            s[1];
        }

        points.push([
          cx,
          cy
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

        const distance =
          Math.hypot(
            firstPoint[0] -
              lastPoint[0],
            firstPoint[1] -
              lastPoint[1]
          );

        /*
           Только замкнутые
           полноценные контуры.
        */

        if (
          distance <=
          1.1
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
     CONTOUR SIMPLIFICATION
     -------------------------------------------------------
     Убираем избыточные точки
     перед кривой.

     Это НЕ удаление радарных пикселей.
     Меняется только геометрия
     границы.
     ======================================================= */

  function simplifyContour(
    points,
    tolerance
  ) {
    if (
      points.length < 8
    ) {
      return points;
    }

    const result =
      [];

    const n =
      points.length;

    /*
       Радиальное прореживание.
       Очень маленькое, чтобы
       мелкие элементы не исчезали.
    */

    let previous =
      points[0];

    result.push(
      previous
    );

    for (
      let i = 1;
      i < n;
      i++
    ) {
      const point =
        points[i];

      const distance =
        Math.hypot(
          point[0] -
            previous[0],
          point[1] -
            previous[1]
        );

      if (
        distance >=
        tolerance
      ) {
        result.push(
          point
        );

        previous =
          point;
      }
    }

    if (
      result.length >=
      3
    ) {
      return result;
    }

    return points;
  }

  /* =======================================================
     CLOSED CATMULL-ROM
     -------------------------------------------------------
     Получаем плавный контур,
     а не последовательность
     скруглённых квадратов.

     Кривая проходит через
     контрольные точки.
     ======================================================= */

  function drawSmoothClosedPath(
    ctx,
    points,
    strength
  ) {
    const count =
      points.length;

    if (
      count < 4
    ) {
      return;
    }

    /*
       Сила определяет,
       насколько далеко мы
       отходим от исходной
       ступенчатой границы.

       0% здесь не вызывается.
    */

    const s =
      clamp(
        strength,
        0,
        100
      ) / 100;

    /*
       5% — почти оригинальная
       форма.

       100% — заметно более
       плавная форма.
    */

    const tension =
      0.10 +
      s * 0.32;

    ctx.moveTo(
      points[0][0],
      points[0][1]
    );

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const p0 =
        points[
          (i - 1 + count) %
            count
        ];

      const p1 =
        points[i];

      const p2 =
        points[
          (i + 1) %
            count
        ];

      const p3 =
        points[
          (i + 2) %
            count
        ];

      /*
         Контрольные точки
         Catmull-Rom → Bezier.
      */

      let c1x =
        p1[0] +
        (p2[0] -
          p0[0]) *
          tension;

      let c1y =
        p1[1] +
        (p2[1] -
          p0[1]) *
          tension;

      let c2x =
        p2[0] -
        (p3[0] -
          p1[0]) *
          tension;

      let c2y =
        p2[1] -
        (p3[1] -
          p1[1]) *
          tension;

      /*
         При 100% не позволяем
         контрольным точкам
         улететь слишком далеко.
      */

      const maxMove =
        3.0 +
        s * 7.0;

      c1x =
        clamp(
          c1x,
          p1[0] -
            maxMove,
          p1[0] +
            maxMove
        );

      c1y =
        clamp(
          c1y,
          p1[1] -
            maxMove,
          p1[1] +
            maxMove
        );

      c2x =
        clamp(
          c2x,
          p2[0] -
            maxMove,
          p2[0] +
            maxMove
        );

      c2y =
        clamp(
          c2y,
          p2[1] -
            maxMove,
          p2[1] +
            maxMove
        );

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
     DRAW THRESHOLD
     ======================================================= */

  function drawThreshold(
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

    ctx.beginPath();

    for (
      const contour of contours
    ) {
      if (
        contour.length <
        4
      ) {
        continue;
      }

      const simplified =
        simplifyContour(
          contour,
          0.55
        );

      if (
        simplified.length <
        4
      ) {
        continue;
      }

      drawSmoothClosedPath(
        ctx,
        simplified,
        strength
      );
    }

    ctx.fillStyle =
      color;

    ctx.globalAlpha =
      1;

    ctx.fill(
      "evenodd"
    );
  }

  /* =======================================================
     PROCESS
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
      /*
         Не запускаем второй
         тяжёлый процесс параллельно.
      */

      return;
    }

    const frame =
      readCurrentFrame();

    if (
      !frame
    ) {
      processing =
        false;

      setTimeout(
        () => {
          if (
            smoothingValue > 0
          ) {
            processCurrentFrame(
              smoothingValue
            );
          }
        },
        180
      );

      return;
    }

    processing =
      true;

    try {
      const {
        imageData,
        width,
        height,
        source
      } =
        frame;

      if (
        token !==
        processToken
      ) {
        return;
      }

      const palette =
        getCurrentPalette();

      if (
        !palette ||
        palette.length <
          19
      ) {
        return;
      }

      /*
         Получаем единое поле
         уровней отражаемости.
      */

      const scalar =
        buildScalarField(
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
         Если радарных пикселей
         нет — ничего не рисуем.

         Оригинальный GIF
         остаётся видимым.
      */

      if (
        scalar.radarPixels <
        10
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
          "2d"
        );

      if (
        !ctx
      ) {
        return;
      }

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      /*
         ====================================================
         ГЛАВНОЕ:

         Мы не рисуем каждый пиксель
         как квадрат.

         Мы строим вложенные
         изолинии:

           2.5
           3.5
           4.5
           ...
           17.5

         и заполняем пространства
         между ними цветами.

         Поэтому результат:
         - без квадратов
         - без пиксельной сетки
         - без blur
         - без RGB-интерполяции
         - с реальными цветами палитры.
         ====================================================
      */

      /*
         Сначала рисуем самый внешний
         уровень, затем более сильные
         уровни поверх него.

         Каждый следующий уровень
         является подмножеством
         предыдущего.
      */

      for (
        let level =
          RADAR_START;
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

        /*
           Порог между текущим
           и следующим классом.

           Для level=2:
             2.5

           Для level=3:
             3.5
        */

        const threshold =
          level -
          0.5;

        /*
           Для класса 2 и выше
           область строится из
           всех более сильных
           значений.

           Это сохраняет
           вложенность контуров.
        */

        const mask =
          buildThresholdMask(
            scalar.field,
            width,
            height,
            threshold
          );

        const segments =
          contourSegments(
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
          chainContours(
            segments
          );

        if (
          !contours.length
        ) {
          continue;
        }

        /*
           Цвет уровня.

           Никаких новых цветов.
        */

        const color =
          palette[level];

        if (
          !color
        ) {
          continue;
        }

        const cssColor =
          `rgb(${color.r},${color.g},${color.b})`;

        drawThreshold(
          ctx,
          contours,
          cssColor,
          strength
        );
      }

      if (
        token !==
        processToken
      ) {
        return;
      }

      /*
         Получаем PNG только
         с прозрачным фоном.
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

      /*
         Устанавливаем слой.
         Только после полной
         готовности результата.
      */

      installSmoothedLayer(
        dataURL,
        source
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
     INSTALL SMOOTHED LAYER
     ======================================================= */

  function installSmoothedLayer(
    dataURL,
    source
  ) {
    if (
      !window.map
    ) {
      return;
    }

    /*
       Сначала создаём новый
       полностью готовый слой.
    */

    const newLayer =
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

    newLayer.addTo(
      window.map
    );

    /*
       Теперь можно убрать
       предыдущий smoothing-layer.
    */

    if (
      smoothingLayer &&
      window.map.hasLayer(
        smoothingLayer
      )
    ) {
      window.map.removeLayer(
        smoothingLayer
      );
    }

    smoothingLayer =
      newLayer;

    /*
       Исходный GIF скрываем
       только после того,
       как сглаженный слой
       уже добавлен.

       Поэтому GIF не исчезает
       во время обработки.
    */

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
      typeof newLayer.bringToFront ===
      "function"
    ) {
      newLayer.bringToFront();
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
        style="
          overflow:visible;
          position:relative;
        "
      >
        <div
          style="
            font-size:12px;
            color:#9da7ad;
            margin-bottom:8px;
          "
        >
          Сглаживание контуров
        </div>

        <div
          id="cloradSmoothingSliderWrap"
          style="
            width:100%;
            height:24px;
            position:relative;
            display:flex;
            align-items:center;
            touch-action:none;
            overflow:visible;
          "
        >
          <input
            id="${RANGE_ID}"
            type="range"
            min="0"
            max="100"
            step="1"
            value="0"
            aria-label="Сглаживание радара"
            style="
              display:block;
              width:100%;
              height:18px;
              min-height:18px;
              max-height:18px;
              margin:0;
              padding:0;
              accent-color:#53e39b;
              cursor:pointer;
              touch-action:none;
            "
          >
        </div>

        <div
          id="${VALUE_ID}"
          style="
            margin-top:6px;
            font-size:13px;
            color:#dfe4e7;
            text-align:right;
            line-height:16px;
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

    const panel =
      document.getElementById(
        PANEL_ID
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
       BUTTON
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
       PANEL EVENTS
       -----------------------------------------------------
       Не даём кликам внутри
       ползунка закрывать настройки.
       ===================================================== */

    panel?.addEventListener(
      "click",
      event => {
        event.stopPropagation();
      }
    );

    panel?.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      }
    );

    panel?.addEventListener(
      "touchstart",
      event => {
        event.stopPropagation();
      },
      {
        passive:false
      }
    );

    /* =====================================================
       SLIDER INPUT
       -----------------------------------------------------
       Здесь НЕТ обработки радара.

       Только число.
       ===================================================== */

    range?.addEventListener(
      "input",
      event => {
        event.stopPropagation();

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
      }
    );

    /*
       Не даём событиям
       range уходить выше.
    */

    range?.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      }
    );

    range?.addEventListener(
      "pointerup",
      event => {
        event.stopPropagation();
      }
    );

    range?.addEventListener(
      "touchstart",
      event => {
        event.stopPropagation();
      },
      {
        passive:false
      }
    );

    range?.addEventListener(
      "touchend",
      event => {
        event.stopPropagation();
      },
      {
        passive:false
      }
    );

    /* =====================================================
       RELEASE
       ===================================================== */

    function scheduleRelease(
      event
    ) {
      event?.stopPropagation();

      clearTimeout(
        releaseTimer
      );

      releaseTimer =
        setTimeout(
          () => {
            if (
              smoothingValue <=
              0
            ) {
              restoreOriginal();

              return;
            }

            processCurrentFrame(
              smoothingValue
            );
          },
          220
        );
    }

    range?.addEventListener(
      "pointerup",
      scheduleRelease
    );

    range?.addEventListener(
      "touchend",
      scheduleRelease,
      {
        passive:false
      }
    );

    range?.addEventListener(
      "mouseup",
      scheduleRelease
    );

    /*
       Если палец ушёл за пределы
       ползунка — всё равно считаем
       это отпусканием.
    */

    range?.addEventListener(
      "pointercancel",
      scheduleRelease
    );

    installed =
      true;
  }

  /* =======================================================
     FRAME WATCHER
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

            /*
               Новый GIF-кадр.

               Старый smoothing-layer
               больше не соответствует
               изображению.
            */

            processToken++;

            removeSmoothedLayer();

            processing =
              false;

            /*
               Новый кадр сначала
               показывается нормально.
            */

            target.style.opacity =
              "1";

            sourceImageElement =
              target;

            sourceOriginalOpacity =
              "1";

            /*
               Если smoothing включён,
               строим его для нового
               кадра автоматически.
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
                  160
                );
            }
          }
        }
      );

    observer.observe(
      document.body,
      {
        subtree:true,
        attributes:true,
        attributeFilter:[
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
        once:true
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
        smoothingValue <=
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
