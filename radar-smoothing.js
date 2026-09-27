/* =========================================================
   CLOrad — Data Aware Radar Smoothing
   Интерполяция исходных радарных значений

   НЕ blur.
   НЕ перекрывает соседние данные.
   Каждый исходный пиксель сохраняет своё значение
   в центре ячейки, а промежутки рассчитываются
   интерполяцией соседних радарных значений.
   ========================================================= */

(() => {
  "use strict";

  const SETTING_ID =
    "cloradRadarSmoothingSetting";

  const STYLE_ID =
    "cloradRadarSmoothingStyle";

  const STORAGE_KEY =
    "cloradRadarSmoothing";

  const DEFAULT_LEVEL = 55;

  /*
     Максимальное увеличение разрешения
     обрабатываемого радарного поля.

     1 = без интерполяции
     2 = 2x
     3 = 3x
     4 = 4x
  */
  const MAX_SCALE = 4;

  let smoothingLevel =
    DEFAULT_LEVEL;

  let processing =
    false;

  let processTimer =
    null;

  /*
     Для каждого Leaflet <img>
     запоминаем URL исходного кадра.
  */
  const processedSources =
    new WeakMap();

  /* =======================================================
     LOCAL STORAGE
     ======================================================= */

  function loadLevel() {
    try {
      const value =
        Number(
          localStorage.getItem(
            STORAGE_KEY
          )
        );

      if (
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 100
      ) {
        smoothingLevel =
          Math.round(value);
      }
    } catch (
      error
    ) {}
  }

  function saveLevel() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        String(
          smoothingLevel
        )
      );
    } catch (
      error
    ) {}
  }

  /* =======================================================
     SCALE
     ======================================================= */

  function getScale() {
    if (
      smoothingLevel <= 0
    ) {
      return 1;
    }

    if (
      smoothingLevel < 30
    ) {
      return 2;
    }

    if (
      smoothingLevel < 65
    ) {
      return 3;
    }

    return MAX_SCALE;
  }

  /* =======================================================
     PALETTE FROM CLORAD LEGEND
     ======================================================= */

  function readPalette() {
    const colors =
      [];

    for (
      let i = 1;
      i <= 19;
      i++
    ) {
      const element =
        document.querySelector(
          ".l" + i
        );

      if (
        !element
      ) {
        return null;
      }

      const color =
        getComputedStyle(
          element
        ).backgroundColor;

      const match =
        color.match(
          /rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/
        );

      if (
        !match
      ) {
        return null;
      }

      colors.push({
        r:
          Number(
            match[1]
          ),

        g:
          Number(
            match[2]
          ),

        b:
          Number(
            match[3]
          )
      });
    }

    return colors;
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

    return (
      dr * dr * 0.30 +
      dg * dg * 0.59 +
      db * db * 0.11
    );
  }

  /* =======================================================
     FIND RADAR CLASS
     ======================================================= */

  function nearestPaletteIndex(
    r,
    g,
    b,
    palette
  ) {
    let best =
      0;

    let distance =
      Infinity;

    for (
      let i = 0;
      i < palette.length;
      i++
    ) {
      const current =
        colorDistance(
          r,
          g,
          b,
          palette[i]
        );

      if (
        current <
        distance
      ) {
        distance =
          current;

        best =
          i;
      }
    }

    return best;
  }

  /* =======================================================
     INTERPOLATION
     ======================================================= */

  function interpolate(
    a,
    b,
    t
  ) {
    return (
      a +
      (
        b - a
      ) * t
    );
  }

  /*
     Получаем значение поля между
     четырьмя соседними радарными ячейками.

     Это именно интерполяция данных,
     а не размытие изображения.
  */
  function bilinear(
    v00,
    v10,
    v01,
    v11,
    fx,
    fy
  ) {
    const top =
      interpolate(
        v00,
        v10,
        fx
      );

    const bottom =
      interpolate(
        v01,
        v11,
        fx
      );

    return interpolate(
      top,
      bottom,
      fy
    );
  }

  /* =======================================================
     ROUNDED RADAR FIELD
     ======================================================= */

  async function createSmoothedRadar(
    img
  ) {
    if (
      smoothingLevel <= 0
    ) {
      return null;
    }

    if (
      !img ||
      !img.naturalWidth ||
      !img.naturalHeight
    ) {
      return null;
    }

    const palette =
      readPalette();

    if (
      !palette ||
      palette.length !== 19
    ) {
      return null;
    }

    const sourceWidth =
      img.naturalWidth;

    const sourceHeight =
      img.naturalHeight;

    /*
       Не обрабатываем каждый прозрачный
       пиксель как значение 0.

       -1 означает отсутствие радара.
    */
    const source =
      new Float32Array(
        sourceWidth *
        sourceHeight
      );

    source.fill(
      -1
    );

    const sourceCanvas =
      document.createElement(
        "canvas"
      );

    sourceCanvas.width =
      sourceWidth;

    sourceCanvas.height =
      sourceHeight;

    const sourceCtx =
      sourceCanvas.getContext(
        "2d",
        {
          willReadFrequently:
            true
        }
      );

    if (
      !sourceCtx
    ) {
      return null;
    }

    sourceCtx.clearRect(
      0,
      0,
      sourceWidth,
      sourceHeight
    );

    sourceCtx.drawImage(
      img,
      0,
      0,
      sourceWidth,
      sourceHeight
    );

    let imageData;

    try {
      imageData =
        sourceCtx.getImageData(
          0,
          0,
          sourceWidth,
          sourceHeight
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

    const data =
      imageData.data;

    /*
       Восстанавливаем числовое
       значение радарного класса
       из цвета.

       0 ... 18
       = 19 классов ОЯ.
    */
    for (
      let y = 0;
      y < sourceHeight;
      y++
    ) {
      for (
        let x = 0;
        x < sourceWidth;
        x++
      ) {
        const p =
          (
            y *
            sourceWidth +
            x
          ) * 4;

        const alpha =
          data[p + 3];

        if (
          alpha < 20
        ) {
          continue;
        }

        source[
          y *
            sourceWidth +
            x
        ] =
          nearestPaletteIndex(
            data[p],
            data[p + 1],
            data[p + 2],
            palette
          );
      }
    }

    /*
       Нулевой уровень:
       оригинальные данные без изменений.
    */
    if (
      smoothingLevel <= 0
    ) {
      return null;
    }

    /*
       Чем выше уровень,
       тем больше промежуточных
       точек рассчитывается.
    */
    const scale =
      getScale();

    const outputWidth =
      sourceWidth *
      scale;

    const outputHeight =
      sourceHeight *
      scale;

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
        "2d",
        {
          willReadFrequently:
            false
        }
      );

    if (
      !ctx
    ) {
      return null;
    }

    const output =
      ctx.createImageData(
        outputWidth,
        outputHeight
      );

    const out =
      output.data;

    /*
       Для каждого нового пикселя
       рассчитываем положение
       относительно исходной
       радарной сетки.
    */
    for (
      let y = 0;
      y < outputHeight;
      y++
    ) {
      /*
         Центры исходных ячеек
         находятся на 0.5, 1.5,
         2.5...
      */
      const sourceY =
        (
          y + 0.5
        ) / scale -
        0.5;

      const y0 =
        Math.floor(
          sourceY
        );

      const fy =
        sourceY -
        y0;

      const yA =
        Math.max(
          0,
          Math.min(
            sourceHeight - 1,
            y0
          )
        );

      const yB =
        Math.max(
          0,
          Math.min(
            sourceHeight - 1,
            y0 + 1
          )
        );

      for (
        let x = 0;
        x < outputWidth;
        x++
      ) {
        const sourceX =
          (
            x + 0.5
          ) / scale -
          0.5;

        const x0 =
          Math.floor(
            sourceX
          );

        const fx =
          sourceX -
          x0;

        const xA =
          Math.max(
            0,
            Math.min(
              sourceWidth - 1,
              x0
            )
          );

        const xB =
          Math.max(
            0,
            Math.min(
              sourceWidth - 1,
              x0 + 1
            )
          );

        const v00 =
          source[
            yA *
              sourceWidth +
              xA
          ];

        const v10 =
          source[
            yA *
              sourceWidth +
              xB
          ];

        const v01 =
          source[
            yB *
              sourceWidth +
              xA
          ];

        const v11 =
          source[
            yB *
              sourceWidth +
              xB
          ];

        const index =
          (
            y *
              outputWidth +
            x
          ) * 4;

        /*
           Если все соседние
           точки отсутствуют —
           оставляем прозрачность.
        */
        if (
          v00 < 0 &&
          v10 < 0 &&
          v01 < 0 &&
          v11 < 0
        ) {
          out[
            index + 3
          ] = 0;

          continue;
        }

        /*
           Для границы радара
           отсутствующие точки
           НЕ превращаем в нулевую
           интенсивность.

           Берём только реальные
           соседние данные.
        */
        let sum =
          0;

        let weight =
          0;

        const values = [
          [v00, (1 - fx) * (1 - fy)],
          [v10, fx * (1 - fy)],
          [v01, (1 - fx) * fy],
          [v11, fx * fy]
        ];

        for (
          let i = 0;
          i < values.length;
          i++
        ) {
          const value =
            values[i][0];

          const w =
            values[i][1];

          if (
            value >= 0 &&
            w > 0
          ) {
            sum +=
              value * w;

            weight +=
              w;
          }
        }

        if (
          weight <= 0
        ) {
          out[
            index + 3
          ] = 0;

          continue;
        }

        const value =
          sum /
          weight;

        /*
           Сохраняем реальное значение
           в центре каждой исходной
           ячейки.

           Благодаря этому сглаживание
           не уничтожает исходные данные.
        */
        const clamped =
          Math.max(
            0,
            Math.min(
              18,
              value
            )
          );

        const low =
          Math.floor(
            clamped
          );

        const high =
          Math.min(
            18,
            low + 1
          );

        const colorA =
          palette[
            low
          ];

        const colorB =
          palette[
            high
          ];

        const amount =
          clamped -
          low;

        out[index] =
          Math.round(
            interpolate(
              colorA.r,
              colorB.r,
              amount
            )
          );

        out[index + 1] =
          Math.round(
            interpolate(
              colorA.g,
              colorB.g,
              amount
            )
          );

        out[index + 2] =
          Math.round(
            interpolate(
              colorA.b,
              colorB.b,
              amount
            )
          );

        /*
           На границе данных
           сохраняем прозрачность,
           пропорциональную наличию
           реальных радарных соседей.
        */
        const alpha =
          Math.max(
            0,
            Math.min(
              1,
              weight
            )
          );

        out[index + 3] =
          Math.round(
            255 * alpha
          );
      }
    }

    ctx.putImageData(
      output,
      0,
      0
    );

    return canvas.toDataURL(
      "image/png"
    );
  }

  /* =======================================================
     PROCESS LEAFLET IMAGE
     ======================================================= */

  async function processImage(
    img
  ) {
    if (
      !img ||
      !img.classList.contains(
        "clorad-gif-radar-image"
      )
    ) {
      return;
    }

    if (
      smoothingLevel <= 0
    ) {
      return;
    }

    if (
      !img.complete ||
      !img.naturalWidth
    ) {
      return;
    }

    /*
       Определяем исходный URL
       до замены изображения.
    */
    const sourceUrl =
      img.dataset
        .cloradRadarSource ||
      img.src;

    const processedKey =
      sourceUrl +
      "|" +
      smoothingLevel;

    if (
      processedSources.get(
        img
      ) ===
      processedKey
    ) {
      return;
    }

    if (
      img.dataset
        .cloradSmoothingBusy ===
      "1"
    ) {
      return;
    }

    img.dataset
      .cloradSmoothingBusy =
      "1";

    try {
      const result =
        await createSmoothedRadar(
          img
        );

      /*
         Пока Canvas обрабатывался,
         Leaflet мог переключить
         кадр.
      */
      const currentSource =
        img.dataset
          .cloradRadarSource ||
        img.src;

      if (
        currentSource !==
        sourceUrl
      ) {
        return;
      }

      if (
        result
      ) {
        /*
           Запоминаем исходный
           радарный URL отдельно.
        */
        img.dataset
          .cloradRadarSource =
          sourceUrl;

        img.src =
          result;

        processedSources.set(
          img,
          processedKey
        );
      }

    } catch (
      error
    ) {
      console.error(
        "CLOrad data smoothing:",
        error
      );

    } finally {
      delete img.dataset
        .cloradSmoothingBusy;
    }
  }

  /* =======================================================
     FIND RADAR IMAGES
     ======================================================= */

  function processAll() {
    if (
      smoothingLevel <= 0
    ) {
      return;
    }

    document
      .querySelectorAll(
        "img.clorad-gif-radar-image"
      )
      .forEach(
        img => {
          /*
             Если Leaflet установил
             новый настоящий URL,
             фиксируем его как источник.
          */
          if (
            !img.dataset
              .cloradRadarSource &&
            img.src
          ) {
            img.dataset
              .cloradRadarSource =
              img.src;
          }

          processImage(
            img
          );
        }
      );
  }

  /* =======================================================
     SETTING UI
     ======================================================= */

  function installStyle() {
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
      #${SETTING_ID}
      .clorad-smoothing-row {
        display:flex;
        align-items:center;
        gap:10px;
        width:100%;
      }

      #${SETTING_ID}
      .clorad-smoothing-slider {
        flex:1;
        width:100%;
        accent-color:#72d39b;
      }

      #${SETTING_ID}
      .clorad-smoothing-value {
        min-width:42px;
        text-align:right;
        color:rgba(255,255,255,.68);
        font-size:12px;
        font-variant-numeric:tabular-nums;
      }

      #${SETTING_ID}
      .clorad-smoothing-scale {
        display:flex;
        justify-content:space-between;
        margin-top:3px;
        color:rgba(255,255,255,.38);
        font-size:10px;
      }

      body.light
      #${SETTING_ID}
      .clorad-smoothing-value {
        color:rgba(0,0,0,.58);
      }

      body.light
      #${SETTING_ID}
      .clorad-smoothing-scale {
        color:rgba(0,0,0,.42);
      }
    `;

    document.head.appendChild(
      style
    );
  }

  function updateSetting() {
    const setting =
      document.getElementById(
        SETTING_ID
      );

    if (
      !setting
    ) {
      return;
    }

    const slider =
      setting.querySelector(
        ".clorad-smoothing-slider"
      );

    const value =
      setting.querySelector(
        ".clorad-smoothing-value"
      );

    if (
      slider
    ) {
      slider.value =
        smoothingLevel;
    }

    if (
      value
    ) {
      value.textContent =
        smoothingLevel +
        "%";
    }
  }

  function installSetting() {
    const settings =
      document.getElementById(
        "settings"
      );

    if (
      !settings ||
      document.getElementById(
        SETTING_ID
      )
    ) {
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
        type="button"
        id="cloradSmoothingHead"
      >
        <span>
          Сглаживание радара
        </span>

        <span class="settingArrow">
          ›
        </span>
      </button>

      <div
        class="settingBody"
        id="cloradSmoothingBody"
      >
        <div
          class="clorad-smoothing-row"
        >
          <input
            class="clorad-smoothing-slider"
            type="range"
            min="0"
            max="100"
            step="1"
            value="${smoothingLevel}"
          >

          <span
            class="clorad-smoothing-value"
          >
            ${smoothingLevel}%
          </span>
        </div>

        <div
          class="clorad-smoothing-scale"
        >
          <span>
            Исходное
          </span>

          <span>
            Плавное
          </span>
        </div>
      </div>
    `;

    const resolution =
      document.getElementById(
        "gifResolutionSetting"
      );

    if (
      resolution
    ) {
      resolution.after(
        setting
      );
    } else {
      settings.appendChild(
        setting
      );
    }

    const head =
      document.getElementById(
        "cloradSmoothingHead"
      );

    head?.addEventListener(
      "click",
      event => {
        event.stopPropagation();

        const open =
          setting.classList.contains(
            "open"
          );

        document
          .querySelectorAll(
            ".setting.open"
          )
          .forEach(
            item => {
              if (
                item !==
                setting
              ) {
                item.classList.remove(
                  "open"
                );
              }
            }
          );

        setting.classList.toggle(
          "open",
          !open
        );
      }
    );

    const slider =
      setting.querySelector(
        ".clorad-smoothing-slider"
      );

    slider?.addEventListener(
      "input",
      event => {
        event.stopPropagation();

        smoothingLevel =
          Number(
            event.target.value
          );

        saveLevel();

        updateSetting();

        /*
           Удаляем только кеш
           сглаживания.

           Сам Leaflet layer
           и его географические
           bounds не меняются.
        */
        document
          .querySelectorAll(
            "img.clorad-gif-radar-image"
          )
          .forEach(
            img => {
              processedSources.delete(
                img
              );
            }
          );

        scheduleProcess();
      }
    );

    updateSetting();
  }

  /* =======================================================
     SCHEDULE
     ======================================================= */

  function scheduleProcess() {
    if (
      processTimer
    ) {
      clearTimeout(
        processTimer
      );
    }

    processTimer =
      setTimeout(
        () => {
          processTimer =
            null;

          processAll();
        },
        60
      );
  }

  /* =======================================================
     LEAFLET FRAME CHANGES
     ======================================================= */

  /*
     Следим именно за src.

     Когда gif-radar.js вызывает
     layer.setUrl(...), новый кадр
     автоматически попадает сюда.
  */

  const attributeObserver =
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

          const element =
            mutation.target;

          if (
            element instanceof
              HTMLImageElement &&
            element.classList.contains(
              "clorad-gif-radar-image"
            )
          ) {
            /*
               Новый URL = новый
               радарный кадр.
            */
            processedSources.delete(
              element
            );

            scheduleProcess();
          }
        }
      }
    );

  /* =======================================================
     IMAGE LOAD
     ======================================================= */

  document.addEventListener(
    "load",
    event => {
      const img =
        event.target;

      if (
        img instanceof
          HTMLImageElement &&
        img.classList.contains(
          "clorad-gif-radar-image"
        )
      ) {
        scheduleProcess();
      }
    },
    true
  );

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradSetRadarSmoothing =
    value => {
      smoothingLevel =
        Math.max(
          0,
          Math.min(
            100,
            Math.round(
              Number(value) ||
                0
            )
          )
        );

      saveLevel();

      document
        .querySelectorAll(
          "img.clorad-gif-radar-image"
        )
        .forEach(
          img => {
            processedSources.delete(
              img
            );
          }
        );

      updateSetting();

      scheduleProcess();
    };

  window.CLOradRadarSmoothing =
    () =>
      smoothingLevel;

  /* =======================================================
     INIT
     ======================================================= */

  loadLevel();

  installStyle();

  installSetting();

  /*
     settings может появиться
     после загрузки этого файла.
  */
  const settingsObserver =
    new MutationObserver(
      () => {
        installSetting();
      }
    );

  if (
    document.body
  ) {
    settingsObserver.observe(
      document.body,
      {
        childList:
          true,
        subtree:
          true
      }
    );

    attributeObserver.observe(
      document.body,
      {
        subtree:
          true,
        attributes:
          true,
        attributeFilter:
          [
            "src"
          ]
      }
    );
  }

  scheduleProcess();

})();
