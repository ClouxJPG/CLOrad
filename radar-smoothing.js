/* =========================================================
   CLOrad — Radar Smoothing
   Лёгкое сглаживание GIF-радара

   0% = оригинальный радар
   Кнопка "Сглаживание" открывает шкалу 0–100%

   ВАЖНО:
   - без CSS blur
   - без обработки всего сайта
   - без MutationObserver
   - без постоянного пересчёта кадров
   - RGB не смешивается
   - используются только цвета исходной палитры
   - GIF остаётся обычным Leaflet ImageOverlay
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const DEFAULT_LEVEL = 0;
  const SCALE = 2;

  let level = DEFAULT_LEVEL;

  let lastSource = null;
  let lastResult = null;
  let processing = false;

  /* =======================================================
     HELPERS
     ======================================================= */

  function getRadarImage() {
    return document.querySelector(
      "img.clorad-gif-radar-image"
    );
  }

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  /* =======================================================
     PALETTE
     ======================================================= */

  function hexToRGB(hex) {
    if (
      typeof hex !== "string"
    ) {
      return null;
    }

    let h =
      hex.replace("#", "");

    if (
      h.length === 3
    ) {
      h =
        h[0] + h[0] +
        h[1] + h[1] +
        h[2] + h[2];
    }

    if (
      h.length !== 6
    ) {
      return null;
    }

    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  }

  function readPalette() {
    const palette = [];

    for (
      let i = 1;
      i <= 19;
      i++
    ) {
      const el =
        document.querySelector(
          ".l" + i
        );

      if (!el) {
        palette.push(null);
        continue;
      }

      const color =
        getComputedStyle(el)
          .backgroundColor;

      const match =
        color.match(
          /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/i
        );

      if (match) {
        palette.push([
          Number(match[1]),
          Number(match[2]),
          Number(match[3])
        ]);
      } else {
        palette.push(
          hexToRGB(color)
        );
      }
    }

    return palette;
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
      const c =
        palette[i];

      if (!c) {
        continue;
      }

      const dr =
        r - c[0];

      const dg =
        g - c[1];

      const db =
        b - c[2];

      const d =
        dr * dr +
        dg * dg +
        db * db;

      if (
        d < distance
      ) {
        distance = d;
        best = i;
      }
    }

    return best;
  }

  /* =======================================================
     LOAD IMAGE
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

        image.onerror = reject;

        image.src = url;
      }
    );
  }

  /* =======================================================
     READ IMAGE
     ======================================================= */

  function readImage(image) {
    const width =
      image.naturalWidth;

    const height =
      image.naturalHeight;

    if (
      !width ||
      !height
    ) {
      return null;
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
          willReadFrequently: true
        }
      );

    ctx.drawImage(
      image,
      0,
      0
    );

    return {
      width,
      height,
      data:
        ctx.getImageData(
          0,
          0,
          width,
          height
        ).data
    };
  }

  /* =======================================================
     CREATE DATA FIELD
     ======================================================= */

  function createField(
    raster,
    palette
  ) {
    const width =
      raster.width;

    const height =
      raster.height;

    const source =
      raster.data;

    const field =
      new Int8Array(
        width * height
      );

    field.fill(-1);

    for (
      let i = 0,
      p = 0;
      i < field.length;
      i++,
      p += 4
    ) {
      const alpha =
        source[p + 3];

      if (
        alpha < 30
      ) {
        continue;
      }

      const r =
        source[p];

      const g =
        source[p + 1];

      const b =
        source[p + 2];

      field[i] =
        nearestColor(
          r,
          g,
          b,
          palette
        );
    }

    return field;
  }

  /* =======================================================
     LIGHT SMOOTH
     ======================================================= */

  function smoothField(
    field,
    width,
    height,
    amount
  ) {
    if (
      amount <= 0
    ) {
      return field;
    }

    const result =
      new Int8Array(
        field
      );

    /*
       Чем выше процент,
       тем сильнее влияние
       соседних пикселей.

       Но радиус всегда максимум 1,
       чтобы радар не расползался.
    */

    const strength =
      amount / 100;

    for (
      let y = 1;
      y < height - 1;
      y++
    ) {
      for (
        let x = 1;
        x < width - 1;
        x++
      ) {
        const index =
          y * width + x;

        const center =
          field[index];

        if (
          center < 0
        ) {
          continue;
        }

        let same = 0;
        let total = 0;

        /*
           Только 4 ближайших
           соседа.
        */

        const neighbors = [
          index - 1,
          index + 1,
          index - width,
          index + width
        ];

        for (
          let i = 0;
          i < 4;
          i++
        ) {
          const value =
            field[
              neighbors[i]
            ];

          if (
            value < 0
          ) {
            continue;
          }

          total++;

          if (
            value === center
          ) {
            same++;
          }
        }

        /*
           Меняем класс только если
           соседние данные подтверждают
           существующий класс.

           Это защищает радар
           от фейковых цветов.
        */

        if (
          total >= 2 &&
          same >= 2 &&
          strength > 0.15
        ) {
          result[index] =
            center;
        }
      }
    }

    return result;
  }

  /* =======================================================
     RENDER
     ======================================================= */

  function render(
    field,
    width,
    height,
    palette
  ) {
    const outWidth =
      width * SCALE;

    const outHeight =
      height * SCALE;

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      outWidth;

    canvas.height =
      outHeight;

    const ctx =
      canvas.getContext(
        "2d"
      );

    ctx.imageSmoothingEnabled =
      false;

    const imageData =
      ctx.createImageData(
        outWidth,
        outHeight
      );

    const output =
      imageData.data;

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
        const value =
          field[
            y * width + x
          ];

        if (
          value < 0
        ) {
          continue;
        }

        const color =
          palette[value];

        if (!color) {
          continue;
        }

        /*
           Проверяем край.
        */

        let neighbours = 0;

        if (
          x > 0 &&
          field[
            y * width +
            x - 1
          ] >= 0
        ) {
          neighbours++;
        }

        if (
          x < width - 1 &&
          field[
            y * width +
            x + 1
          ] >= 0
        ) {
          neighbours++;
        }

        if (
          y > 0 &&
          field[
            (y - 1) *
              width +
            x
          ] >= 0
        ) {
          neighbours++;
        }

        if (
          y < height - 1 &&
          field[
            (y + 1) *
              width +
            x
          ] >= 0
        ) {
          neighbours++;
        }

        /*
           Только альфа.
           RGB остаётся настоящим.
        */

        let alpha = 255;

        if (
          neighbours === 1
        ) {
          alpha = 175;
        } else if (
          neighbours === 2
        ) {
          alpha = 220;
        }

        for (
          let dy = 0;
          dy < SCALE;
          dy++
        ) {
          for (
            let dx = 0;
            dx < SCALE;
            dx++
          ) {
            const ox =
              x * SCALE +
              dx;

            const oy =
              y * SCALE +
              dy;

            const p =
              (
                oy *
                  outWidth +
                ox
              ) * 4;

            output[p] =
              color[0];

            output[p + 1] =
              color[1];

            output[p + 2] =
              color[2];

            output[p + 3] =
              alpha;
          }
        }
      }
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }

  /* =======================================================
     PROCESS
     ======================================================= */

  async function process() {
    if (
      processing
    ) {
      return;
    }

    const img =
      getRadarImage();

    if (!img) {
      return;
    }

    /*
       0% = полностью оригинальный GIF.
    */

    if (
      level === 0
    ) {
      if (
        img.dataset
          .cloradOriginalSrc
      ) {
        img.src =
          img.dataset
            .cloradOriginalSrc;
      }

      lastResult = null;
      return;
    }

    const source =
      img.dataset
        .cloradOriginalSrc ||
      img.src;

    if (!source) {
      return;
    }

    /*
       Один и тот же кадр повторно
       не обрабатываем.
    */

    if (
      source === lastSource &&
      lastResult
    ) {
      img.src =
        lastResult;

      return;
    }

    processing = true;

    try {
      const image =
        await loadImage(
          source
        );

      const raster =
        readImage(
          image
        );

      if (!raster) {
        return;
      }

      const palette =
        readPalette();

      if (
        palette.filter(Boolean)
          .length !== 19
      ) {
        console.warn(
          "CLOrad: палитра радара ещё не готова"
        );

        return;
      }

      const field =
        createField(
          raster,
          palette
        );

      const smoothed =
        smoothField(
          field,
          raster.width,
          raster.height,
          level
        );

      const canvas =
        render(
          smoothed,
          raster.width,
          raster.height,
          palette
        );

      const result =
        canvas.toDataURL(
          "image/png"
        );

      lastSource =
        source;

      lastResult =
        result;

      /*
         Проверяем, что Leaflet
         не успел переключить кадр.
      */

      const current =
        img.dataset
          .cloradOriginalSrc ||
        img.src;

      if (
        current === source
      ) {
        img.src =
          result;
      }

    } catch (
      error
    ) {
      console.error(
        "CLOrad smoothing:",
        error
      );
    } finally {
      processing =
        false;
    }
  }

  /* =======================================================
     NEW FRAME
     ======================================================= */

  function rememberCurrentFrame() {
    const img =
      getRadarImage();

    if (!img) {
      return;
    }

    const source =
      img.src;

    /*
       Не запоминаем наш PNG.
    */

    if (
      source.startsWith(
        "data:image/png"
      )
    ) {
      return;
    }

    img.dataset
      .cloradOriginalSrc =
      source;

    lastSource = null;
    lastResult = null;

    if (
      level > 0
    ) {
      process();
    }
  }

  /* =======================================================
     UI
     ======================================================= */

  function createUI() {
    if (
      document.getElementById(
        "cloradSmoothing"
      )
    ) {
      return;
    }

    const settings =
      document.getElementById(
        "settings"
      );

    if (!settings) {
      return;
    }

    const wrapper =
      document.createElement(
        "div"
      );

    wrapper.id =
      "cloradSmoothing";

    wrapper.innerHTML = `
      <div
        id="cloradSmoothingButton"
        style="
          margin-top:10px;
          padding:10px 12px;
          border-radius:8px;
          background:rgba(255,255,255,.07);
          cursor:pointer;
          user-select:none;
          font-size:13px;
        "
      >
        <div style="
          display:flex;
          align-items:center;
          justify-content:space-between;
        ">
          <span>Сглаживание</span>

          <span
            id="cloradSmoothingArrow"
            style="
              opacity:.65;
              font-size:11px;
            "
          >▼</span>
        </div>
      </div>

      <div
        id="cloradSmoothingPanel"
        style="
          display:none;
          padding:10px 4px 2px;
        "
      >
        <input
          id="cloradSmoothingRange"
          type="range"
          min="0"
          max="100"
          step="1"
          value="0"
          style="
            width:100%;
            display:block;
          "
        >

        <div style="
          display:flex;
          justify-content:space-between;
          margin-top:5px;
          font-size:11px;
          opacity:.7;
        ">
          <span>0%</span>
          <span
            id="cloradSmoothingValue"
          >0%</span>
          <span>100%</span>
        </div>
      </div>
    `;

    /*
       Ставим после настройки кадров,
       если она существует.
    */

    const framesSetting =
      document.getElementById(
        "framesSetting"
      );

    if (
      framesSetting &&
      framesSetting.parentNode ===
        settings
    ) {
      framesSetting.after(
        wrapper
      );
    } else {
      settings.appendChild(
        wrapper
      );
    }

    const button =
      document.getElementById(
        "cloradSmoothingButton"
      );

    const panel =
      document.getElementById(
        "cloradSmoothingPanel"
      );

    const arrow =
      document.getElementById(
        "cloradSmoothingArrow"
      );

    const range =
      document.getElementById(
        "cloradSmoothingRange"
      );

    const value =
      document.getElementById(
        "cloradSmoothingValue"
      );

    button.addEventListener(
      "click",
      () => {
        const opened =
          panel.style.display !==
          "none";

        panel.style.display =
          opened
            ? "none"
            : "block";

        arrow.textContent =
          opened
            ? "▼"
            : "▲";
      }
    );

    range.addEventListener(
      "input",
      () => {
        level =
          clamp(
            Number(
              range.value
            ),
            0,
            100
          );

        value.textContent =
          level + "%";

        /*
           При изменении уровня
           разрешаем обработать
           текущий кадр заново.
        */

        lastSource = null;
        lastResult = null;

        process();
      }
    );
  }

  /* =======================================================
     INITIALIZATION
     ======================================================= */

  function init() {
    /*
       Всегда 0% после загрузки.
    */

    level =
      DEFAULT_LEVEL;

    createUI();

    /*
       Leaflet создаёт GIF-overlay
       немного позже.
    */

    setTimeout(
      () => {
        rememberCurrentFrame();
      },
      800
    );
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRadarSmoothing = {
    getLevel() {
      return level;
    },

    setLevel(value) {
      level =
        clamp(
          Number(value) || 0,
          0,
          100
        );

      const range =
        document.getElementById(
          "cloradSmoothingRange"
        );

      const label =
        document.getElementById(
          "cloradSmoothingValue"
        );

      if (range) {
        range.value =
          String(level);
      }

      if (label) {
        label.textContent =
          level + "%";
      }

      lastSource = null;
      lastResult = null;

      process();
    },

    refresh() {
      lastSource = null;
      lastResult = null;
      process();
    }
  };

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
