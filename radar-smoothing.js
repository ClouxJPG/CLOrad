/* =========================================================
   CLOrad — REAL RADAR CONTOUR SMOOTHING
   =========================================================

   Идея:

   исходный GIF
        ↓
   радарные цветовые классы
        ↓
   границы цветовых областей
        ↓
   замкнутые контуры
        ↓
   удаление пиксельной ступенчатости
        ↓
   сглаженная кубическая кривая
        ↓
   цельная цветовая область

   ВАЖНО:

   • квадратные пиксели НЕ рисуются
   • CSS blur НЕ используется
   • изображение НЕ размывается
   • цвета НЕ смешиваются
   • используются существующие цвета радара
   • внешние и внутренние контуры сглаживаются
   • настройка находится внутри «Настройки»
   • настройка стоит после «Кол. кадров»
   • иконки у настройки нет
   • 0% = исходный радар
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

    /*
      Чем выше значение, тем сильнее
      геометрическое сглаживание.
    */

    simplifyMin: 0.8,
    simplifyMax: 7.0,

    /*
      Натяжение кривой.
      Малое значение = форма ближе
      к исходному контуру.
    */

    curveMin: 0.18,
    curveMax: 0.42,

    /*
      Дополнительное морфологическое
      сглаживание формы.

      Оно выполняется до векторизации.
    */

    morphologyMin: 0,
    morphologyMax: 4,

    /*
      Слишком маленькие отдельные
      области можно убрать только
      при очень сильном сглаживании.
    */

    tinyAreaMin: 0,
    tinyAreaMax: 8,

    /*
      Ограничение кэша обработанных кадров.
    */

    cacheLimit: 5,

    /*
      Обработка начинается только
      после отпускания ползунка.
    */

    processDelay: 80
  };

  /* =======================================================
     STATE
     ======================================================= */

  let strength = 0;

  let currentLayer = null;
  let currentSource = null;

  let currentProcessedURL = null;

  let processing = false;

  let processToken = 0;

  let processTimer = null;

  let uiReady = false;
  let leafletReady = false;
  let mapReady = false;

  let cache = new Map();
  let cacheOrder = [];

  let originalOnAdd = null;
  let originalSetUrl = null;

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

  function lerp(a, b, t) {
    return a + (b - a) * t;
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

        padding:
          0 14px 13px;
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
          rgba(255,255,255,.9);

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
          rgba(255,255,255,.4);
      }

      body.light
      #cloradSmoothingValue {
        color:
          rgba(0,0,0,.5);
      }

      body.light
      #cloradSmoothingValueNumber {
        color:
          rgba(0,0,0,.78);
      }

      body.light
      #cloradSmoothingStatus {
        color:
          rgba(0,0,0,.4);
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
     SETTINGS
     ======================================================= */

  function createUI() {
    installStyle();

    const settings =
      $("settings");

    if (!settings) {
      return false;
    }

    if (
      $("cloradSmoothingSetting")
    ) {
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
      Настройка ставится строго после
      существующего блока «Кол. кадров».
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

        const opened =
          setting.classList.contains(
            "open"
          );

        document
          .querySelectorAll(
            ".setting.open"
          )
          .forEach(other => {
            if (
              other !== setting
            ) {
              other.classList.remove(
                "open"
              );
            }
          });

        setting.classList.toggle(
          "open",
          !opened
        );

        button.setAttribute(
          "aria-expanded",
          String(!opened)
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

        image.onload = () => {
          resolve(image);
        };

        image.onerror = () => {
          reject(
            new Error(
              "Radar image load failed"
            )
          );
        };

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

      const r =
        data[i];

      const g =
        data[i + 1];

      const b =
        data[i + 2];

      const key =
        (r << 16) |
        (g << 8) |
        b;

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

    /*
      Оставляем достаточно классов,
      чтобы не уничтожать мелкие
      радарные значения.
    */

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
    let bestDistance =
      Infinity;

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

      const distance =
        dr * dr +
        dg * dg +
        db * db;

      if (
        distance <
        bestDistance
      ) {
        bestDistance =
          distance;

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
          (
            y * width +
            x
          ) * 4;

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
     OPTIONAL DOWNSAMPLING
     ======================================================= */

  function getScale() {
    /*
      На слабом сглаживании сохраняем
      исходное разрешение.

      На сильном сначала немного
      упрощаем исходную сетку,
      чтобы контуры не повторяли
      каждую мелкую ступеньку.
    */

    if (
      strength < 55
    ) {
      return 1;
    }

    return 2;
  }

  function downsampleLabels(
    source,
    width,
    height,
    scale
  ) {
    if (
      scale === 1
    ) {
      return {
        labels: source,
        width,
        height
      };
    }

    const newWidth =
      Math.ceil(
        width / scale
      );

    const newHeight =
      Math.ceil(
        height / scale
      );

    const output =
      new Int16Array(
        newWidth *
        newHeight
      );

    for (
      let y = 0;
      y < newHeight;
      y++
    ) {
      for (
        let x = 0;
        x < newWidth;
        x++
      ) {
        const votes =
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
              x * scale +
              xx;

            const sy =
              y * scale +
              yy;

            if (
              sx >= width ||
              sy >= height
            ) {
              continue;
            }

            const value =
              source[
                sy * width +
                sx
              ];

            if (
              value < 0
            ) {
              continue;
            }

            votes.set(
              value,
              (
                votes.get(value) ||
                0
              ) + 1
            );
          }
        }

        let best =
          -1;

        let bestVotes =
          0;

        votes.forEach(
          (count, cls) => {
            if (
              count >
              bestVotes
            ) {
              bestVotes =
                count;

              best =
                cls;
            }
          }
        );

        output[
          y * newWidth + x
        ] = best;
      }
    }

    return {
      labels: output,
      width: newWidth,
      height: newHeight
    };
  }

  /* =======================================================
     MORPHOLOGY
     ======================================================= */

  function getMorphologyRadius() {
    return Math.round(
      lerp(
        CONFIG.morphologyMin,
        CONFIG.morphologyMax,
        strength / 100
      )
    );
  }

  /*
    Очень лёгкое морфологическое
    сглаживание именно CLASS MAP.

    Здесь ещё нет рисования.

    Оно нужно только для того,
    чтобы будущий контур не повторял
    каждую мелкую пиксельную ступеньку.
  */

  function morphology(
    source,
    width,
    height
  ) {
    const radius =
      getMorphologyRadius();

    if (
      radius <= 0
    ) {
      return source;
    }

    let current =
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
      const next =
        current.slice();

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
            current[index];

          if (
            original < 0
          ) {
            continue;
          }

          /*
            Не трогаем глубокую внутреннюю
            часть области.
          */

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
                current[
                  ny * width +
                  nx
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
                current[
                  ny * width +
                  nx
                ];

              if (
                cls < 0
              ) {
                continue;
              }

              const weight =
                1 /
                (
                  1 +
                  distance
                );

              votes.set(
                cls,
                (
                  votes.get(cls) ||
                  0
                ) + weight
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
              if (
                score >
                bestScore *
                1.18
              ) {
                best =
                  cls;

                bestScore =
                  score;
              }
            }
          );

          next[index] =
            best;
        }
      }

      current =
        next;
    }

    return current;
  }

  /* =======================================================
     CONTOUR SEGMENTS
     ======================================================= */

  function addSegment(
    list,
    ax,
    ay,
    bx,
    by
  ) {
    list.push({
      ax,
      ay,
      bx,
      by
    });
  }

  function extractSegments(
    labels,
    width,
    height,
    classId
  ) {
    const segments = [];

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
          Верхняя граница
        */

        if (
          y === 0 ||
          labels[
            (y - 1) *
              width +
            x
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
          Правая граница
        */

        if (
          x === width - 1 ||
          labels[
            y * width +
            x + 1
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
          Нижняя граница
        */

        if (
          y === height - 1 ||
          labels[
            (y + 1) *
              width +
            x
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
          Левая граница
        */

        if (
          x === 0 ||
          labels[
            y * width +
            x - 1
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

  /* =======================================================
     SEGMENT CHAINING
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

  function chainSegments(
    segments
  ) {
    const starts =
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
        !starts.has(key)
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

    const contours = [];

    for (
      let i = 0;
      i < segments.length;
      i++
    ) {
      if (
        used[i]
      ) {
        continue;
      }

      const first =
        segments[i];

      used[i] = 1;

      const contour = [
        [
          first.ax,
          first.ay
        ],
        [
          first.bx,
          first.by
        ]
      ];

      const startX =
        first.ax;

      const startY =
        first.ay;

      let x =
        first.bx;

      let y =
        first.by;

      let guard = 0;

      while (
        !(
          x === startX &&
          y === startY
        ) &&
        guard <
          segments.length + 10
      ) {
        guard++;

        const candidates =
          starts.get(
            pointKey(
              x,
              y
            )
          );

        if (
          !candidates
        ) {
          break;
        }

        let nextIndex =
          -1;

        for (
          let j = 0;
          j < candidates.length;
          j++
        ) {
          const candidate =
            candidates[j];

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

        const next =
          segments[
            nextIndex
          ];

        used[
          nextIndex
        ] = 1;

        x =
          next.bx;

        y =
          next.by;

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
     CONTOUR GEOMETRY
     ======================================================= */

  function polygonArea(
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

    return (
      Math.abs(area) /
      2
    );
  }

  function distance(
    a,
    b
  ) {
    const dx =
      a[0] - b[0];

    const dy =
      a[1] - b[1];

    return Math.sqrt(
      dx * dx +
      dy * dy
    );
  }

  /*
    Удаляем только лишние точки
    на почти прямых участках.

    Это очень важно:
    контур больше не содержит
    отдельную точку на каждом
    пиксельном углу.
  */

  function simplifyContour(
    points,
    epsilon
  ) {
    if (
      points.length < 6
    ) {
      return points;
    }

    /*
      Убираем последний дубликат
      первой точки.
    */

    let source =
      points.slice();

    if (
      source.length > 1
    ) {
      const first =
        source[0];

      const last =
        source[
          source.length - 1
        ];

      if (
        first[0] === last[0] &&
        first[1] === last[1]
      ) {
        source.pop();
      }
    }

    if (
      source.length < 4
    ) {
      return source;
    }

    /*
      Для замкнутого контура сначала
      находим точку с максимальным
      расстоянием от начальной.
    */

    let farthest = 0;
    let maxDistance = 0;

    for (
      let i = 1;
      i < source.length;
      i++
    ) {
      const d =
        distance(
          source[0],
          source[i]
        );

      if (
        d > maxDistance
      ) {
        maxDistance =
          d;

        farthest =
          i;
      }
    }

    /*
      Разрываем контур в двух
      наиболее удалённых местах
      и упрощаем две половины.
    */

    const partA =
      source.slice(
        0,
        farthest + 1
      );

    const partB =
      source.slice(
        farthest
      );

    const a =
      rdp(
        partA,
        epsilon
      );

    const b =
      rdp(
        partB,
        epsilon
      );

    b.shift();

    const result =
      a.concat(b);

    return result;
  }

  function perpendicularDistance(
    point,
    start,
    end
  ) {
    const x =
      point[0];

    const y =
      point[1];

    const x1 =
      start[0];

    const y1 =
      start[1];

    const x2 =
      end[0];

    const y2 =
      end[1];

    const dx =
      x2 - x1;

    const dy =
      y2 - y1;

    if (
      dx === 0 &&
      dy === 0
    ) {
      return distance(
        point,
        start
      );
    }

    const t =
      (
        (x - x1) * dx +
        (y - y1) * dy
      ) /
      (
        dx * dx +
        dy * dy
      );

    const px =
      x1 + t * dx;

    const py =
      y1 + t * dy;

    const rx =
      x - px;

    const ry =
      y - py;

    return Math.sqrt(
      rx * rx +
      ry * ry
    );
  }

  function rdp(
    points,
    epsilon
  ) {
    if (
      points.length < 3
    ) {
      return points.slice();
    }

    let maxDistance =
      epsilon;

    let index = -1;

    const start =
      points[0];

    const end =
      points[
        points.length - 1
      ];

    for (
      let i = 1;
      i < points.length - 1;
      i++
    ) {
      const d =
        perpendicularDistance(
          points[i],
          start,
          end
        );

      if (
        d > maxDistance
      ) {
        index =
          i;

        maxDistance =
          d;
      }
    }

    if (
      index >= 0
    ) {
      const left =
        rdp(
          points.slice(
            0,
            index + 1
          ),
          epsilon
        );

      const right =
        rdp(
          points.slice(
            index
          ),
          epsilon
        );

      left.pop();

      return left.concat(
        right
      );
    }

    return [
      start,
      end
    ];
  }

  /* =======================================================
     CATMULL-ROM CURVE
     ======================================================= */

  /*
    Это главный этап.

    Вместо:
      точка → прямая → угол → прямая

    получается:

      плавная кубическая кривая

    Благодаря этому граница становится
    похожей на нарисованную тобой форму.
  */

  function drawSmoothClosedContour(
    ctx,
    points,
    scale,
    tension
  ) {
    if (
      points.length < 3
    ) {
      return;
    }

    const count =
      points.length;

    function get(index) {
      return points[
        (
          index +
          count
        ) %
        count
      ];
    }

    const first =
      get(0);

    ctx.moveTo(
      first[0] * scale,
      first[1] * scale
    );

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const p0 =
        get(i - 1);

      const p1 =
        get(i);

      const p2 =
        get(i + 1);

      const p3 =
        get(i + 2);

      const c1x =
        p1[0] +
        (
          p2[0] -
          p0[0]
        ) *
        tension;

      const c1y =
        p1[1] +
        (
          p2[1] -
          p0[1]
        ) *
        tension;

      const c2x =
        p2[0] -
        (
          p3[0] -
          p1[0]
        ) *
        tension;

      const c2y =
        p2[1] -
        (
          p3[1] -
          p1[1]
        ) *
        tension;

      ctx.bezierCurveTo(
        c1x * scale,
        c1y * scale,

        c2x * scale,
        c2y * scale,

        p2[0] * scale,
        p2[1] * scale
      );
    }

    ctx.closePath();
  }

  /* =======================================================
     CONTOUR SMOOTHING
     ======================================================= */

  function smoothContour(
    contour
  ) {
    if (
      strength <= 0
    ) {
      return contour;
    }

    const epsilon =
      lerp(
        CONFIG.simplifyMin,
        CONFIG.simplifyMax,
        strength / 100
      );

    const simplified =
      simplifyContour(
        contour,
        epsilon
      );

    if (
      simplified.length < 4
    ) {
      return contour;
    }

    return simplified;
  }

  function getCurveTension() {
    return lerp(
      CONFIG.curveMin,
      CONFIG.curveMax,
      strength / 100
    );
  }

  /* =======================================================
     RENDER
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
      Геометрическая антиалиасинговая
      отрисовка.

      Это НЕ blur.

      Граница строится как математическая
      кривая и браузер сам сглаживает
      только её край.
    */

    ctx.imageSmoothingEnabled =
      true;

    /*
      Собираем существующие классы.
    */

    const classInfo =
      new Map();

    for (
      let i = 0;
      i < labels.length;
      i++
    ) {
      const cls =
        labels[i];

      if (
        cls < 0
      ) {
        continue;
      }

      classInfo.set(
        cls,
        (
          classInfo.get(cls) ||
          0
        ) + 1
      );
    }

    /*
      Большие области рисуем первыми,
      маленькие интенсивные ядра —
      поверх них.

      Это особенно важно для структур
      типа твоего примера:
      зелёная → жёлтая → красная.
    */

    const classes =
      Array.from(
        classInfo.entries()
      ).sort(
        (a, b) =>
          b[1] - a[1]
      );

    const tension =
      getCurveTension();

    const tinyArea =
      lerp(
        CONFIG.tinyAreaMin,
        CONFIG.tinyAreaMax,
        strength / 100
      );

    for (
      let c = 0;
      c < classes.length;
      c++
    ) {
      const classId =
        classes[c][0];

      const color =
        palette[classId];

      if (!color) {
        continue;
      }

      const segments =
        extractSegments(
          labels,
          width,
          height,
          classId
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

      for (
        let i = 0;
        i < contours.length;
        i++
      ) {
        let contour =
          contours[i];

        const area =
          polygonArea(
            contour
          );

        /*
          При 100% совсем микроскопические
          одиночные точки убираем.
        */

        if (
          strength > 75 &&
          area < tinyArea
        ) {
          continue;
        }

        contour =
          smoothContour(
            contour
          );

        if (
          contour.length < 3
        ) {
          continue;
        }

        ctx.beginPath();

        /*
          Внутренние и внешние области
          обрабатываются одинаково.
        */

        drawSmoothClosedContour(
          ctx,
          contour,
          scale,
          tension
        );

        ctx.fillStyle =
          `rgb(
            ${color.r},
            ${color.g},
            ${color.b}
          )`;

        ctx.fill(
          "nonzero"
        );
      }
    }

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
      String(url) +
      "::" +
      String(value)
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

    const index =
      cacheOrder.indexOf(
        key
      );

    if (
      index >= 0
    ) {
      cacheOrder.splice(
        index,
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

    const index =
      cacheOrder.indexOf(
        key
      );

    if (
      index >= 0
    ) {
      cacheOrder.splice(
        index,
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
      const oldKey =
        cacheOrder.shift();

      const oldURL =
        cache.get(
          oldKey
        );

      cache.delete(
        oldKey
      );

      if (
        oldURL
      ) {
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
     PROCESS
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

    if (
      cached
    ) {
      return cached;
    }

    processing =
      true;

    setStatus(
      "Построение гладкого контура…"
    );

    try {
      const image =
        await loadImage(
          source
        );

      if (
        token !==
        processToken
      ) {
        return null;
      }

      const width =
        image.naturalWidth ||
        image.width;

      const height =
        image.naturalHeight ||
        image.height;

      /*
        Получаем исходные пиксели
        только как данные для
        построения геометрии.
      */

      const sourceCanvas =
        document.createElement(
          "canvas"
        );

      sourceCanvas.width =
        width;

      sourceCanvas.height =
        height;

      const sourceContext =
        sourceCanvas.getContext(
          "2d",
          {
            willReadFrequently:
              true
          }
        );

      sourceContext.drawImage(
        image,
        0,
        0
      );

      const imageData =
        sourceContext.getImageData(
          0,
          0,
          width,
          height
        );

      if (
        token !==
        processToken
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

      /*
        Классификация исходного
        изображения.
      */

      const originalLabels =
        buildClassMap(
          imageData.data,
          width,
          height,
          palette
        );

      if (
        token !==
        processToken
      ) {
        return null;
      }

      /*
        При сильном сглаживании
        немного уменьшаем внутреннюю
        рабочую сетку.
      */

      const scale =
        getScale();

      const reduced =
        downsampleLabels(
          originalLabels,
          width,
          height,
          scale
        );

      if (
        token !==
        processToken
      ) {
        return null;
      }

      /*
        Сглаживаем форму ещё
        до построения контура.
      */

      const prepared =
        morphology(
          reduced.labels,
          reduced.width,
          reduced.height
        );

      if (
        token !==
        processToken
      ) {
        return null;
      }

      /*
        А здесь уже вообще нет
        рисования пикселей.

        Строятся цельные
        вектороподобные области.
      */

      const output =
        renderContours(
          prepared,
          reduced.width,
          reduced.height,
          palette,
          width,
          height,
          scale
        );

      if (
        token !==
        processToken
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
        token !==
        processToken
      ) {
        if (
          url
        ) {
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
      processing =
        false;
    }
  }

  /* =======================================================
     APPLY TO LEAFLET
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
      token !==
      processToken ||
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

    ++processToken;

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
    if (
      !currentLayer
    ) {
      scanLayers();
    }

    if (
      !currentLayer
    ) {
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
     RADAR LAYER DETECTION
     ======================================================= */

  function isRadarLayer(
    layer
  ) {
    if (!layer) {
      return false;
    }

    const options =
      layer.options ||
      {};

    const className =
      options.className ||
      "";

    return (
      className.includes(
        "clorad-gif-radar-image"
      ) ||
      className.includes(
        "clorad-radar-raster"
      )
    );
  }

  /* =======================================================
     LEAFLET HOOK
     ======================================================= */

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
        /*
          Когда сам GIF переключает
          кадр — это новый исходный
          кадр, поэтому его обязательно
          сохраняем как source.
        */

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
     MAP SCAN
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
          ) /
          CONFIG.step
        ) *
        CONFIG.step;

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
