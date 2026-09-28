/* =========================================================
   CLOrad — REAL RADAR CONTOUR SMOOTHING
   ---------------------------------------------------------
   • Настройка внутри «Настройки»
   • Сразу после «Кол. кадров»
   • Без иконки
   • Без CSS blur
   • Без размытия изображения
   • Без интерполяции цветов
   • Без рисования квадратных радарных пикселей
   • Радарные классы превращаются в замкнутые контуры
   • Контуры сглаживаются кривыми
   • Используются только существующие цвета радара
   • 0% = исходный кадр
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const CONFIG = {
    min: 0,
    max: 100,
    step: 5,
    initial: 0,

    /*
      При больших значениях можно уменьшить
      внутреннюю сетку обработки.
    */
    maxDownsample: 2,

    /*
      Количество проходов сглаживания контура.
    */
    maxSmoothPasses: 3,

    /*
      Максимальная степень изменения контура.
    */
    maxMorphRadius: 5,

    cacheLimit: 4,

    processDelay: 70
  };

  /* =======================================================
     STATE
     ======================================================= */

  let strength = CONFIG.initial;

  let currentLayer = null;
  let currentSource = null;
  let currentProcessedURL = null;

  let processing = false;
  let processTimer = null;
  let processToken = 0;

  let cache = new Map();
  let cacheOrder = [];

  let uiReady = false;
  let leafletReady = false;
  let mapReady = false;

  let originalOnAdd = null;
  let originalSetUrl = null;

  /* =======================================================
     HELPERS
     ======================================================= */

  const $ = id =>
    document.getElementById(id);

  function clamp(v, min, max) {
    return Math.max(
      min,
      Math.min(max, v)
    );
  }

  /* =======================================================
     STYLE
     ======================================================= */

  function installStyle() {
    if ($("clorad-smoothing-style")) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "clorad-smoothing-style";

    style.textContent = `
      #cloradSmoothingSetting {
        width: 100%;
      }

      #cloradSmoothingButton {
        width: 100%;
        min-height: 44px;

        display: flex;
        align-items: center;
        justify-content: space-between;

        padding: 0 14px;

        border: 0;
        outline: 0;

        background: transparent;
        color: inherit;

        font: inherit;
        text-align: left;

        cursor: pointer;

        -webkit-tap-highlight-color:
          transparent;
      }

      #cloradSmoothingButton:active {
        opacity: .7;
      }

      #cloradSmoothingArrow {
        font-size: 22px;
        line-height: 1;

        opacity: .55;

        transition:
          transform .16s ease;
      }

      #cloradSmoothingSetting.open
      #cloradSmoothingArrow {
        transform:
          rotate(90deg);
      }

      #cloradSmoothingPanel {
        display: none;
        padding: 0 14px 13px;
      }

      #cloradSmoothingSetting.open
      #cloradSmoothingPanel {
        display: block;
      }

      #cloradSmoothingValue {
        display: flex;
        align-items: center;
        justify-content: space-between;

        margin-bottom: 7px;

        font-size: 12px;

        color:
          rgba(255,255,255,.55);
      }

      #cloradSmoothingValueNumber {
        color:
          rgba(255,255,255,.88);

        font-weight: 600;
      }

      #cloradSmoothingRange {
        display: block;

        width: 100%;
        height: 24px;

        margin: 0;
        padding: 0;

        appearance: none;
        -webkit-appearance: none;

        background:
          transparent;

        cursor: pointer;
      }

      #cloradSmoothingRange::-webkit-slider-runnable-track {
        height: 4px;

        border-radius: 4px;

        background:
          rgba(255,255,255,.16);
      }

      #cloradSmoothingRange::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;

        width: 18px;
        height: 18px;

        margin-top: -7px;

        border: 0;
        border-radius: 50%;

        background: #fff;

        box-shadow:
          0 1px 5px rgba(0,0,0,.35);
      }

      #cloradSmoothingRange::-moz-range-track {
        height: 4px;

        border-radius: 4px;

        background:
          rgba(255,255,255,.16);
      }

      #cloradSmoothingRange::-moz-range-thumb {
        width: 18px;
        height: 18px;

        border: 0;
        border-radius: 50%;

        background: #fff;
      }

      #cloradSmoothingStatus {
        min-height: 15px;

        margin-top: 5px;

        font-size: 11px;

        color:
          rgba(255,255,255,.40);
      }

      body.light
      #cloradSmoothingValue {
        color:
          rgba(0,0,0,.50);
      }

      body.light
      #cloradSmoothingValueNumber {
        color:
          rgba(0,0,0,.78);
      }

      body.light
      #cloradSmoothingStatus {
        color:
          rgba(0,0,0,.40);
      }

      body.light
      #cloradSmoothingRange::-webkit-slider-runnable-track {
        background:
          rgba(0,0,0,.14);
      }

      body.light
      #cloradSmoothingRange::-moz-range-track {
        background:
          rgba(0,0,0,.14);
      }
    `;

    document.head.appendChild(style);
  }

  /* =======================================================
     SETTINGS UI
     ======================================================= */

  function createUI() {
    installStyle();

    const settings =
      $("settings");

    if (!settings) {
      return false;
    }

    if ($("cloradSmoothingSetting")) {
      uiReady = true;
      return true;
    }

    const setting =
      document.createElement("div");

    setting.className =
      "setting";

    setting.id =
      "cloradSmoothingSetting";

    setting.innerHTML = `
      <button
        id="cloradSmoothingButton"
        type="button"
        aria-expanded="false"
      >
        <span>
          Сглаживание радара
        </span>

        <span id="cloradSmoothingArrow">
          ›
        </span>
      </button>

      <div
        id="cloradSmoothingPanel"
        class="settingBody"
      >
        <div id="cloradSmoothingValue">
          <span>
            Сила сглаживания
          </span>

          <strong
            id="cloradSmoothingValueNumber"
          >
            0%
          </strong>
        </div>

        <input
          id="cloradSmoothingRange"
          type="range"
          min="0"
          max="100"
          step="5"
          value="0"
        >

        <div
          id="cloradSmoothingStatus"
        ></div>
      </div>
    `;

    /*
      Самое важное:
      настройка находится именно после
      существующего «Кол. кадров».
    */

    const framesSetting =
      $("framesSetting");

    if (framesSetting) {
      framesSetting.after(
        setting
      );
    } else {
      settings.appendChild(
        setting
      );
    }

    const button =
      $("cloradSmoothingButton");

    const range =
      $("cloradSmoothingRange");

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        const open =
          setting.classList.contains(
            "open"
          );

        document
          .querySelectorAll(
            ".setting.open"
          )
          .forEach(other => {
            if (other !== setting) {
              other.classList.remove(
                "open"
              );
            }
          });

        setting.classList.toggle(
          "open",
          !open
        );

        button.setAttribute(
          "aria-expanded",
          String(!open)
        );
      }
    );

    range.addEventListener(
      "input",
      () => {
        strength =
          Number(range.value) || 0;

        updateValue();

        if (processTimer) {
          clearTimeout(
            processTimer
          );

          processTimer = null;
        }

        if (strength === 0) {
          setStatus("");
        } else {
          setStatus(
            "Отпустите ползунок для применения"
          );
        }
      }
    );

    range.addEventListener(
      "change",
      () => {
        strength =
          Number(range.value) || 0;

        updateValue();

        if (processTimer) {
          clearTimeout(
            processTimer
          );
        }

        processTimer =
          setTimeout(
            () => {
              processTimer = null;
              processCurrent();
            },
            CONFIG.processDelay
          );
      }
    );

    uiReady = true;

    updateValue();

    return true;
  }

  function updateValue() {
    const value =
      $("cloradSmoothingValueNumber");

    if (value) {
      value.textContent =
        `${strength}%`;
    }
  }

  function setStatus(text) {
    const status =
      $("cloradSmoothingStatus");

    if (status) {
      status.textContent =
        text || "";
    }
  }

  function startUIWatcher() {
    if (uiReady) {
      return;
    }

    const observer =
      new MutationObserver(
        () => {
          if (
            !uiReady &&
            createUI()
          ) {
            observer.disconnect();
          }
        }
      );

    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true
      }
    );

    createUI();
  }

  /* =======================================================
     IMAGE
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

        image.onerror = () =>
          reject(
            new Error(
              "Radar image load failed"
            )
          );

        image.src = url;
      }
    );
  }

  /* =======================================================
     PALETTE
     ======================================================= */

  function buildPalette(data) {
    const counts =
      new Map();

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      const alpha =
        data[i + 3];

      if (alpha < 180) {
        continue;
      }

      const key =
        (data[i] << 16) |
        (data[i + 1] << 8) |
        data[i + 2];

      counts.set(
        key,
        (counts.get(key) || 0) + 1
      );
    }

    const colors = [];

    counts.forEach(
      (count, key) => {
        colors.push({
          r:
            (key >> 16) & 255,
          g:
            (key >> 8) & 255,
          b:
            key & 255,
          count
        });
      }
    );

    colors.sort(
      (a, b) =>
        b.count - a.count
    );

    return colors.slice(
      0,
      32
    );
  }

  function nearestColor(
    r,
    g,
    b,
    palette
  ) {
    let best = 0;
    let distance = Infinity;

    for (
      let i = 0;
      i < palette.length;
      i++
    ) {
      const p =
        palette[i];

      const dr =
        r - p.r;

      const dg =
        g - p.g;

      const db =
        b - p.b;

      const d =
        dr * dr +
        dg * dg +
        db * db;

      if (d < distance) {
        distance = d;
        best = i;
      }
    }

    return best;
  }

  /* =======================================================
     CLASS MAP
     ======================================================= */

  function buildClassMap(
    data,
    width,
    height,
    palette
  ) {
    const labels =
      new Int16Array(
        width * height
      );

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
        const p =
          (y * width + x) * 4;

        if (
          data[p + 3] < 180
        ) {
          labels[
            y * width + x
          ] = -1;

          continue;
        }

        labels[
          y * width + x
        ] =
          nearestColor(
            data[p],
            data[p + 1],
            data[p + 2],
            palette
          );
      }
    }

    return labels;
  }

  /* =======================================================
     DOWN SAMPLE
     ======================================================= */

  function getScale() {
    if (strength < 25) {
      return 1;
    }

    if (strength < 65) {
      return 1;
    }

    return CONFIG.maxDownsample;
  }

  function downsampleLabels(
    source,
    width,
    height,
    scale
  ) {
    if (scale === 1) {
      return {
        labels: source,
        width,
        height
      };
    }

    const w =
      Math.ceil(
        width / scale
      );

    const h =
      Math.ceil(
        height / scale
      );

    const result =
      new Int16Array(
        w * h
      );

    for (
      let y = 0;
      y < h;
      y++
    ) {
      for (
        let x = 0;
        x < w;
        x++
      ) {
        const counts =
          new Map();

        for (
          let yy = 0;
          yy < scale;
          yy++
        ) {
          for (
            let xx = 0;
            xx < scale;
            xx++
          ) {
            const sx =
              x * scale + xx;

            const sy =
              y * scale + yy;

            if (
              sx >= width ||
              sy >= height
            ) {
              continue;
            }

            const cls =
              source[
                sy * width + sx
              ];

            if (cls >= 0) {
              counts.set(
                cls,
                (counts.get(cls) || 0) + 1
              );
            }
          }
        }

        let best = -1;
        let count = 0;

        counts.forEach(
          (n, cls) => {
            if (n > count) {
              count = n;
              best = cls;
            }
          }
        );

        result[
          y * w + x
        ] = best;
      }
    }

    return {
      labels: result,
      width: w,
      height: h
    };
  }

  /* =======================================================
     MORPHOLOGICAL CONTOUR PREPARATION
     ======================================================= */

  function getRadius() {
    return Math.max(
      1,
      Math.round(
        CONFIG.maxMorphRadius *
        strength /
        100
      )
    );
  }

  /*
    Небольшое морфологическое закрытие формы.
    Оно не рисует новые цвета — только меняет
    принадлежность существующих радарных классов.
  */

  function contourMorphology(
    source,
    width,
    height
  ) {
    if (strength <= 0) {
      return source;
    }

    const radius =
      getRadius();

    if (radius <= 0) {
      return source;
    }

    let result =
      source.slice();

    const passes =
      strength >= 75
        ? 2
        : 1;

    for (
      let pass = 0;
      pass < passes;
      pass++
    ) {
      result =
        smoothBoundaries(
          result,
          width,
          height,
          radius
        );
    }

    return result;
  }

  function smoothBoundaries(
    source,
    width,
    height,
    radius
  ) {
    const result =
      source.slice();

    /*
      Меняем только пограничные пиксели.
      Внутренняя часть областей вообще
      не трогается.
    */

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
        const index =
          y * width + x;

        const original =
          source[index];

        if (original < 0) {
          continue;
        }

        let boundary = false;

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

            const nx =
              x + dx;

            const ny =
              y + dy;

            if (
              nx < 0 ||
              ny < 0 ||
              nx >= width ||
              ny >= height
            ) {
              boundary = true;
              continue;
            }

            if (
              source[
                ny * width + nx
              ] !== original
            ) {
              boundary = true;
            }
          }
        }

        if (!boundary) {
          continue;
        }

        const votes =
          new Map();

        for (
          let dy = -radius;
          dy <= radius;
          dy++
        ) {
          for (
            let dx = -radius;
            dx <= radius;
            dx++
          ) {
            const d =
              Math.sqrt(
                dx * dx +
                dy * dy
              );

            if (d > radius) {
              continue;
            }

            const nx =
              x + dx;

            const ny =
              y + dy;

            if (
              nx < 0 ||
              ny < 0 ||
              nx >= width ||
              ny >= height
            ) {
              continue;
            }

            const cls =
              source[
                ny * width + nx
              ];

            if (cls < 0) {
              continue;
            }

            const weight =
              1 / (1 + d);

            votes.set(
              cls,
              (votes.get(cls) || 0) +
                weight
            );
          }
        }

        let best =
          original;

        let bestScore =
          votes.get(
            original
          ) || 0;

        votes.forEach(
          (score, cls) => {
            /*
              Новый класс должен заметно
              превосходить исходный.
            */

            if (
              score >
              bestScore * 1.22
            ) {
              bestScore = score;
              best = cls;
            }
          }
        );

        result[index] =
          best;
      }
    }

    return result;
  }

  /* =======================================================
     CONTOUR EXTRACTION
     ======================================================= */

  /*
    Здесь начинается главное отличие от предыдущей версии.

    Мы НЕ рисуем пиксели.

    Из карты классов строятся настоящие границы
    областей. Каждая граница состоит из сегментов,
    после чего сегменты собираются в замкнутые контуры.
  */

  function addSegment(
    segments,
    ax,
    ay,
    bx,
    by
  ) {
    segments.push({
      ax,
      ay,
      bx,
      by
    });
  }

  function extractClassSegments(
    labels,
    width,
    height,
    classId
  ) {
    const segments = [];

    /*
      Каждая граница между классом и соседним
      классом становится линией.

      Координаты находятся между клетками,
      поэтому контур уже не привязан к центру
      квадратного пикселя.
    */

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
        if (
          labels[
            y * width + x
          ] !== classId
        ) {
          continue;
        }

        /*
          Верх
        */

        if (
          y === 0 ||
          labels[
            (y - 1) * width + x
          ] !== classId
        ) {
          addSegment(
            segments,
            x,
            y,
            x + 1,
            y
          );
        }

        /*
          Право
        */

        if (
          x === width - 1 ||
          labels[
            y * width + x + 1
          ] !== classId
        ) {
          addSegment(
            segments,
            x + 1,
            y,
            x + 1,
            y + 1
          );
        }

        /*
          Низ
        */

        if (
          y === height - 1 ||
          labels[
            (y + 1) * width + x
          ] !== classId
        ) {
          addSegment(
            segments,
            x + 1,
            y + 1,
            x,
            y + 1
          );
        }

        /*
          Лево
        */

        if (
          x === 0 ||
          labels[
            y * width + x - 1
          ] !== classId
        ) {
          addSegment(
            segments,
            x,
            y + 1,
            x,
            y
          );
        }
      }
    }

    return segments;
  }

  function pointKey(
    x,
    y
  ) {
    return (
      `${x}:${y}`
    );
  }

  function chainSegments(
    segments
  ) {
    const startMap =
      new Map();

    for (
      let i = 0;
      i < segments.length;
      i++
    ) {
      const s =
        segments[i];

      const key =
        pointKey(
          s.ax,
          s.ay
        );

      if (
        !startMap.has(key)
      ) {
        startMap.set(
          key,
          []
        );
      }

      startMap
        .get(key)
        .push(i);
    }

    const used =
      new Uint8Array(
        segments.length
      );

    const contours = [];

    for (
      let start = 0;
      start < segments.length;
      start++
    ) {
      if (used[start]) {
        continue;
      }

      const first =
        segments[start];

      const contour = [
        [first.ax, first.ay]
      ];

      used[start] = 1;

      let x =
        first.bx;

      let y =
        first.by;

      const startX =
        first.ax;

      const startY =
        first.ay;

      contour.push([
        x,
        y
      ]);

      let guard = 0;

      while (
        !(
          x === startX &&
          y === startY
        ) &&
        guard <
          segments.length + 5
      ) {
        guard++;

        const candidates =
          startMap.get(
            pointKey(x, y)
          );

        if (
          !candidates ||
          !candidates.length
        ) {
          break;
        }

        let next = -1;

        for (
          let i = 0;
          i < candidates.length;
          i++
        ) {
          if (
            !used[
              candidates[i]
            ]
          ) {
            next =
              candidates[i];

            break;
          }
        }

        if (next < 0) {
          break;
        }

        const s =
          segments[next];

        used[next] = 1;

        x = s.bx;
        y = s.by;

        contour.push([
          x,
          y
        ]);
      }

      if (
        contour.length >= 4 &&
        x === startX &&
        y === startY
      ) {
        contours.push(
          contour
        );
      }
    }

    return contours;
  }

  /* =======================================================
     CONTOUR SMOOTHING
     ======================================================= */

  /*
    Chaikin:
    превращает ломаную линию в плавный контур.

    Именно это убирает:
      ■ квадратные углы
      ■ ступеньки
      ■ зубчатые внешние края
      ■ квадратные внутренние вырезы

    При этом это уже геометрический контур,
    а не blur изображения.
  */

  function chaikin(
    points,
    amount
  ) {
    if (
      points.length < 4
    ) {
      return points;
    }

    const result = [];

    const cut =
      0.25 *
      amount;

    for (
      let i = 0;
      i < points.length - 1;
      i++
    ) {
      const p0 =
        points[i];

      const p1 =
        points[i + 1];

      result.push([
        p0[0] +
          (p1[0] - p0[0]) *
          cut,

        p0[1] +
          (p1[1] - p0[1]) *
          cut
      ]);

      result.push([
        p0[0] +
          (p1[0] - p0[0]) *
          (1 - cut),

        p0[1] +
          (p1[1] - p0[1]) *
          (1 - cut)
      ]);
    }

    /*
      Замыкаем контур.
    */

    const last =
      points[
        points.length - 1
      ];

    const first =
      points[0];

    result.push([
      last[0] +
        (first[0] - last[0]) *
        cut,

      last[1] +
        (first[1] - last[1]) *
        cut
    ]);

    result.push([
      last[0] +
        (first[0] - last[0]) *
        (1 - cut),

      last[1] +
        (first[1] - last[1]) *
        (1 - cut)
    ]);

    return result;
  }

  function smoothContour(
    contour
  ) {
    let result =
      contour.slice();

    if (
      strength <= 0
    ) {
      return result;
    }

    const passes =
      Math.max(
        1,
        Math.min(
          CONFIG.maxSmoothPasses,
          Math.round(
            1 +
              strength / 40
          )
        )
      );

    /*
      На маленьких значениях оставляем
      контур ближе к исходному.

      На больших сильнее округляем.
    */

    const amount =
      strength < 25
        ? 0.45
        : strength < 50
          ? 0.68
          : strength < 75
            ? 0.86
            : 1;

    for (
      let i = 0;
      i < passes;
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
     RENDER CONTOURS
     ======================================================= */

  function renderContours(
    labels,
    width,
    height,
    palette,
    outputWidth,
    outputHeight,
    scale
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      outputWidth;

    canvas.height =
      outputHeight;

    const ctx =
      canvas.getContext(
        "2d"
      );

    /*
      ВАЖНО:
      здесь разрешена геометрическая
      антиалиасинг-отрисовка контуров.

      Это не blur исходного радара.
      Цвет заливки всегда один из
      исходных радарных цветов.
    */

    ctx.imageSmoothingEnabled =
      true;

    /*
      Находим реально присутствующие
      классы.
    */

    const classes =
      new Set();

    for (
      let i = 0;
      i < labels.length;
      i++
    ) {
      if (
        labels[i] >= 0
      ) {
        classes.add(
          labels[i]
        );
      }
    }

    /*
      Рисуем каждый класс как отдельную
      цельную область.
    */

    classes.forEach(
      classId => {
        const paletteColor =
          palette[classId];

        if (!paletteColor) {
          return;
        }

        const segments =
          extractClassSegments(
            labels,
            width,
            height,
            classId
          );

        if (
          !segments.length
        ) {
          return;
        }

        const contours =
          chainSegments(
            segments
          );

        if (
          !contours.length
        ) {
          return;
        }

        ctx.beginPath();

        for (
          let i = 0;
          i < contours.length;
          i++
        ) {
          let contour =
            contours[i];

          if (
            strength > 0
          ) {
            contour =
              smoothContour(
                contour
              );
          }

          if (
            contour.length < 3
          ) {
            continue;
          }

          /*
            Переводим координаты внутренней
            сетки в исходное разрешение.
          */

          const first =
            contour[0];

          ctx.moveTo(
            first[0] * scale,
            first[1] * scale
          );

          /*
            Вместо соединения прямыми
            используем квадратичные кривые
            между соседними точками.

            Это делает границу действительно
            плавной, а не просто «скруглённым
            квадратом».
          */

          for (
            let p = 1;
            p < contour.length;
            p++
          ) {
            const current =
              contour[p];

            const next =
              contour[
                (p + 1) %
                contour.length
              ];

            const mx =
              (
                current[0] +
                next[0]
              ) / 2;

            const my =
              (
                current[1] +
                next[1]
              ) / 2;

            ctx.quadraticCurveTo(
              current[0] * scale,
              current[1] * scale,
              mx * scale,
              my * scale
            );
          }

          ctx.closePath();
        }

        ctx.fillStyle =
          `rgb(
            ${paletteColor.r},
            ${paletteColor.g},
            ${paletteColor.b}
          )`;

        /*
          evenodd позволяет корректно
          сохранять отверстия внутри областей.
        */

        ctx.fill(
          "evenodd"
        );
      }
    );

    return canvas;
  }

  /* =======================================================
     CACHE
     ======================================================= */

  function makeCacheKey(
    url,
    value
  ) {
    return (
      `${url}::${value}`
    );
  }

  function getCached(key) {
    if (
      !cache.has(key)
    ) {
      return null;
    }

    const value =
      cache.get(key);

    const i =
      cacheOrder.indexOf(
        key
      );

    if (i >= 0) {
      cacheOrder.splice(
        i,
        1
      );
    }

    cacheOrder.push(
      key
    );

    return value;
  }

  function putCache(
    key,
    url
  ) {
    cache.set(
      key,
      url
    );

    const i =
      cacheOrder.indexOf(
        key
      );

    if (i >= 0) {
      cacheOrder.splice(
        i,
        1
      );
    }

    cacheOrder.push(
      key
    );

    while (
      cacheOrder.length >
      CONFIG.cacheLimit
    ) {
      const old =
        cacheOrder.shift();

      const oldURL =
        cache.get(old);

      cache.delete(old);

      if (oldURL) {
        try {
          URL.revokeObjectURL(
            oldURL
          );
        } catch (_) {}
      }
    }
  }

  function clearCache() {
    cache.forEach(
      url => {
        try {
          URL.revokeObjectURL(
            url
          );
        } catch (_) {}
      }
    );

    cache.clear();
    cacheOrder = [];
  }

  /* =======================================================
     PROCESS IMAGE
     ======================================================= */

  async function processImage(
    source,
    token
  ) {
    if (
      !source ||
      strength <= 0
    ) {
      return null;
    }

    const key =
      makeCacheKey(
        source,
        strength
      );

    const cached =
      getCached(key);

    if (cached) {
      return cached;
    }

    processing = true;

    setStatus(
      "Сглаживание контура…"
    );

    try {
      const image =
        await loadImage(
          source
        );

      if (
        token !== processToken
      ) {
        return null;
      }

      const width =
        image.naturalWidth ||
        image.width;

      const height =
        image.naturalHeight ||
        image.height;

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

      ctx.drawImage(
        image,
        0,
        0
      );

      const imageData =
        ctx.getImageData(
          0,
          0,
          width,
          height
        );

      if (
        token !== processToken
      ) {
        return null;
      }

      const palette =
        buildPalette(
          imageData.data
        );

      if (
        !palette.length
      ) {
        return null;
      }

      const original =
        buildClassMap(
          imageData.data,
          width,
          height,
          palette
        );

      if (
        token !== processToken
      ) {
        return null;
      }

      const scale =
        getScale();

      const reduced =
        downsampleLabels(
          original,
          width,
          height,
          scale
        );

      if (
        token !== processToken
      ) {
        return null;
      }

      const smoothed =
        contourMorphology(
          reduced.labels,
          reduced.width,
          reduced.height
        );

      if (
        token !== processToken
      ) {
        return null;
      }

      const output =
        renderContours(
          smoothed,
          reduced.width,
          reduced.height,
          palette,
          width,
          height,
          scale
        );

      if (
        token !== processToken
      ) {
        return null;
      }

      const url =
        await new Promise(
          resolve => {
            output.toBlob(
              blob => {
                if (!blob) {
                  resolve(null);
                  return;
                }

                resolve(
                  URL.createObjectURL(
                    blob
                  )
                );
              },
              "image/png"
            );
          }
        );

      if (
        !url ||
        token !== processToken
      ) {
        if (url) {
          try {
            URL.revokeObjectURL(
              url
            );
          } catch (_) {}
        }

        return null;
      }

      putCache(
        key,
        url
      );

      return url;
    } finally {
      processing = false;
    }
  }

  /* =======================================================
     APPLY
     ======================================================= */

  async function applyToLayer(
    layer
  ) {
    if (
      !layer ||
      !layer._url
    ) {
      return;
    }

    currentLayer =
      layer;

    const source =
      layer.__cloradOriginalURL ||
      layer._url;

    currentSource =
      source;

    if (
      strength <= 0
    ) {
      restoreOriginal(
        layer
      );

      setStatus("");

      return;
    }

    const token =
      ++processToken;

    const processed =
      await processImage(
        source,
        token
      );

    if (
      token !== processToken ||
      !processed
    ) {
      return;
    }

    currentProcessedURL =
      processed;

    layer.__cloradSmoothingInternal =
      true;

    try {
      layer.setUrl(
        processed
      );
    } finally {
      layer.__cloradSmoothingInternal =
        false;
    }

    setStatus(
      `Применено: ${strength}%`
    );
  }

  function restoreOriginal(
    layer
  ) {
    if (!layer) {
      return;
    }

    const source =
      layer.__cloradOriginalURL ||
      currentSource;

    if (!source) {
      return;
    }

    layer.__cloradSmoothingInternal =
      true;

    try {
      layer.setUrl(
        source
      );
    } finally {
      layer.__cloradSmoothingInternal =
        false;
    }

    currentProcessedURL =
      null;
  }

  function processCurrent() {
    if (!currentLayer) {
      scanLayers();
    }

    if (!currentLayer) {
      setStatus(
        "Радарный кадр ещё не загружен"
      );

      return;
    }

    applyToLayer(
      currentLayer
    );
  }

  /* =======================================================
     LEAFLET
     ======================================================= */

  function isRadarLayer(
    layer
  ) {
    if (!layer) {
      return false;
    }

    const options =
      layer.options || {};

    const className =
      options.className || "";

    return (
      className.includes(
        "clorad-gif-radar-image"
      ) ||
      className.includes(
        "clorad-radar-raster"
      )
    );
  }

  function installLeafletHook() {
    if (
      leafletReady
    ) {
      return true;
    }

    if (
      !window.L ||
      !L.ImageOverlay
    ) {
      return false;
    }

    if (
      !L.ImageOverlay.prototype.onAdd ||
      !L.ImageOverlay.prototype.setUrl
    ) {
      return false;
    }

    originalOnAdd =
      L.ImageOverlay.prototype.onAdd;

    originalSetUrl =
      L.ImageOverlay.prototype.setUrl;

    L.ImageOverlay.prototype.onAdd =
      function(map) {
        const result =
          originalOnAdd.call(
            this,
            map
          );

        if (
          isRadarLayer(this)
        ) {
          if (
            !this.__cloradOriginalURL
          ) {
            this.__cloradOriginalURL =
              this._url;
          }

          currentLayer =
            this;

          currentSource =
            this.__cloradOriginalURL;

          if (
            strength > 0
          ) {
            setTimeout(
              () => {
                if (
                  currentLayer ===
                  this
                ) {
                  applyToLayer(
                    this
                  );
                }
              },
              0
            );
          }
        }

        return result;
      };

    L.ImageOverlay.prototype.setUrl =
      function(url) {
        if (
          isRadarLayer(this) &&
          !this.__cloradSmoothingInternal
        ) {
          this.__cloradOriginalURL =
            url;

          currentLayer =
            this;

          currentSource =
            url;

          currentProcessedURL =
            null;

          const result =
            originalSetUrl.call(
              this,
              url
            );

          if (
            strength > 0
          ) {
            setTimeout(
              () => {
                if (
                  currentLayer ===
                  this
                ) {
                  applyToLayer(
                    this
                  );
                }
              },
              0
            );
          }

          return result;
        }

        return originalSetUrl.call(
          this,
          url
        );
      };

    leafletReady =
      true;

    return true;
  }

  /* =======================================================
     MAP
     ======================================================= */

  function scanLayers() {
    if (
      !window.map ||
      !window.map._layers
    ) {
      return;
    }

    Object.keys(
      window.map._layers
    ).forEach(
      id => {
        const layer =
          window.map._layers[id];

        if (
          isRadarLayer(layer)
        ) {
          currentLayer =
            layer;

          currentSource =
            layer.__cloradOriginalURL ||
            layer._url;
        }
      }
    );
  }

  function installMapHooks() {
    if (
      mapReady
    ) {
      return true;
    }

    if (
      !window.map
    ) {
      return false;
    }

    window.map.on(
      "layeradd",
      event => {
        const layer =
          event.layer;

        if (
          !isRadarLayer(layer)
        ) {
          return;
        }

        currentLayer =
          layer;

        currentSource =
          layer.__cloradOriginalURL ||
          layer._url;

        if (
          strength > 0
        ) {
          setTimeout(
            () => {
              if (
                currentLayer ===
                layer
              ) {
                applyToLayer(
                  layer
                );
              }
            },
            0
          );
        }
      }
    );

    window.map.on(
      "layerremove",
      event => {
        if (
          event.layer ===
          currentLayer
        ) {
          currentLayer =
            null;

          currentSource =
            null;

          currentProcessedURL =
            null;
        }
      }
    );

    mapReady =
      true;

    scanLayers();

    return true;
  }

  function waitForMap() {
    if (
      !window.map
    ) {
      setTimeout(
        waitForMap,
        250
      );

      return;
    }

    installLeafletHook();
    installMapHooks();
    scanLayers();
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRadarSmoothing = {
    getStrength() {
      return strength;
    },

    setStrength(value) {
      strength =
        Math.round(
          clamp(
            Number(value) || 0,
            CONFIG.min,
            CONFIG.max
          ) / CONFIG.step
        ) * CONFIG.step;

      const range =
        $("cloradSmoothingRange");

      if (range) {
        range.value =
          String(strength);
      }

      updateValue();

      processCurrent();
    },

    process() {
      processCurrent();
    },

    restore() {
      if (
        currentLayer
      ) {
        restoreOriginal(
          currentLayer
        );
      }

      setStatus("");
    },

    clearCache() {
      clearCache();
    }
  };

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    installStyle();

    createUI();

    startUIWatcher();

    installLeafletHook();
    installMapHooks();

    waitForMap();
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
