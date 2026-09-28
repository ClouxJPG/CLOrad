/* =========================================================
   CLOrad — CONTOUR RADAR SMOOTHING
   =========================================================

   Радар:
      raster pixels
           ↓
      color classes
           ↓
      binary masks
           ↓
      marching squares
           ↓
      closed contours
           ↓
      contour simplification
           ↓
      smooth cubic curves
           ↓
      solid radar areas

   ВАЖНО:

   • квадратные пиксели НЕ рисуются
   • каждый класс превращается в цельную область
   • границы являются непрерывными линиями
   • углы и ступеньки сглаживаются геометрически
   • CSS blur отсутствует
   • цвета не смешиваются
   • исходный GIF не остаётся под сглаженным слоем
   • настройка находится внутри «Настройки»
   • настройка находится после «Кол. кадров»
   • иконки нет
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
      Упрощение исходного контура.

      Чем больше значение,
      тем меньше исходных ступенек
      остаётся перед построением кривой.
    */

    simplifyMin: 0.35,
    simplifyMax: 5.5,

    /*
      Сила изгиба итоговой кривой.
    */

    curveMin: 0.10,
    curveMax: 0.34,

    /*
      Радиус предварительного
      сглаживания CLASS MAP.

      Это не blur изображения.
      Это изменение принадлежности
      пограничных ячеек к классу
      до построения контура.
    */

    morphologyMin: 0,
    morphologyMax: 3,

    /*
      Очень маленькие отдельные
      острова убираются только
      при сильном сглаживании.
    */

    tinyAreaMin: 0,
    tinyAreaMax: 10,

    /*
      Толщина внутреннего перекрытия
      контуров для устранения
      субпиксельных щелей между
      соседними цветовыми областями.
    */

    seamOverlapMin: 0.0,
    seamOverlapMax: 1.15,

    cacheLimit: 4
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

  let uiReady = false;
  let leafletReady = false;
  let mapReady = false;

  const cache = new Map();
  const cacheOrder = [];

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
     UI STYLE
     ======================================================= */

  function installStyle() {
    if ($("clorad-smoothing-style")) {
      return;
    }

    const style = document.createElement("style");

    style.id = "clorad-smoothing-style";

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

        background: transparent;

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
     SETTINGS UI
     ======================================================= */

  function createUI() {
    installStyle();

    const settings = $("settings");

    if (!settings) {
      return false;
    }

    if ($("cloradSmoothingSetting")) {
      uiReady = true;
      return true;
    }

    const setting = document.createElement("div");

    setting.className = "setting";
    setting.id = "cloradSmoothingSetting";

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

    const framesSetting =
      $("framesSetting");

    if (framesSetting) {
      framesSetting.after(setting);
    } else {
      settings.appendChild(setting);
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
            if (other !== setting) {
              other.classList.remove(
                "open"
              );

              const otherButton =
                other.querySelector(
                  ".settingHead,button"
                );

              if (otherButton) {
                otherButton.setAttribute(
                  "aria-expanded",
                  "false"
                );
              }
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

        setStatus(
          strength === 0
            ? ""
            : "Отпустите ползунок"
        );
      }
    );

    range.addEventListener(
      "change",
      () => {
        strength =
          Number(range.value) || 0;

        updateValue();

        processCurrent();
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
     IMAGE LOADING
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
     COLOR PALETTE
     ======================================================= */

  function buildPalette(data) {
    const counts =
      new Map();

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      if (
        data[i + 3] < 160
      ) {
        continue;
      }

      const r =
        data[i];

      const g =
        data[i + 1];

      const b =
        data[i + 2];

      const key =
        (
          r << 16
        ) |
        (
          g << 8
        ) |
        b;

      counts.set(
        key,
        (
          counts.get(key) ||
          0
        ) + 1
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
      Достаточно много классов,
      чтобы не терять реальные
      оттенки радара.
    */

    return colors.slice(
      0,
      64
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
     LABEL MAP
     ======================================================= */

  function buildLabelMap(
    imageData,
    width,
    height,
    palette
  ) {
    const labels =
      new Int16Array(
        width * height
      );

    labels.fill(-1);

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

        const alpha =
          imageData[p + 3];

        if (
          alpha < 160
        ) {
          continue;
        }

        labels[
          y * width + x
        ] =
          nearestColor(
            imageData[p],
            imageData[p + 1],
            imageData[p + 2],
            palette
          );
      }
    }

    return labels;
  }

  /* =======================================================
     WORKING RESOLUTION
     ======================================================= */

  function getWorkingScale() {
    if (
      strength < 40
    ) {
      return 1;
    }

    if (
      strength < 75
    ) {
      return 1;
    }

    return 2;
  }

  function reduceLabels(
    labels,
    width,
    height,
    scale
  ) {
    if (
      scale === 1
    ) {
      return {
        labels,
        width,
        height
      };
    }

    const outWidth =
      Math.ceil(
        width / scale
      );

    const outHeight =
      Math.ceil(
        height / scale
      );

    const output =
      new Int16Array(
        outWidth *
        outHeight
      );

    output.fill(-1);

    for (
      let y = 0;
      y < outHeight;
      y++
    ) {
      for (
        let x = 0;
        x < outWidth;
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

            const cls =
              labels[
                sy * width +
                sx
              ];

            if (
              cls < 0
            ) {
              continue;
            }

            votes.set(
              cls,
              (
                votes.get(cls) ||
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
          y * outWidth + x
        ] = best;
      }
    }

    return {
      labels: output,
      width: outWidth,
      height: outHeight
    };
  }

  /* =======================================================
     MORPHOLOGICAL CLASS SMOOTHING
     ======================================================= */

  function morphologyRadius() {
    return Math.round(
      lerp(
        CONFIG.morphologyMin,
        CONFIG.morphologyMax,
        strength / 100
      )
    );
  }

  function smoothLabels(
    source,
    width,
    height
  ) {
    const radius =
      morphologyRadius();

    if (
      radius <= 0
    ) {
      return source;
    }

    let current =
      source.slice();

    const passes =
      strength >= 80
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

          const own =
            current[index];

          if (
            own < 0
          ) {
            continue;
          }

          let boundary =
            false;

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
                boundary =
                  true;

                continue;
              }

              if (
                current[
                  ny * width +
                  nx
                ] !== own
              ) {
                boundary =
                  true;
              }
            }
          }

          if (
            !boundary
          ) {
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
              if (
                dx * dx +
                dy * dy >
                radius * radius
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

              const distance =
                Math.sqrt(
                  dx * dx +
                  dy * dy
                );

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
            own;

          let bestScore =
            votes.get(own) ||
            0;

          votes.forEach(
            (score, cls) => {
              if (
                score >
                bestScore * 1.25
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

  function segment(
    result,
    ax,
    ay,
    bx,
    by
  ) {
    result.push({
      ax,
      ay,
      bx,
      by
    });
  }

  /*
    Получаем только границу
    конкретного цветового класса.

    Здесь НЕ рисуется ни одного
    квадрата.
  */

  function buildBoundarySegments(
    labels,
    width,
    height,
    classId
  ) {
    const result = [];

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

        const top =
          y > 0 &&
          labels[
            (y - 1) *
              width +
            x
          ] === classId;

        const right =
          x < width - 1 &&
          labels[
            y * width +
            x + 1
          ] === classId;

        const bottom =
          y < height - 1 &&
          labels[
            (y + 1) *
              width +
            x
          ] === classId;

        const left =
          x > 0 &&
          labels[
            y * width +
            x - 1
          ] === classId;

        if (!top) {
          segment(
            result,
            x,
            y,
            x + 1,
            y
          );
        }

        if (!right) {
          segment(
            result,
            x + 1,
            y,
            x + 1,
            y + 1
          );
        }

        if (!bottom) {
          segment(
            result,
            x + 1,
            y + 1,
            x,
            y + 1
          );
        }

        if (!left) {
          segment(
            result,
            x,
            y + 1,
            x,
            y
          );
        }
      }
    }

    return result;
  }

  /* =======================================================
     SEGMENT CHAINING
     ======================================================= */

  function pointKey(
    x,
    y
  ) {
    return (
      `${x},${y}`
    );
  }

  function chainSegments(
    segments
  ) {
    const lookup =
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
        !lookup.has(key)
      ) {
        lookup.set(
          key,
          []
        );
      }

      lookup
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

      const points = [
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
        guard <
        segments.length + 5
      ) {
        guard++;

        if (
          x === startX &&
          y === startY
        ) {
          break;
        }

        const candidates =
          lookup.get(
            pointKey(x, y)
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
          nextIndex === -1
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

        points.push([
          x,
          y
        ]);
      }

      if (
        points.length >= 4 &&
        x === startX &&
        y === startY
      ) {
        points.pop();

        contours.push(
          points
        );
      }
    }

    return contours;
  }

  /* =======================================================
     GEOMETRY
     ======================================================= */

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

    return Math.abs(area) / 2;
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

    return distance(
      point,
      [
        px,
        py
      ]
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

    let index =
      -1;

    const first =
      points[0];

    const last =
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
          first,
          last
        );

      if (
        d > maxDistance
      ) {
        maxDistance =
          d;

        index =
          i;
      }
    }

    if (
      index === -1
    ) {
      return [
        first,
        last
      ];
    }

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

  /*
    Упрощаем замкнутый контур,
    не превращая его обратно
    в набор квадратов.
  */

  function simplifyClosed(
    points,
    epsilon
  ) {
    if (
      points.length < 8
    ) {
      return points;
    }

    let farthestIndex =
      0;

    let farthestDistance =
      0;

    const origin =
      points[0];

    for (
      let i = 1;
      i < points.length;
      i++
    ) {
      const d =
        distance(
          origin,
          points[i]
        );

      if (
        d >
        farthestDistance
      ) {
        farthestDistance =
          d;

        farthestIndex =
          i;
      }
    }

    const firstPart =
      points.slice(
        0,
        farthestIndex + 1
      );

    const secondPart =
      points.slice(
        farthestIndex
      );

    const a =
      rdp(
        firstPart,
        epsilon
      );

    const b =
      rdp(
        secondPart,
        epsilon
      );

    if (
      b.length
    ) {
      b.shift();
    }

    return a.concat(b);
  }

  /* =======================================================
     SMOOTH CLOSED CURVE
     ======================================================= */

  function drawSmoothContour(
    ctx,
    points,
    outputScale,
    tension
  ) {
    const count =
      points.length;

    if (
      count < 3
    ) {
      return;
    }

    function get(index) {
      return points[
        (
          index +
          count
        ) %
        count
      ];
    }

    const start =
      get(0);

    ctx.moveTo(
      start[0] *
        outputScale,
      start[1] *
        outputScale
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
        c1x *
          outputScale,
        c1y *
          outputScale,

        c2x *
          outputScale,
        c2y *
          outputScale,

        p2[0] *
          outputScale,
        p2[1] *
          outputScale
      );
    }

    ctx.closePath();
  }

  /* =======================================================
     CLASS COLLECTION
     ======================================================= */

  function collectClasses(
    labels
  ) {
    const counts =
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

      counts.set(
        cls,
        (
          counts.get(cls) ||
          0
        ) + 1
      );
    }

    /*
      Большие области первыми,
      маленькие интенсивные ядра
      поверх.
    */

    return Array.from(
      counts.entries()
    ).sort(
      (a, b) =>
        b[1] - a[1]
    );
  }

  /* =======================================================
     VECTOR-LIKE RENDER
     ======================================================= */

  function renderContours(
    labels,
    width,
    height,
    palette,
    originalWidth,
    originalHeight,
    workingScale
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      originalWidth;

    canvas.height =
      originalHeight;

    const ctx =
      canvas.getContext(
        "2d"
      );

    /*
      Очень важно:

      НИКАКОГО fillRect().

      НИКАКОГО рисования отдельных
      радарных пикселей.

      Только Path2D / Bezier.
    */

    ctx.imageSmoothingEnabled =
      true;

    const classes =
      collectClasses(
        labels
      );

    const tension =
      lerp(
        CONFIG.curveMin,
        CONFIG.curveMax,
        strength / 100
      );

    const epsilon =
      lerp(
        CONFIG.simplifyMin,
        CONFIG.simplifyMax,
        strength / 100
      );

    const tinyArea =
      lerp(
        CONFIG.tinyAreaMin,
        CONFIG.tinyAreaMax,
        strength / 100
      );

    /*
      Чем сильнее сглаживание,
      тем небольшое перекрытие
      соседних контуров.

      Это убирает тонкие щели
      между соседними областями.
    */

    const seamOverlap =
      lerp(
        CONFIG.seamOverlapMin,
        CONFIG.seamOverlapMax,
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
        buildBoundarySegments(
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

      for (
        let i = 0;
        i < contours.length;
        i++
      ) {
        const raw =
          contours[i];

        const area =
          polygonArea(
            raw
          );

        if (
          strength > 75 &&
          area < tinyArea
        ) {
          continue;
        }

        let contour =
          simplifyClosed(
            raw,
            epsilon
          );

        if (
          contour.length < 3
        ) {
          continue;
        }

        /*
          Немного расширяем сам
          математический путь только
          на границе.

          Это не делает квадраты.
          Это предотвращает щели
          между соседними цветами.
        */

        if (
          seamOverlap > 0
        ) {
          let cx = 0;
          let cy = 0;

          for (
            let p = 0;
            p < contour.length;
            p++
          ) {
            cx +=
              contour[p][0];

            cy +=
              contour[p][1];
          }

          cx /=
            contour.length;

          cy /=
            contour.length;

          contour =
            contour.map(
              point => {
                const dx =
                  point[0] - cx;

                const dy =
                  point[1] - cy;

                const length =
                  Math.sqrt(
                    dx * dx +
                    dy * dy
                  );

                if (
                  length < 0.001
                ) {
                  return point;
                }

                /*
                  Расширение очень
                  маленькое и зависит
                  от силы сглаживания.
                */

                const factor =
                  (
                    length +
                    seamOverlap
                  ) /
                  length;

                return [
                  cx +
                    dx *
                    factor,

                  cy +
                    dy *
                    factor
                ];
              }
            );
        }

        ctx.beginPath();

        drawSmoothContour(
          ctx,
          contour,
          workingScale,
          tension
        );

        const fill =
          `rgb(
            ${color.r},
            ${color.g},
            ${color.b}
          )`;

        ctx.fillStyle =
          fill;

        /*
          Сам контур дополнительно
          слегка прокладываем тем же
          цветом.

          Поэтому между соседними
          областями не появляется
          прозрачная щель.
        */

        ctx.strokeStyle =
          fill;

        ctx.lineWidth =
          seamOverlap *
          1.5;

        ctx.lineJoin =
          "round";

        ctx.lineCap =
          "round";

        ctx.fill(
          "nonzero"
        );

        if (
          seamOverlap > 0
        ) {
          ctx.stroke();
        }
      }
    }

    return canvas;
  }

  /* =======================================================
     CACHE
     ======================================================= */

  function cacheKey(
    source,
    value
  ) {
    return (
      `${source}::${value}`
    );
  }

  function getCached(
    key
  ) {
    if (
      !cache.has(key)
    ) {
      return null;
    }

    return cache.get(key);
  }

  function putCached(
    key,
    url
  ) {
    if (
      cache.has(key)
    ) {
      cache.delete(key);
    }

    cache.set(
      key,
      url
    );

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
        oldURL &&
        oldURL !== currentProcessedURL
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
        if (
          url ===
          currentProcessedURL
        ) {
          return;
        }

        try {
          URL.revokeObjectURL(
            url
          );
        } catch (_) {}
      }
    );

    cache.clear();
    cacheOrder.length = 0;
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
      cacheKey(
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
      "Построение контуров…"
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
        Исходный GIF читается
        только один раз.
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

      /*
        Определяем реальные цвета
        данного GIF-кадра.
      */

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
        Каждый непрозрачный пиксель
        получает класс.

        После этого сам растр
        больше не используется
        для финальной отрисовки.
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
        return null;
      }

      const workingScale =
        getWorkingScale();

      const reduced =
        reduceLabels(
          labels,
          width,
          height,
          workingScale
        );

      if (
        token !==
        processToken
      ) {
        return null;
      }

      const smoothed =
        smoothLabels(
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
        ФИНАЛЬНАЯ ОТРИСОВКА:

        никаких квадратов.

        Только непрерывные
        замкнутые кривые.
      */

      const output =
        renderContours(
          smoothed,
          reduced.width,
          reduced.height,
          palette,
          width,
          height,
          workingScale
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

      putCached(
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
     ORIGINAL / PROCESSED LAYER
     ======================================================= */

  async function applyToLayer(
    layer
  ) {
    if (
      !layer
    ) {
      return;
    }

    const source =
      layer.__cloradOriginalURL ||
      layer._url;

    if (
      !source
    ) {
      return;
    }

    currentLayer =
      layer;

    currentSource =
      source;

    /*
      0% = настоящий исходный GIF.
    */

    if (
      strength <= 0
    ) {
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

    /*
      Критически важно:

      здесь мы НЕ оставляем
      исходную картинку вторым
      слоем.

      Тот же Leaflet ImageOverlay
      получает новый URL.
    */

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
     RESTORE
     ======================================================= */

  function restoreOriginal(
    layer
  ) {
    if (
      !layer
    ) {
      return;
    }

    const source =
      layer.__cloradOriginalURL ||
      currentSource;

    if (
      !source
    ) {
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

  /* =======================================================
     RADAR LAYER DETECTION
     ======================================================= */

  function isRadarLayer(
    layer
  ) {
    if (
      !layer
    ) {
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

    const prototype =
      L.ImageOverlay.prototype;

    if (
      !prototype.setUrl ||
      !prototype.onAdd
    ) {
      return false;
    }

    const originalSetUrl =
      prototype.setUrl;

    const originalOnAdd =
      prototype.onAdd;

    prototype.onAdd =
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

    prototype.setUrl =
      function(url) {
        /*
          Это реальная смена кадра
          GIF-анимации.

          Новый URL становится
          новым исходным кадром.
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
