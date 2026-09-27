/* =========================================================
   CLOrad — Radar Smoothing
   Реальное сглаживание радарного растра
   Без blur
   Без смешивания RGB
   Без фейковых цветов
   Оптимизировано для iPhone
   ========================================================= */

(() => {
  "use strict";

  const BUTTON_ID = "cloradSmoothingButton";
  const PANEL_ID = "cloradSmoothingPanel";
  const RANGE_ID = "cloradSmoothingRange";
  const VALUE_ID = "cloradSmoothingValue";

  const STYLE_ID = "cloradSmoothingStyle";

  let smoothingLevel = 0;
  let processing = false;

  /*
     Кэш:
     ключ = исходный URL + уровень сглаживания
  */
  const cache = new Map();

  /*
     Запоминаем оригинальный URL каждого radar image.
  */
  const originalUrls = new WeakMap();

  /*
     ---------------------------------------------------------
     PALETTE
     ---------------------------------------------------------
  */

  function readPalette() {
    const result = [];

    for (let i = 1; i <= 19; i++) {
      const el = document.querySelector(".l" + i);

      if (!el) continue;

      const color = getComputedStyle(el).backgroundColor;

      const match = color.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/i
      );

      if (!match) continue;

      result.push([
        Number(match[1]),
        Number(match[2]),
        Number(match[3])
      ]);
    }

    /*
       Если легенда ещё не загрузилась,
       используем базовую РГМЦ-палитру.
    */
    if (result.length !== 19) {
      return [
        [185, 193, 199],
        [169, 199, 244],
        [99, 237, 165],
        [67, 207, 137],
        [77, 184, 78],
        [255, 248, 156],
        [117, 166, 239],
        [82, 121, 237],
        [80, 74, 155],
        [255, 192, 168],
        [250, 130, 160],
        [255, 77, 77],
        [219, 146, 72],
        [173, 117, 68],
        [146, 75, 72],
        [242, 170, 240],
        [232, 90, 231],
        [202, 60, 199],
        [119, 124, 145]
      ];
    }

    return result;
  }

  /*
     ---------------------------------------------------------
     COLOR CLASSIFICATION
     ---------------------------------------------------------
  */

  function nearestPaletteIndex(r, g, b, palette) {
    let best = 0;
    let bestDistance = Infinity;

    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];

      const dr = r - p[0];
      const dg = g - p[1];
      const db = b - p[2];

      const d =
        dr * dr +
        dg * dg +
        db * db;

      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }

    return best;
  }

  /*
     ---------------------------------------------------------
     LOAD IMAGE
     ---------------------------------------------------------
  */

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);

      img.onerror = () => reject(
        new Error("Не удалось загрузить radar frame")
      );

      img.decoding = "async";
      img.src = url;
    });
  }

  /*
     ---------------------------------------------------------
     INDEX IMAGE
     ---------------------------------------------------------

     Переводим каждый пиксель в индекс цвета палитры.

     Это делается один раз на обработку.
  */

  function makeIndexMap(data, width, height, palette) {
    const indexes = new Uint8Array(width * height);

    let p = 0;

    for (let i = 0; i < indexes.length; i++) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const a = data[p + 3];

      /*
         Прозрачные области сохраняем специальным индексом 255.
      */
      if (a < 20) {
        indexes[i] = 255;
      } else {
        indexes[i] = nearestPaletteIndex(
          r,
          g,
          b,
          palette
        );
      }

      p += 4;
    }

    return indexes;
  }

  /*
     ---------------------------------------------------------
     REAL SMOOTHING
     ---------------------------------------------------------

     Не размываем цвета.

     Для каждого пикселя смотрим соседей и выбираем
     существующий цвет палитры.

     Чем больше strength — тем сильнее соседние
     цветовые области соединяются.

     Используется только 8 соседей.
  */

  function smoothIndexMap(
    source,
    width,
    height,
    strength
  ) {
    if (strength <= 0) {
      return source;
    }

    const result = new Uint8Array(source);

    /*
       От 1 до 4 проходов.
       Это достаточно заметно, но не убивает
       тонкие радарные структуры.
    */
    let passes = 1;

    if (strength >= 30) passes = 2;
    if (strength >= 60) passes = 3;
    if (strength >= 85) passes = 4;

    /*
       Порог:
       при слабом сглаживании нужно больше соседей,
       чтобы цвет изменился.

       При сильном — меньше.
    */
    let required;

    if (strength < 25) {
      required = 6;
    } else if (strength < 50) {
      required = 5;
    } else if (strength < 75) {
      required = 4;
    } else {
      required = 3;
    }

    let current = source;

    for (let pass = 0; pass < passes; pass++) {
      const next = new Uint8Array(current);

      for (let y = 1; y < height - 1; y++) {
        const row = y * width;

        for (let x = 1; x < width - 1; x++) {
          const pos = row + x;

          const center = current[pos];

          /*
             Прозрачный пиксель не трогаем.
          */
          if (center === 255) continue;

          let counts0 = 0;
          let counts1 = 0;
          let counts2 = 0;
          let counts3 = 0;
          let counts4 = 0;
          let counts5 = 0;
          let counts6 = 0;
          let counts7 = 0;
          let counts8 = 0;
          let counts9 = 0;
          let counts10 = 0;
          let counts11 = 0;
          let counts12 = 0;
          let counts13 = 0;
          let counts14 = 0;
          let counts15 = 0;
          let counts16 = 0;
          let counts17 = 0;
          let counts18 = 0;

          const p1 = pos - width - 1;
          const p2 = pos - width;
          const p3 = pos - width + 1;
          const p4 = pos - 1;
          const p5 = pos + 1;
          const p6 = pos + width - 1;
          const p7 = pos + width;
          const p8 = pos + width + 1;

          const a = current[p1];
          const b = current[p2];
          const c = current[p3];
          const d = current[p4];
          const e = current[p5];
          const f = current[p6];
          const g = current[p7];
          const h = current[p8];

          if (a === 0) counts0++;
          else if (a === 1) counts1++;
          else if (a === 2) counts2++;
          else if (a === 3) counts3++;
          else if (a === 4) counts4++;
          else if (a === 5) counts5++;
          else if (a === 6) counts6++;
          else if (a === 7) counts7++;
          else if (a === 8) counts8++;
          else if (a === 9) counts9++;
          else if (a === 10) counts10++;
          else if (a === 11) counts11++;
          else if (a === 12) counts12++;
          else if (a === 13) counts13++;
          else if (a === 14) counts14++;
          else if (a === 15) counts15++;
          else if (a === 16) counts16++;
          else if (a === 17) counts17++;
          else if (a === 18) counts18++;

          if (b === 0) counts0++;
          else if (b === 1) counts1++;
          else if (b === 2) counts2++;
          else if (b === 3) counts3++;
          else if (b === 4) counts4++;
          else if (b === 5) counts5++;
          else if (b === 6) counts6++;
          else if (b === 7) counts7++;
          else if (b === 8) counts8++;
          else if (b === 9) counts9++;
          else if (b === 10) counts10++;
          else if (b === 11) counts11++;
          else if (b === 12) counts12++;
          else if (b === 13) counts13++;
          else if (b === 14) counts14++;
          else if (b === 15) counts15++;
          else if (b === 16) counts16++;
          else if (b === 17) counts17++;
          else if (b === 18) counts18++;

          if (c === 0) counts0++;
          else if (c === 1) counts1++;
          else if (c === 2) counts2++;
          else if (c === 3) counts3++;
          else if (c === 4) counts4++;
          else if (c === 5) counts5++;
          else if (c === 6) counts6++;
          else if (c === 7) counts7++;
          else if (c === 8) counts8++;
          else if (c === 9) counts9++;
          else if (c === 10) counts10++;
          else if (c === 11) counts11++;
          else if (c === 12) counts12++;
          else if (c === 13) counts13++;
          else if (c === 14) counts14++;
          else if (c === 15) counts15++;
          else if (c === 16) counts16++;
          else if (c === 17) counts17++;
          else if (c === 18) counts18++;

          if (d === 0) counts0++;
          else if (d === 1) counts1++;
          else if (d === 2) counts2++;
          else if (d === 3) counts3++;
          else if (d === 4) counts4++;
          else if (d === 5) counts5++;
          else if (d === 6) counts6++;
          else if (d === 7) counts7++;
          else if (d === 8) counts8++;
          else if (d === 9) counts9++;
          else if (d === 10) counts10++;
          else if (d === 11) counts11++;
          else if (d === 12) counts12++;
          else if (d === 13) counts13++;
          else if (d === 14) counts14++;
          else if (d === 15) counts15++;
          else if (d === 16) counts16++;
          else if (d === 17) counts17++;
          else if (d === 18) counts18++;

          if (e === 0) counts0++;
          else if (e === 1) counts1++;
          else if (e === 2) counts2++;
          else if (e === 3) counts3++;
          else if (e === 4) counts4++;
          else if (e === 5) counts5++;
          else if (e === 6) counts6++;
          else if (e === 7) counts7++;
          else if (e === 8) counts8++;
          else if (e === 9) counts9++;
          else if (e === 10) counts10++;
          else if (e === 11) counts11++;
          else if (e === 12) counts12++;
          else if (e === 13) counts13++;
          else if (e === 14) counts14++;
          else if (e === 15) counts15++;
          else if (e === 16) counts16++;
          else if (e === 17) counts17++;
          else if (e === 18) counts18++;

          if (f === 0) counts0++;
          else if (f === 1) counts1++;
          else if (f === 2) counts2++;
          else if (f === 3) counts3++;
          else if (f === 4) counts4++;
          else if (f === 5) counts5++;
          else if (f === 6) counts6++;
          else if (f === 7) counts7++;
          else if (f === 8) counts8++;
          else if (f === 9) counts9++;
          else if (f === 10) counts10++;
          else if (f === 11) counts11++;
          else if (f === 12) counts12++;
          else if (f === 13) counts13++;
          else if (f === 14) counts14++;
          else if (f === 15) counts15++;
          else if (f === 16) counts16++;
          else if (f === 17) counts17++;
          else if (f === 18) counts18++;

          if (g === 0) counts0++;
          else if (g === 1) counts1++;
          else if (g === 2) counts2++;
          else if (g === 3) counts3++;
          else if (g === 4) counts4++;
          else if (g === 5) counts5++;
          else if (g === 6) counts6++;
          else if (g === 7) counts7++;
          else if (g === 8) counts8++;
          else if (g === 9) counts9++;
          else if (g === 10) counts10++;
          else if (g === 11) counts11++;
          else if (g === 12) counts12++;
          else if (g === 13) counts13++;
          else if (g === 14) counts14++;
          else if (g === 15) counts15++;
          else if (g === 16) counts16++;
          else if (g === 17) counts17++;
          else if (g === 18) counts18++;

          if (h === 0) counts0++;
          else if (h === 1) counts1++;
          else if (h === 2) counts2++;
          else if (h === 3) counts3++;
          else if (h === 4) counts4++;
          else if (h === 5) counts5++;
          else if (h === 6) counts6++;
          else if (h === 7) counts7++;
          else if (h === 8) counts8++;
          else if (h === 9) counts9++;
          else if (h === 10) counts10++;
          else if (h === 11) counts11++;
          else if (h === 12) counts12++;
          else if (h === 13) counts13++;
          else if (h === 14) counts14++;
          else if (h === 15) counts15++;
          else if (h === 16) counts16++;
          else if (h === 17) counts17++;
          else if (h === 18) counts18++;

          let best = center;
          let bestCount = 0;

          if (counts0 > bestCount) {
            best = 0;
            bestCount = counts0;
          }

          if (counts1 > bestCount) {
            best = 1;
            bestCount = counts1;
          }

          if (counts2 > bestCount) {
            best = 2;
            bestCount = counts2;
          }

          if (counts3 > bestCount) {
            best = 3;
            bestCount = counts3;
          }

          if (counts4 > bestCount) {
            best = 4;
            bestCount = counts4;
          }

          if (counts5 > bestCount) {
            best = 5;
            bestCount = counts5;
          }

          if (counts6 > bestCount) {
            best = 6;
            bestCount = counts6;
          }

          if (counts7 > bestCount) {
            best = 7;
            bestCount = counts7;
          }

          if (counts8 > bestCount) {
            best = 8;
            bestCount = counts8;
          }

          if (counts9 > bestCount) {
            best = 9;
            bestCount = counts9;
          }

          if (counts10 > bestCount) {
            best = 10;
            bestCount = counts10;
          }

          if (counts11 > bestCount) {
            best = 11;
            bestCount = counts11;
          }

          if (counts12 > bestCount) {
            best = 12;
            bestCount = counts12;
          }

          if (counts13 > bestCount) {
            best = 13;
            bestCount = counts13;
          }

          if (counts14 > bestCount) {
            best = 14;
            bestCount = counts14;
          }

          if (counts15 > bestCount) {
            best = 15;
            bestCount = counts15;
          }

          if (counts16 > bestCount) {
            best = 16;
            bestCount = counts16;
          }

          if (counts17 > bestCount) {
            best = 17;
            bestCount = counts17;
          }

          if (counts18 > bestCount) {
            best = 18;
            bestCount = counts18;
          }

          /*
             Меняем пиксель только если новый цвет
             действительно имеет достаточную поддержку.

             Это не даёт случайным цветам
             расползаться по карте.
          */
          if (
            best !== center &&
            bestCount >= required
          ) {
            next[pos] = best;
          }
        }
      }

      current = next;
    }

    return current;
  }

  /*
     ---------------------------------------------------------
     RENDER
     ---------------------------------------------------------
  */

  function renderIndexMap(
    indexes,
    width,
    height,
    palette
  ) {
    /*
       Рендерим в 2x.

       Это делает границы визуально более плавными,
       но цвета остаются строго из палитры.
    */

    const scale = 2;

    const canvas = document.createElement("canvas");

    canvas.width = width * scale;
    canvas.height = height * scale;

    const ctx = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: false
    });

    ctx.imageSmoothingEnabled = false;

    const output = ctx.createImageData(
      canvas.width,
      canvas.height
    );

    const out = output.data;

    let p = 0;

    for (let y = 0; y < height; y++) {
      const row = y * width;

      for (let x = 0; x < width; x++) {
        const index = indexes[row + x];

        if (index === 255) {
          p += 16;
          continue;
        }

        const color = palette[index];

        const r = color[0];
        const g = color[1];
        const b = color[2];

        /*
           Один radar-пиксель = блок 2x2.
           Никаких RGB-интерполяций.
        */

        const baseX = x * 2;
        const baseY = y * 2;

        const row1 =
          (baseY * canvas.width + baseX) * 4;

        const row2 =
          ((baseY + 1) * canvas.width + baseX) * 4;

        out[row1] = r;
        out[row1 + 1] = g;
        out[row1 + 2] = b;
        out[row1 + 3] = 255;

        out[row1 + 4] = r;
        out[row1 + 5] = g;
        out[row1 + 6] = b;
        out[row1 + 7] = 255;

        out[row2] = r;
        out[row2 + 1] = g;
        out[row2 + 2] = b;
        out[row2 + 3] = 255;

        out[row2 + 4] = r;
        out[row2 + 5] = g;
        out[row2 + 6] = b;
        out[row2 + 7] = 255;

        p += 16;
      }
    }

    ctx.putImageData(output, 0, 0);

    return canvas;
  }

  /*
     ---------------------------------------------------------
     PROCESS FRAME
     ---------------------------------------------------------
  */

  async function processImage(image, url) {
    if (!image || !url) return;

    if (smoothingLevel <= 0) {
      image.src = url;
      return;
    }

    const cacheKey =
      url + "::" + smoothingLevel;

    const cached = cache.get(cacheKey);

    if (cached) {
      image.src = cached;
      return;
    }

    if (processing) {
      return;
    }

    processing = true;

    try {
      /*
         Даём Leaflet закончить установку кадра.
      */
      await new Promise(resolve => {
        requestAnimationFrame(resolve);
      });

      const source = await loadImage(url);

      const width = source.naturalWidth || source.width;
      const height = source.naturalHeight || source.height;

      if (!width || !height) {
        return;
      }

      /*
         Защита от случайно огромного изображения.
      */
      if (width * height > 2500000) {
        return;
      }

      const canvas = document.createElement("canvas");

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d", {
        willReadFrequently: true
      });

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

      const imageData =
        ctx.getImageData(
          0,
          0,
          width,
          height
        );

      const palette = readPalette();

      const indexes = makeIndexMap(
        imageData.data,
        width,
        height,
        palette
      );

      const smoothed = smoothIndexMap(
        indexes,
        width,
        height,
        smoothingLevel
      );

      const resultCanvas =
        renderIndexMap(
          smoothed,
          width,
          height,
          palette
        );

      /*
         Сохраняем PNG только после полного
         завершения обработки.
      */
      const resultURL =
        resultCanvas.toDataURL(
          "image/png"
        );

      cache.set(
        cacheKey,
        resultURL
      );

      /*
         Не заменяем кадр, если пользователь
         уже переключил его во время обработки.
      */
      if (
        image &&
        image.isConnected &&
        originalUrls.get(image) === url
      ) {
        image.src = resultURL;
      }

    } catch (error) {
      console.warn(
        "CLOrad smoothing:",
        error
      );
    } finally {
      processing = false;
    }
  }

  /*
     ---------------------------------------------------------
     FRAME HOOK
     ---------------------------------------------------------
  */

  function onNewFrame(image, url) {
    if (!image || !url) return;

    originalUrls.set(
      image,
      url
    );

    /*
       При 0% оставляем оригинальный радар.
    */
    if (smoothingLevel <= 0) {
      image.src = url;
      return;
    }

    /*
       Обработка только нового кадра.
       Никаких MutationObserver.
    */
    processImage(
      image,
      url
    );
  }

  /*
     ---------------------------------------------------------
     PATCH LEAFLET SETURL
     ---------------------------------------------------------
  */

  function installLeafletHook() {
    if (
      !window.L ||
      !L.ImageOverlay ||
      !L.ImageOverlay.prototype
    ) {
      return false;
    }

    if (
      L.ImageOverlay.prototype.__cloradSmoothingHook
    ) {
      return true;
    }

    const originalSetUrl =
      L.ImageOverlay.prototype.setUrl;

    L.ImageOverlay.prototype.setUrl =
      function(url) {
        const result =
          originalSetUrl.call(
            this,
            url
          );

        const image = this._image;

        if (
          image &&
          image.classList &&
          image.classList.contains(
            "clorad-gif-radar-image"
          )
        ) {
          onNewFrame(
            image,
            url
          );
        }

        return result;
      };

    L.ImageOverlay.prototype.__cloradSmoothingHook =
      true;

    return true;
  }

  /*
     ---------------------------------------------------------
     FIND CURRENT RADAR IMAGE
     ---------------------------------------------------------
  */

  function getRadarImage() {
    return document.querySelector(
      "img.clorad-gif-radar-image"
    );
  }

  /*
     ---------------------------------------------------------
     APPLY LEVEL
     ---------------------------------------------------------
  */

  function applyLevel(value) {
    const level = Math.max(
      0,
      Math.min(
        100,
        Number(value) || 0
      )
    );

    smoothingLevel = level;

    const label =
      document.getElementById(
        VALUE_ID
      );

    if (label) {
      label.textContent =
        level + "%";
    }

    /*
       При 0% очищаем обработанные изображения.
    */
    if (level === 0) {
      const image =
        getRadarImage();

      if (image) {
        const original =
          originalUrls.get(image);

        if (original) {
          image.src = original;
        }
      }

      return;
    }

    /*
       Чистим старый кэш при сильном изменении
       настройки, чтобы не держать много PNG
       в памяти iPhone.
    */
    if (cache.size > 6) {
      cache.clear();
    }

    const image =
      getRadarImage();

    if (!image) return;

    const original =
      originalUrls.get(image) ||
      image.src;

    originalUrls.set(
      image,
      original
    );

    processImage(
      image,
      original
    );
  }

  /*
     ---------------------------------------------------------
     UI
     ---------------------------------------------------------
  */

  function createUI() {
    if (
      document.getElementById(
        BUTTON_ID
      )
    ) {
      return;
    }

    /*
       Ищем существующий контейнер настроек.
       Кнопка добавляется именно туда,
       а не создаётся отдельной плавающей панелью.
    */

    const container =
      document.getElementById(
        "framesSetting"
      ) ||
      document.getElementById(
        "gifResolutionSetting"
      ) ||
      document.getElementById(
        "settings"
      );

    if (!container) {
      return;
    }

    if (
      document.getElementById(
        STYLE_ID
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      STYLE_ID;

    style.textContent = `
      #${BUTTON_ID} {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        box-sizing:border-box;
        height:36px;
        min-height:36px;
        padding:0 12px;
        margin:0;
        border:1px solid rgba(255,255,255,.14);
        border-radius:9px;
        background:rgba(255,255,255,.07);
        color:#fff;
        font:inherit;
        font-size:13px;
        line-height:1;
        white-space:nowrap;
        -webkit-tap-highlight-color:transparent;
        touch-action:manipulation;
      }

      #${BUTTON_ID}:active {
        background:rgba(255,255,255,.14);
      }

      #${PANEL_ID} {
        display:none;
        width:100%;
        box-sizing:border-box;
        align-items:center;
        gap:8px;
        margin-top:8px;
        padding:8px 10px;
        border-radius:9px;
        background:rgba(255,255,255,.055);
      }

      #${PANEL_ID}.open {
        display:flex;
      }

      #${RANGE_ID} {
        flex:1;
        min-width:80px;
        width:100%;
        height:28px;
        margin:0;
        padding:0;
        accent-color:#63eda5;
        touch-action:pan-x;
      }

      #${VALUE_ID} {
        width:38px;
        flex:0 0 38px;
        text-align:right;
        color:rgba(255,255,255,.78);
        font-size:12px;
        font-variant-numeric:tabular-nums;
      }

      #${PANEL_ID}::before {
        content:"0";
        color:rgba(255,255,255,.45);
        font-size:11px;
      }

      #${PANEL_ID}::after {
        content:"100";
        color:rgba(255,255,255,.45);
        font-size:11px;
      }
    `;

    document.head.appendChild(
      style
    );

    /*
       Кнопка.
    */

    const button =
      document.createElement(
        "button"
      );

    button.id =
      BUTTON_ID;

    button.type =
      "button";

    button.textContent =
      "Сглаживание";

    /*
       Ряд кнопок:
       если родитель уже flex —
       кнопка нормально встанет рядом.
    */
    const buttonRow =
      document.createElement(
        "div"
      );

    buttonRow.style.display =
      "flex";

    buttonRow.style.flexWrap =
      "wrap";

    buttonRow.style.alignItems =
      "center";

    buttonRow.style.gap =
      "6px";

    buttonRow.appendChild(
      button
    );

    container.appendChild(
      buttonRow
    );

    /*
       Панель ползунка.
    */

    const panel =
      document.createElement(
        "div"
      );

    panel.id =
      PANEL_ID;

    const range =
      document.createElement(
        "input"
      );

    range.id =
      RANGE_ID;

    range.type =
      "range";

    range.min =
      "0";

    range.max =
      "100";

    range.step =
      "1";

    range.value =
      "0";

    range.setAttribute(
      "aria-label",
      "Сила сглаживания"
    );

    const value =
      document.createElement(
        "span"
      );

    value.id =
      VALUE_ID;

    value.textContent =
      "0%";

    panel.appendChild(
      range
    );

    panel.appendChild(
      value
    );

    container.appendChild(
      panel
    );

    /*
       Открыть / закрыть шкалу.
    */

    button.addEventListener(
      "click",
      () => {
        panel.classList.toggle(
          "open"
        );
      }
    );

    /*
       Во время движения пальца
       меняем только цифру.

       Тяжёлую обработку НЕ запускаем.
       Поэтому iPhone не будет зависать
       при перетаскивании.
    */

    range.addEventListener(
      "input",
      () => {
        value.textContent =
          range.value + "%";
      }
    );

    /*
       Обработка запускается один раз
       после отпускания ползунка.
    */

    range.addEventListener(
      "change",
      () => {
        applyLevel(
          range.value
        );
      }
    );

    /*
       Начальное значение.
    */

    smoothingLevel = 0;
  }

  /*
     ---------------------------------------------------------
     INITIALIZATION
     ---------------------------------------------------------
  */

  function init() {
    installLeafletHook();

    createUI();

    /*
       Leaflet может загрузиться чуть позже.
    */
    if (
      !window.L ||
      !L.ImageOverlay
    ) {
      setTimeout(
        init,
        300
      );

      return;
    }

    /*
       Повторная попытка установки hook,
       если Leaflet появился позже.
    */
    installLeafletHook();
  }

  /*
     ---------------------------------------------------------
     PUBLIC API
     ---------------------------------------------------------
  */

  window.CLOradRadarSmoothing = {
    setLevel: applyLevel,

    getLevel() {
      return smoothingLevel;
    },

    onNewFrame(
      image,
      url
    ) {
      onNewFrame(
        image,
        url
      );
    },

    clearCache() {
      cache.clear();
    }
  };

  /*
     ---------------------------------------------------------
     START
     ---------------------------------------------------------
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

})();
