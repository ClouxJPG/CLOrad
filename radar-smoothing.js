/* =========================================================
   CLOrad — Radar Morphological Smoothing
   ---------------------------------------------------------
   • Кнопка находится внутри «Настройки»
   • Настройка стоит после «Кол. кадров»
   • 0% = исходный радар
   • Сглаживание работает только после отпускания ползунка
   • Без CSS blur
   • Без RGB-интерполяции
   • Используются только существующие цвета радара
   • Сглаживание выполняется на клиенте
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
      Внутреннее разрешение обработки.

      1 = максимальная детализация
      2 = быстрее на телефоне
    */
    resolution: 2,

    /*
      Максимальный радиус морфологической обработки.
      Реальный радиус зависит от strength.
    */
    maxRadius: 5,

    /*
      Минимальный размер области,
      которую разрешено изменять.
    */
    minRegionPixels: 3,

    /*
      Ограничение кеша обработанных кадров.
    */
    cacheLimit: 4,

    /*
      Небольшая задержка после изменения ползунка.
      Само тяжёлое вычисление всё равно происходит
      только после отпускания ползунка.
    */
    processDelay: 80
  };

  /* =======================================================
     STATE
     ======================================================= */

  let strength = CONFIG.initial;
  let processing = false;

  let processTimer = null;

  let currentLayer = null;
  let currentSource = null;
  let currentProcessedURL = null;

  let cache = new Map();
  let cacheOrder = [];

  let uiReady = false;
  let leafletHookReady = false;
  let mapHooksReady = false;

  let originalOnAdd = null;
  let originalSetUrl = null;

  let lastProcessToken = 0;

  /* =======================================================
     HELPERS
     ======================================================= */

  const $ = id => document.getElementById(id);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function round(value) {
    return Math.round(value);
  }

  /* =======================================================
     STYLE
     ======================================================= */

  function installStyle() {
    if ($("clorad-smoothing-style")) {
      return;
    }

    const style = document.createElement("style");

    style.id = "clorad-smoothing-style";

    style.textContent = `
      /* ===================================================
         CLOrad — Radar Smoothing
         =================================================== */

      #cloradSmoothingSetting {
        width: 100%;
      }

      #cloradSmoothingButton {
        width: 100%;
        min-height: 44px;
        padding: 0 14px;

        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;

        border: 0;
        outline: 0;

        background: transparent;
        color: inherit;

        font: inherit;
        text-align: left;

        cursor: pointer;

        -webkit-tap-highlight-color: transparent;
      }

      #cloradSmoothingButton:active {
        opacity: .72;
      }

      #cloradSmoothingButton .clorad-smoothing-title {
        display: flex;
        align-items: center;
        gap: 9px;

        min-width: 0;
      }

      #cloradSmoothingButton .clorad-smoothing-icon {
        width: 20px;
        height: 20px;

        flex: 0 0 20px;

        opacity: .82;
      }

      #cloradSmoothingButton .clorad-smoothing-text {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #cloradSmoothingButton .clorad-smoothing-arrow {
        flex: 0 0 auto;

        font-size: 22px;
        line-height: 1;

        opacity: .55;

        transform: rotate(0deg);
        transition: transform .16s ease;
      }

      #cloradSmoothingSetting.open
      #cloradSmoothingButton
      .clorad-smoothing-arrow {
        transform: rotate(90deg);
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

        margin-bottom: 8px;

        font-size: 12px;
        line-height: 1.2;

        color: rgba(255,255,255,.58);
      }

      #cloradSmoothingValue strong {
        color: rgba(255,255,255,.88);
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

        background: rgba(255,255,255,.16);
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

        background: rgba(255,255,255,.16);
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
        line-height: 1.3;

        color: rgba(255,255,255,.42);
      }

      body.light
      #cloradSmoothingValue {
        color: rgba(0,0,0,.50);
      }

      body.light
      #cloradSmoothingValue strong {
        color: rgba(0,0,0,.78);
      }

      body.light
      #cloradSmoothingStatus {
        color: rgba(0,0,0,.42);
      }

      body.light
      #cloradSmoothingRange::-webkit-slider-runnable-track {
        background: rgba(0,0,0,.14);
      }

      body.light
      #cloradSmoothingRange::-moz-range-track {
        background: rgba(0,0,0,.14);
      }
    `;

    document.head.appendChild(style);
  }

  /* =======================================================
     SETTINGS
     ======================================================= */

  function getSettings() {
    return $("settings");
  }

  function createUI() {
    installStyle();

    const settings = getSettings();

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
        <span class="clorad-smoothing-title">

          <svg
            class="clorad-smoothing-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 16.5c2.1-5.4 4.2-8 6.3-8 1.6 0 2.5 2.1 4.1 2.1 1.5 0 2.7-1.5 5.6-4.6"/>
            <path d="M4 20c2.2-3.1 4.1-4.5 6.1-4.5 2.1 0 2.6 2.2 4.5 2.2 1.8 0 3.1-1.2 5.4-3.7"/>
          </svg>

          <span class="clorad-smoothing-text">
            Сглаживание радара
          </span>

        </span>

        <span class="clorad-smoothing-arrow">
          ›
        </span>
      </button>

      <div
        id="cloradSmoothingPanel"
        class="settingBody"
      >
        <div id="cloradSmoothingValue">
          <span>Сила сглаживания</span>
          <strong id="cloradSmoothingValueNumber">0%</strong>
        </div>

        <input
          id="cloradSmoothingRange"
          type="range"
          min="${CONFIG.min}"
          max="${CONFIG.max}"
          step="${CONFIG.step}"
          value="${CONFIG.initial}"
          inputmode="numeric"
        >

        <div id="cloradSmoothingStatus"></div>
      </div>
    `;

    /*
      КРИТИЧНО:
      настройка ставится именно после «Кол. кадров».
    */

    const framesSetting = $("framesSetting");

    if (framesSetting) {
      framesSetting.after(setting);
    } else {
      settings.appendChild(setting);
    }

    const button = $("cloradSmoothingButton");
    const range = $("cloradSmoothingRange");

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      const isOpen = setting.classList.contains("open");

      /*
        Не закрываем сам popup настроек.
        Закрываем только другие раскрытые setting.
      */

      document
        .querySelectorAll(".setting.open")
        .forEach(other => {
          if (other !== setting) {
            other.classList.remove("open");
          }
        });

      setting.classList.toggle("open", !isOpen);

      button.setAttribute(
        "aria-expanded",
        String(!isOpen)
      );
    });

    range.addEventListener("input", () => {
      strength = Number(range.value) || 0;

      updateValue();

      /*
        Никакой тяжёлой обработки во время движения.
      */

      if (processTimer) {
        clearTimeout(processTimer);
        processTimer = null;
      }

      setStatus(
        strength === 0
          ? ""
          : "Отпустите ползунок для применения"
      );
    });

    range.addEventListener("change", () => {
      strength = Number(range.value) || 0;

      updateValue();

      if (processTimer) {
        clearTimeout(processTimer);
        processTimer = null;
      }

      processTimer = setTimeout(() => {
        processTimer = null;
        processCurrentLayer();
      }, CONFIG.processDelay);
    });

    uiReady = true;

    updateValue();

    return true;
  }

  function updateValue() {
    const number = $("cloradSmoothingValueNumber");

    if (number) {
      number.textContent = `${strength}%`;
    }
  }

  function setStatus(text) {
    const status = $("cloradSmoothingStatus");

    if (status) {
      status.textContent = text || "";
    }
  }

  /* =======================================================
     UI WATCHER
     ======================================================= */

  function startUIWatcher() {
    if (uiReady) {
      return;
    }

    const observer = new MutationObserver(() => {
      if (!uiReady) {
        createUI();
      }

      if (uiReady) {
        observer.disconnect();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    /*
      На случай, если DOM уже полностью готов.
    */

    createUI();
  }

  /* =======================================================
     IMAGE
     ======================================================= */

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.crossOrigin = "anonymous";

      img.onload = () => resolve(img);

      img.onerror = () => {
        reject(
          new Error("Не удалось загрузить радарный кадр")
        );
      };

      img.src = url;
    });
  }

  function createCanvas(width, height) {
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    return canvas;
  }

  /* =======================================================
     COLOR HELPERS
     ======================================================= */

  function colorKey(r, g, b, a) {
    return (
      (r << 24) |
      (g << 16) |
      (b << 8) |
      a
    );
  }

  function colorDistanceSquared(
    r1,
    g1,
    b1,
    r2,
    g2,
    b2
  ) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;

    return (
      dr * dr +
      dg * dg +
      db * db
    );
  }

  /* =======================================================
     PALETTE
     ======================================================= */

  function buildPalette(data) {
    const counts = new Map();

    /*
      Берём только непрозрачные/видимые пиксели.
      Прозрачный фон не становится радарным классом.
    */

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];

      if (a < 180) {
        continue;
      }

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

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

    counts.forEach((count, key) => {
      colors.push({
        r: (key >> 16) & 255,
        g: (key >> 8) & 255,
        b: key & 255,
        count
      });
    });

    colors.sort(
      (a, b) => b.count - a.count
    );

    /*
      Большое число классов сильно увеличивает
      стоимость обработки.

      Берём реальные доминирующие цвета кадра.
    */

    return colors.slice(0, 32);
  }

  function nearestPaletteColor(
    r,
    g,
    b,
    palette
  ) {
    let best = -1;
    let bestDistance = Infinity;

    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];

      const distance =
        colorDistanceSquared(
          r,
          g,
          b,
          p.r,
          p.g,
          p.b
        );

      if (distance < bestDistance) {
        bestDistance = distance;
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
    const map = new Int16Array(
      width * height
    );

    /*
      -1 = прозрачный / фон
    */

    for (let y = 0; y < height; y++) {
      const row = y * width;

      for (let x = 0; x < width; x++) {
        const index =
          (row + x) * 4;

        const alpha =
          data[index + 3];

        if (alpha < 180) {
          map[row + x] = -1;
          continue;
        }

        map[row + x] =
          nearestPaletteColor(
            data[index],
            data[index + 1],
            data[index + 2],
            palette
          );
      }
    }

    return map;
  }

  /* =======================================================
     REGION SIZE
     ======================================================= */

  function collectRegion(
    labels,
    width,
    height,
    start,
    classId,
    visited
  ) {
    const queue = [start];
    const region = [];

    visited[start] = 1;

    let pointer = 0;

    while (pointer < queue.length) {
      const index =
        queue[pointer++];

      region.push(index);

      const x =
        index % width;

      const y =
        (index / width) | 0;

      const left =
        x > 0
          ? index - 1
          : -1;

      const right =
        x < width - 1
          ? index + 1
          : -1;

      const top =
        y > 0
          ? index - width
          : -1;

      const bottom =
        y < height - 1
          ? index + width
          : -1;

      if (
        left >= 0 &&
        !visited[left] &&
        labels[left] === classId
      ) {
        visited[left] = 1;
        queue.push(left);
      }

      if (
        right >= 0 &&
        !visited[right] &&
        labels[right] === classId
      ) {
        visited[right] = 1;
        queue.push(right);
      }

      if (
        top >= 0 &&
        !visited[top] &&
        labels[top] === classId
      ) {
        visited[top] = 1;
        queue.push(top);
      }

      if (
        bottom >= 0 &&
        !visited[bottom] &&
        labels[bottom] === classId
      ) {
        visited[bottom] = 1;
        queue.push(bottom);
      }
    }

    return region;
  }

  /* =======================================================
     MORPHOLOGICAL SMOOTHING
     ======================================================= */

  function calculateRadius() {
    if (strength <= 0) {
      return 0;
    }

    /*
      0–100%
      превращаем в радиус примерно 1–5 пикселей
      внутренней сетки обработки.
    */

    return Math.max(
      1,
      Math.round(
        (strength / 100) *
        CONFIG.maxRadius
      )
    );
  }

  function smoothClassMap(
    source,
    width,
    height,
    strengthValue
  ) {
    if (strengthValue <= 0) {
      return source.slice();
    }

    const radius =
      calculateRadius();

    if (radius <= 0) {
      return source.slice();
    }

    /*
      Работаем с копией.

      Важно:
      каждая радарная категория сглаживается
      относительно самой себя.

      Новые цвета не создаются.
    */

    let result = source.slice();

    /*
      Несколько проходов в зависимости от силы.
    */

    const passes =
      strengthValue >= 70
        ? 2
        : 1;

    for (
      let pass = 0;
      pass < passes;
      pass++
    ) {
      result =
        morphologicalPass(
          result,
          width,
          height,
          radius
        );
    }

    return result;
  }

  function morphologicalPass(
    source,
    width,
    height,
    radius
  ) {
    const total =
      width * height;

    const output =
      source.slice();

    /*
      Сглаживаем только существующие классы.
      Для каждой точки рассматриваем локальную
      окрестность и определяем геометрию области.

      Это НЕ обычный majority filter:
      сначала определяется граница области,
      затем изменяются только её пограничные пиксели.
    */

    const boundary =
      new Uint8Array(total);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index =
          y * width + x;

        const cls =
          source[index];

        if (cls < 0) {
          continue;
        }

        let different = false;

        for (
          let dy = -1;
          dy <= 1 && !different;
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

            const nx = x + dx;
            const ny = y + dy;

            if (
              nx < 0 ||
              ny < 0 ||
              nx >= width ||
              ny >= height
            ) {
              different = true;
              break;
            }

            const n =
              source[
                ny * width + nx
              ];

            if (n !== cls) {
              different = true;
              break;
            }
          }
        }

        if (different) {
          boundary[index] = 1;
        }
      }
    }

    /*
      Сглаживаем только контур.

      Для каждой граничной точки ищем ближайшие
      классы по радиусу.

      Если вокруг явно доминирует один из соседних
      классов — граница может переместиться.

      При близком конфликте исходный класс сохраняется.
    */

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index =
          y * width + x;

        if (!boundary[index]) {
          continue;
        }

        const original =
          source[index];

        if (original < 0) {
          continue;
        }

        const candidates =
          new Map();

        const minX =
          Math.max(
            0,
            x - radius
          );

        const maxX =
          Math.min(
            width - 1,
            x + radius
          );

        const minY =
          Math.max(
            0,
            y - radius
          );

        const maxY =
          Math.min(
            height - 1,
            y + radius
          );

        for (
          let ny = minY;
          ny <= maxY;
          ny++
        ) {
          for (
            let nx = minX;
            nx <= maxX;
            nx++
          ) {
            const cls =
              source[
                ny * width + nx
              ];

            if (cls < 0) {
              continue;
            }

            const dx =
              nx - x;

            const dy =
              ny - y;

            const distance =
              Math.sqrt(
                dx * dx +
                dy * dy
              );

            if (distance > radius) {
              continue;
            }

            /*
              Ближайшие пиксели получают больший вес.
            */

            const weight =
              1 /
              (1 + distance);

            candidates.set(
              cls,
              (candidates.get(cls) || 0) +
                weight
            );
          }
        }

        let bestClass =
          original;

        let bestScore =
          candidates.get(original) || 0;

        candidates.forEach(
          (score, cls) => {
            if (
              score >
              bestScore * 1.18
            ) {
              bestScore = score;
              bestClass = cls;
            }
          }
        );

        output[index] =
          bestClass;
      }
    }

    /*
      Удаляем крошечные случайные островки,
      появившиеся только из-за обработки границы.
    */

    return removeTinyIslands(
      output,
      width,
      height
    );
  }

  /* =======================================================
     REMOVE TINY ISLANDS
     ======================================================= */

  function removeTinyIslands(
    labels,
    width,
    height
  ) {
    const result =
      labels.slice();

    const visited =
      new Uint8Array(
        width * height
      );

    for (
      let index = 0;
      index < result.length;
      index++
    ) {
      if (
        visited[index] ||
        result[index] < 0
      ) {
        continue;
      }

      const cls =
        result[index];

      const region =
        collectRegion(
          result,
          width,
          height,
          index,
          cls,
          visited
        );

      if (
        region.length >=
        CONFIG.minRegionPixels
      ) {
        continue;
      }

      /*
        Маленькая область возвращается
        к наиболее распространённому соседнему классу.
      */

      const neighbours =
        new Map();

      for (
        let i = 0;
        i < region.length;
        i++
      ) {
        const p =
          region[i];

        const x =
          p % width;

        const y =
          (p / width) | 0;

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

            const nx = x + dx;
            const ny = y + dy;

            if (
              nx < 0 ||
              ny < 0 ||
              nx >= width ||
              ny >= height
            ) {
              continue;
            }

            const n =
              result[
                ny * width + nx
              ];

            if (
              n >= 0 &&
              n !== cls
            ) {
              neighbours.set(
                n,
                (neighbours.get(n) || 0) + 1
              );
            }
          }
        }
      }

      let replacement =
        cls;

      let best =
        0;

      neighbours.forEach(
        (count, candidate) => {
          if (count > best) {
            best = count;
            replacement = candidate;
          }
        }
      );

      if (replacement !== cls) {
        for (
          let i = 0;
          i < region.length;
          i++
        ) {
          result[
            region[i]
          ] = replacement;
        }
      }
    }

    return result;
  }

  /* =======================================================
     GEOMETRIC RENDERING
     ======================================================= */

  function renderSmoothGeometry(
    labels,
    originalLabels,
    width,
    height,
    palette,
    sourceData
  ) {
    const canvas =
      createCanvas(
        width,
        height
      );

    const ctx =
      canvas.getContext(
        "2d",
        {
          alpha: true,
          willReadFrequently: false
        }
      );

    /*
      Никакого сглаживания изображений.
    */

    ctx.imageSmoothingEnabled =
      false;

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    /*
      Сначала восстанавливаем фон
      из исходного изображения.

      Это важно для прозрачных частей GIF.
    */

    const sourceCanvas =
      createCanvas(
        width,
        height
      );

    const sourceCtx =
      sourceCanvas.getContext(
        "2d",
        {
          willReadFrequently: false
        }
      );

    const originalImage =
      sourceCtx.createImageData(
        width,
        height
      );

    originalImage.data.set(
      sourceData
    );

    /*
      Фон оставляем как был.
    */

    for (
      let i = 0;
      i < originalImage.data.length;
      i += 4
    ) {
      if (
        originalImage.data[i + 3] < 180
      ) {
        originalImage.data[i] = 0;
        originalImage.data[i + 1] = 0;
        originalImage.data[i + 2] = 0;
        originalImage.data[i + 3] = 0;
      }
    }

    sourceCtx.putImageData(
      originalImage,
      0,
      0
    );

    /*
      Для каждой клетки определяем соседей.
      Если сосед того же класса, граница между
      клетками убирается.

      На внешних углах используем округление.
    */

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index =
          y * width + x;

        const cls =
          labels[index];

        if (cls < 0) {
          continue;
        }

        const p =
          palette[cls];

        if (!p) {
          continue;
        }

        ctx.fillStyle =
          `rgb(${p.r},${p.g},${p.b})`;

        const left =
          x > 0
            ? labels[index - 1] === cls
            : false;

        const right =
          x < width - 1
            ? labels[index + 1] === cls
            : false;

        const top =
          y > 0
            ? labels[index - width] === cls
            : false;

        const bottom =
          y < height - 1
            ? labels[index + width] === cls
            : false;

        const tl =
          x > 0 &&
          y > 0 &&
          labels[
            index - width - 1
          ] === cls;

        const tr =
          x < width - 1 &&
          y > 0 &&
          labels[
            index - width + 1
          ] === cls;

        const bl =
          x > 0 &&
          y < height - 1 &&
          labels[
            index + width - 1
          ] === cls;

        const br =
          x < width - 1 &&
          y < height - 1 &&
          labels[
            index + width + 1
          ] === cls;

        /*
          Радиус угла зависит от силы.
        */

        const radius =
          strength <= 20
            ? 0
            : strength <= 45
              ? 0.18
              : strength <= 70
                ? 0.28
                : 0.38;

        const r =
          radius;

        /*
          Если вокруг клетки полностью одна
          область — обычный прямоугольник.
        */

        if (
          left &&
          right &&
          top &&
          bottom
        ) {
          ctx.fillRect(
            x,
            y,
            1,
            1
          );

          continue;
        }

        /*
          Для пограничных клеток строим контур.
          Это убирает квадратную ступеньку,
          но цвет остаётся строго исходным.
        */

        ctx.beginPath();

        const x0 = x;
        const y0 = y;
        const x1 = x + 1;
        const y1 = y + 1;

        /*
          Верхний левый угол
        */

        if (
          top ||
          left ||
          tl
        ) {
          ctx.moveTo(
            x0,
            y0 + r
          );
        } else {
          ctx.moveTo(
            x0 + r,
            y0 + r
          );
        }

        /*
          Верхняя сторона
        */

        if (top) {
          ctx.lineTo(
            x1,
            y0
          );
        } else {
          ctx.lineTo(
            x1 - r,
            y0
          );
        }

        /*
          Верхний правый
        */

        if (
          right ||
          top ||
          tr
        ) {
          ctx.lineTo(
            x1,
            y0 + r
          );
        } else {
          ctx.quadraticCurveTo(
            x1,
            y0,
            x1 - r,
            y0
          );
        }

        /*
          Правая сторона
        */

        if (right) {
          ctx.lineTo(
            x1,
            y1
          );
        } else {
          ctx.lineTo(
            x1,
            y1 - r
          );
        }

        /*
          Нижний правый
        */

        if (
          right ||
          bottom ||
          br
        ) {
          ctx.lineTo(
            x1 - r,
            y1
          );
        } else {
          ctx.quadraticCurveTo(
            x1,
            y1,
            x1 - r,
            y1
          );
        }

        /*
          Нижняя сторона
        */

        if (bottom) {
          ctx.lineTo(
            x0,
            y1
          );
        } else {
          ctx.lineTo(
            x0 + r,
            y1
          );
        }

        /*
          Нижний левый
        */

        if (
          left ||
          bottom ||
          bl
        ) {
          ctx.lineTo(
            x0,
            y1 - r
          );
        } else {
          ctx.quadraticCurveTo(
            x0,
            y1,
            x0,
            y1 - r
          );
        }

        /*
          Левая сторона
        */

        if (left) {
          ctx.lineTo(
            x0,
            y0
          );
        } else {
          ctx.lineTo(
            x0,
            y0 + r
          );
        }

        ctx.closePath();
        ctx.fill();
      }
    }

    /*
      Второй проход закрывает возможные микроскопические
      дырки между одинаковыми соседними областями.
    */

    if (strength >= 40) {
      ctx.globalCompositeOperation =
        "source-over";

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

          const cls =
            labels[index];

          if (cls < 0) {
            continue;
          }

          const sameLeft =
            x > 0 &&
            labels[index - 1] === cls;

          const sameRight =
            x < width - 1 &&
            labels[index + 1] === cls;

          const sameTop =
            y > 0 &&
            labels[index - width] === cls;

          const sameBottom =
            y < height - 1 &&
            labels[index + width] === cls;

          if (
            sameLeft &&
            sameRight
          ) {
            const p =
              palette[cls];

            ctx.fillStyle =
              `rgb(${p.r},${p.g},${p.b})`;

            ctx.fillRect(
              x,
              y,
              1,
              1
            );
          }

          if (
            sameTop &&
            sameBottom
          ) {
            const p =
              palette[cls];

            ctx.fillStyle =
              `rgb(${p.r},${p.g},${p.b})`;

            ctx.fillRect(
              x,
              y,
              1,
              1
            );
          }
        }
      }
    }

    return canvas;
  }

  /* =======================================================
     URL
     ======================================================= */

  function canvasToURL(canvas) {
    return new Promise(
      resolve => {
        canvas.toBlob(
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
          "image/png",
          1
        );
      }
    );
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

  function getCache(
    key
  ) {
    if (!cache.has(key)) {
      return null;
    }

    const value =
      cache.get(key);

    const index =
      cacheOrder.indexOf(key);

    if (index >= 0) {
      cacheOrder.splice(
        index,
        1
      );
    }

    cacheOrder.push(key);

    return value;
  }

  function setCache(
    key,
    value
  ) {
    if (cache.has(key)) {
      const old =
        cache.get(key);

      if (
        old &&
        old !== value
      ) {
        try {
          URL.revokeObjectURL(old);
        } catch (_) {}
      }

      const index =
        cacheOrder.indexOf(key);

      if (index >= 0) {
        cacheOrder.splice(
          index,
          1
        );
      }
    }

    cache.set(
      key,
      value
    );

    cacheOrder.push(key);

    while (
      cacheOrder.length >
      CONFIG.cacheLimit
    ) {
      const oldest =
        cacheOrder.shift();

      if (!oldest) {
        break;
      }

      const url =
        cache.get(oldest);

      cache.delete(oldest);

      if (url) {
        try {
          URL.revokeObjectURL(
            url
          );
        } catch (_) {}
      }
    }
  }

  function clearCache() {
    cache.forEach(url => {
      try {
        URL.revokeObjectURL(
          url
        );
      } catch (_) {}
    });

    cache.clear();
    cacheOrder = [];
  }

  /* =======================================================
     PROCESS SOURCE
     ======================================================= */

  async function processSource(
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
      getCache(key);

    if (cached) {
      return cached;
    }

    processing = true;

    setStatus(
      "Обработка радарного кадра…"
    );

    try {
      const img =
        await loadImage(
          source
        );

      if (
        token !== lastProcessToken
      ) {
        return null;
      }

      const width =
        img.naturalWidth ||
        img.width;

      const height =
        img.naturalHeight ||
        img.height;

      if (
        !width ||
        !height
      ) {
        return null;
      }

      const sourceCanvas =
        createCanvas(
          width,
          height
        );

      const sourceCtx =
        sourceCanvas.getContext(
          "2d",
          {
            willReadFrequently: true
          }
        );

      sourceCtx.drawImage(
        img,
        0,
        0
      );

      const imageData =
        sourceCtx.getImageData(
          0,
          0,
          width,
          height
        );

      if (
        token !== lastProcessToken
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

      const originalLabels =
        buildClassMap(
          imageData.data,
          width,
          height,
          palette
        );

      if (
        token !== lastProcessToken
      ) {
        return null;
      }

      /*
        Морфологическая обработка формы.
      */

      const smoothedLabels =
        smoothClassMap(
          originalLabels,
          width,
          height,
          strength
        );

      if (
        token !== lastProcessToken
      ) {
        return null;
      }

      /*
        Геометрический рендеринг.
      */

      const output =
        renderSmoothGeometry(
          smoothedLabels,
          originalLabels,
          width,
          height,
          palette,
          imageData.data
        );

      if (
        token !== lastProcessToken
      ) {
        return null;
      }

      const url =
        await canvasToURL(
          output
        );

      if (
        token !== lastProcessToken
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

      if (!url) {
        return null;
      }

      setCache(
        key,
        url
      );

      return url;
    } finally {
      processing = false;
    }
  }

  /* =======================================================
     APPLY TO LEAFLET LAYER
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

    currentLayer = layer;
    currentSource = layer._url;

    /*
      Если 0% — обязательно оригинал.
    */

    if (strength <= 0) {
      restoreOriginal(layer);
      setStatus("");
      return;
    }

    const token =
      ++lastProcessToken;

    const source =
      layer._url;

    const processed =
      await processSource(
        source,
        token
      );

    if (
      token !== lastProcessToken
    ) {
      return;
    }

    if (
      !processed
    ) {
      return;
    }

    currentProcessedURL =
      processed;

    /*
      setUrl() перехватывается ниже.
      Передаём специальный флаг,
      чтобы не запустить бесконечную обработку.
    */

    layer.__cloradSmoothingInternal =
      true;

    try {
      if (
        typeof layer.setUrl ===
        "function"
      ) {
        layer.setUrl(
          processed
        );
      }
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
     PROCESS CURRENT LAYER
     ======================================================= */

  function processCurrentLayer() {
    /*
      Если текущего слоя нет —
      ищем радарный ImageOverlay.
    */

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
     LEAFLET HOOK
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
      leafletHookReady
    ) {
      return true;
    }

    if (
      typeof window.L ===
      "undefined" ||
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
          /*
            Сохраняем настоящий исходный URL.
          */

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

          /*
            Сглаживание применяется
            после появления слоя на карте.
          */

          if (
            strength > 0
          ) {
            setTimeout(() => {
              if (
                currentLayer === this
              ) {
                applyToLayer(
                  this
                );
              }
            }, 0);
          }
        }

        return result;
      };

    L.ImageOverlay.prototype.setUrl =
      function(url) {
        /*
          Внутренний URL сглаженного PNG
          не должен становиться новым
          исходным радарным кадром.
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

          /*
            При смене кадра очищаем старый
            обработанный URL.

            Но сам объект кеша остаётся.
          */

          const result =
            originalSetUrl.call(
              this,
              url
            );

          if (
            strength > 0
          ) {
            setTimeout(() => {
              if (
                currentLayer === this
              ) {
                applyToLayer(
                  this
                );
              }
            }, 0);
          }

          return result;
        }

        return originalSetUrl.call(
          this,
          url
        );
      };

    leafletHookReady =
      true;

    return true;
  }

  /* =======================================================
     MAP SCANNER
     ======================================================= */

  function scanLayers() {
    if (
      typeof window.map ===
      "undefined" ||
      !window.map
    ) {
      return;
    }

    const layers =
      window.map._layers;

    if (
      !layers
    ) {
      return;
    }

    Object.keys(
      layers
    ).forEach(id => {
      const layer =
        layers[id];

      if (
        isRadarLayer(layer)
      ) {
        currentLayer =
          layer;

        currentSource =
          layer.__cloradOriginalURL ||
          layer._url;
      }
    });
  }

  /* =======================================================
     MAP HOOKS
     ======================================================= */

  function installMapHooks() {
    if (
      mapHooksReady
    ) {
      return true;
    }

    if (
      typeof window.map ===
      "undefined" ||
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
          setTimeout(() => {
            if (
              currentLayer === layer
            ) {
              applyToLayer(
                layer
              );
            }
          }, 0);
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
          currentLayer = null;
          currentSource = null;
          currentProcessedURL =
            null;
        }
      }
    );

    mapHooksReady =
      true;

    scanLayers();

    return true;
  }

  /* =======================================================
     WATCH FOR MAP
     ======================================================= */

  function waitForMap() {
    if (
      typeof window.map ===
      "undefined" ||
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
      const next =
        clamp(
          Number(value) || 0,
          CONFIG.min,
          CONFIG.max
        );

      strength =
        Math.round(
          next / CONFIG.step
        ) * CONFIG.step;

      const range =
        $("cloradSmoothingRange");

      if (range) {
        range.value =
          String(strength);
      }

      updateValue();

      processCurrentLayer();
    },

    clearCache() {
      clearCache();
    },

    process() {
      processCurrentLayer();
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
    }
  };

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    installStyle();

    createUI();

    startUIWatcher();

    if (
      !installLeafletHook()
    ) {
      setTimeout(
        installLeafletHook,
        250
      );
    }

    if (
      !installMapHooks()
    ) {
      setTimeout(
        installMapHooks,
        500
      );
    }

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
