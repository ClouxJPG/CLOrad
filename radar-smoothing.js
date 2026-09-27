/* =========================================================
   CLOrad — Data Aware Radar Smoothing
   Sharp Data Interpolation

   ВАЖНО:

   1. RGB цветов НИКОГДА не смешивается.
   2. Используются только реальные цвета палитры.
   3. Интерполируется только числовой класс радара 0..18.
   4. После интерполяции значение квантуется
      обратно в один из 19 реальных классов.
   5. На внешней границе сглаживается только alpha.
   6. Никаких blur / filter / CSS transform.
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
     Максимальный масштаб вывода.

     2x достаточно для аккуратной
     субпиксельной границы и намного
     быстрее 4x.
  */
  const OUTPUT_SCALE = 2;

  /*
     Максимальный радиус обработки
     исходного поля.

     Мы НЕ делаем большой blur.
     Поэтому максимум 1 соседняя
     ячейка.
  */
  const MAX_RADIUS = 1;

  /*
     Минимальная доля реальных данных,
     необходимая для заполнения
     промежуточного пикселя.
  */
  const MIN_COVERAGE = 0.42;

  let smoothingLevel =
    DEFAULT_LEVEL;

  let processTimer =
    null;

  let processingGeneration = 0;

  /*
     Состояние каждого Leaflet image.
  */
  const states =
    new WeakMap();

  /* =======================================================
     STORAGE
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
    } catch (error) {}
  }

  function saveLevel() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        String(
          smoothingLevel
        )
      );
    } catch (error) {}
  }

  /* =======================================================
     PALETTE
  ======================================================= */

  function parseCSSColor(
    color
  ) {
    const match =
      String(color).match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/
      );

    if (!match) {
      return null;
    }

    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3])
    };
  }

  function readPalette() {
    const colors = [];

    for (
      let i = 1;
      i <= 19;
      i++
    ) {
      const element =
        document.querySelector(
          ".l" + i
        );

      if (!element) {
        return null;
      }

      const color =
        getComputedStyle(
          element
        ).backgroundColor;

      const parsed =
        parseCSSColor(
          color
        );

      if (!parsed) {
        return null;
      }

      colors.push(
        parsed
      );
    }

    return colors;
  }

  /* =======================================================
     COLOR MATCHING
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

  function nearestPaletteIndex(
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
      const d =
        colorDistance(
          r,
          g,
          b,
          palette[i]
        );

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
     STATE
  ======================================================= */

  function getState(
    img
  ) {
    let state =
      states.get(img);

    if (!state) {
      state = {
        sourceURL: "",
        outputURL: "",
        processing: false,
        generation: 0,
        level: -1
      };

      states.set(
        img,
        state
      );
    }

    return state;
  }

  /* =======================================================
     FIELD CREATION
  ======================================================= */

  function decodeRadarField(
    img,
    palette
  ) {
    const width =
      img.naturalWidth;

    const height =
      img.naturalHeight;

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

    if (!ctx) {
      return null;
    }

    ctx.drawImage(
      img,
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
    } catch (error) {
      return null;
    }

    const pixels =
      imageData.data;

    /*
       Значение:

       -1 = нет данных
       0..18 = реальный класс
    */

    const field =
      new Int8Array(
        width * height
      );

    field.fill(-1);

    /*
       alpha хранится отдельно.
       Это позволит сглаживать только
       геометрическую границу.
    */

    const mask =
      new Uint8Array(
        width * height
      );

    for (
      let i = 0,
          p = 0;
      i < field.length;
      i++,
      p += 4
    ) {
      const alpha =
        pixels[p + 3];

      if (
        alpha < 20
      ) {
        continue;
      }

      field[i] =
        nearestPaletteIndex(
          pixels[p],
          pixels[p + 1],
          pixels[p + 2],
          palette
        );

      mask[i] = 255;
    }

    return {
      width,
      height,
      field,
      mask
    };
  }

  /* =======================================================
     DATA AWARE LOCAL SMOOTHING
  ======================================================= */

  function smoothField(
    fieldData,
    level,
    generation
  ) {
    const {
      width,
      height,
      field
    } = fieldData;

    /*
       При маленьком уровне
       вообще не меняем данные.

       Только интерполируем
       границы при выводе.
    */

    if (
      level < 15
    ) {
      return {
        width,
        height,
        field
      };
    }

    /*
       Сильнее сглаживание =
       немного больше влияние
       соседних реальных ячеек.

       Но радиус всегда максимум 1.
       Это предотвращает "растекание"
       одного значения по карте.
    */

    const strength =
      Math.min(
        0.72,
        0.20 +
        level / 100 * 0.52
      );

    const result =
      new Float32Array(
        field.length
      );

    result.fill(-1);

    /*
       3x3 ядро.

       Центр имеет намного больший
       вес, чем соседи.

       Это сохраняет исходное
       радарное значение.
    */

    const weights = [
      1, 2, 1,
      2, 6, 2,
      1, 2, 1
    ];

    for (
      let y = 0;
      y < height;
      y++
    ) {
      /*
         Проверка поколения позволяет
         отменить старую тяжёлую
         обработку, если пользователь
         быстро двигает slider.
      */

      if (
        generation !==
        processingGeneration
      ) {
        return null;
      }

      for (
        let x = 0;
        x < width;
        x++
      ) {
        const centerIndex =
          y *
            width +
          x;

        const center =
          field[
            centerIndex
          ];

        let sum = 0;
        let weight = 0;
        let possible = 0;

        let wi = 0;

        for (
          let dy = -1;
          dy <= 1;
          dy++
        ) {
          const yy =
            y + dy;

          for (
            let dx = -1;
            dx <= 1;
            dx++
          ) {
            const xx =
              x + dx;

            const w =
              weights[wi++];

            if (
              xx < 0 ||
              xx >= width ||
              yy < 0 ||
              yy >= height
            ) {
              continue;
            }

            possible += w;

            const value =
              field[
                yy *
                  width +
                xx
              ];

            if (
              value >= 0
            ) {
              sum +=
                value * w;

              weight += w;
            }
          }
        }

        /*
           Для реальной ячейки
           всегда сохраняем данные.
        */

        if (
          center >= 0
        ) {
          const averaged =
            weight > 0
              ? sum / weight
              : center;

          result[
            centerIndex
          ] =
            center +
            (
              averaged -
              center
            ) *
            strength;

          continue;
        }

        /*
           Пустые пиксели можно заполнить
           только если вокруг действительно
           достаточно радарных данных.

           Это аккуратно соединяет ячейки,
           но не создаёт огромные пятна.
        */

        if (
          weight > 0 &&
          possible > 0
        ) {
          const coverage =
            weight /
            possible;

          if (
            coverage >=
            MIN_COVERAGE
          ) {
            result[
              centerIndex
            ] =
              sum / weight;
          }
        }
      }
    }

    return {
      width,
      height,
      field: result
    };
  }

  /* =======================================================
     BILINEAR DATA SAMPLE
  ======================================================= */

  function sampleField(
    field,
    width,
    height,
    x,
    y
  ) {
    const x0 =
      Math.floor(x);

    const y0 =
      Math.floor(y);

    const x1 =
      Math.min(
        width - 1,
        x0 + 1
      );

    const y1 =
      Math.min(
        height - 1,
        y0 + 1
      );

    const fx =
      x - x0;

    const fy =
      y - y0;

    const v00 =
      field[
        y0 *
          width +
        x0
      ];

    const v10 =
      field[
        y0 *
          width +
        x1
      ];

    const v01 =
      field[
        y1 *
          width +
        x0
      ];

    const v11 =
      field[
        y1 *
          width +
        x1
      ];

    /*
       Только реальные значения
       участвуют в интерполяции.
    */

    let sum = 0;
    let weight = 0;

    const w00 =
      (1 - fx) *
      (1 - fy);

    const w10 =
      fx *
      (1 - fy);

    const w01 =
      (1 - fx) *
      fy;

    const w11 =
      fx * fy;

    if (
      v00 >= 0
    ) {
      sum +=
        v00 * w00;

      weight +=
        w00;
    }

    if (
      v10 >= 0
    ) {
      sum +=
        v10 * w10;

      weight +=
        w10;
    }

    if (
      v01 >= 0
    ) {
      sum +=
        v01 * w01;

      weight +=
        w01;
    }

    if (
      v11 >= 0
    ) {
      sum +=
        v11 * w11;

      weight +=
        w11;
    }

    if (
      weight <= 0
    ) {
      return {
        value: -1,
        coverage: 0
      };
    }

    return {
      value:
        sum / weight,

      coverage:
        weight
    };
  }

  /* =======================================================
     RENDER
  ======================================================= */

  function renderRadar(
    fieldData,
    palette,
    level,
    generation
  ) {
    const {
      width,
      height,
      field
    } = fieldData;

    const scale =
      level <= 0
        ? 1
        : OUTPUT_SCALE;

    const outputWidth =
      width *
      scale;

    const outputHeight =
      height *
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
        "2d"
      );

    if (!ctx) {
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
       Порог антиалиасинга.

       RGB всё равно остаётся
       одним из 19 цветов.

       Сглаживается только alpha.
    */

    const edgeThreshold =
      0.18;

    for (
      let y = 0;
      y < outputHeight;
      y++
    ) {
      if (
        generation !==
        processingGeneration
      ) {
        return null;
      }

      const sourceY =
        (
          y + 0.5
        ) / scale -
        0.5;

      const safeY =
        Math.max(
          0,
          Math.min(
            height - 1,
            sourceY
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

        const safeX =
          Math.max(
            0,
            Math.min(
              width - 1,
              sourceX
            )
          );

        const sampled =
          sampleField(
            field,
            width,
            height,
            safeX,
            safeY
          );

        const index =
          (
            y *
              outputWidth +
            x
          ) * 4;

        if (
          sampled.value < 0 ||
          sampled.coverage <=
            edgeThreshold
        ) {
          out[
            index + 3
          ] = 0;

          continue;
        }

        /*
           КЛЮЧЕВОЕ ОТЛИЧИЕ:

           Мы НЕ делаем:

             RGB = lerp(colorA,colorB)

           Вместо этого выбираем
           ближайший реальный класс.

           Поэтому новых цветов
           физически не возникает.
        */

        let radarClass =
          Math.round(
            sampled.value
          );

        if (
          radarClass < 0
        ) {
          radarClass = 0;
        }

        if (
          radarClass > 18
        ) {
          radarClass = 18;
        }

        const color =
          palette[
            radarClass
          ];

        out[index] =
          color.r;

        out[index + 1] =
          color.g;

        out[index + 2] =
          color.b;

        /*
           Внутри поля —
           полностью непрозрачный
           настоящий цвет радара.

           На внешнем краю —
           только alpha AA.
        */

        if (
          sampled.coverage >=
          0.999
        ) {
          out[
            index + 3
          ] = 255;
        } else {
          const alpha =
            Math.max(
              0,
              Math.min(
                1,
                (
                  sampled.coverage -
                  edgeThreshold
                ) /
                (
                  1 -
                  edgeThreshold
                )
              )
            );

          out[
            index + 3
          ] =
            Math.round(
              alpha * 255
            );
        }
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
     MAIN PROCESS
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

    const state =
      getState(img);

    /*
       При 0% возвращаем
       настоящий исходный кадр.
    */

    if (
      smoothingLevel <= 0
    ) {
      if (
        state.outputURL &&
        state.sourceURL &&
        img.src ===
          state.outputURL
      ) {
        state.generation++;

        img.src =
          state.sourceURL;

        state.outputURL =
          "";

        state.level =
          0;
      }

      return;
    }

    if (
      state.processing
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
       Если источник ещё не записан,
       запоминаем его.
    */

    if (
      !state.sourceURL
    ) {
      state.sourceURL =
        img.src;
    }

    /*
       Если это наш уже готовый
       результат — повторно его
       не обрабатываем.
    */

    if (
      state.outputURL &&
      img.src ===
        state.outputURL &&
      state.level ===
        smoothingLevel
    ) {
      return;
    }

    const sourceURL =
      state.sourceURL;

    const generation =
      ++state.generation;

    state.processing =
      true;

    try {
      /*
         Загружаем исходный кадр
         отдельным Image.

         Благодаря этому мы НИКОГДА
         не сглаживаем уже сглаженный
         результат.
      */

      const sourceImage =
        new Image();

      sourceImage.decoding =
        "async";

      sourceImage.src =
        sourceURL;

      await new Promise(
        (
          resolve,
          reject
        ) => {
          if (
            sourceImage.complete &&
            sourceImage.naturalWidth
          ) {
            resolve();
            return;
          }

          sourceImage.onload =
            resolve;

          sourceImage.onerror =
            reject;
        }
      );

      if (
        generation !==
        state.generation
      ) {
        return;
      }

      if (
        sourceURL !==
        state.sourceURL
      ) {
        return;
      }

      const palette =
        readPalette();

      if (
        !palette ||
        palette.length !== 19
      ) {
        return;
      }

      /*
         1.
         Декодируем реальные
         радарные классы.
      */

      const decoded =
        decodeRadarField(
          sourceImage,
          palette
        );

      if (!decoded) {
        return;
      }

      /*
         2.
         Локальная интерполяция
         только числовых значений.
      */

      const smoothed =
        smoothField(
          decoded,
          smoothingLevel,
          generation
        );

      if (!smoothed) {
        return;
      }

      /*
         3.
         Рендерим только реальные
         цвета палитры.
      */

      const result =
        renderRadar(
          smoothed,
          palette,
          smoothingLevel,
          generation
        );

      if (!result) {
        return;
      }

      if (
        generation !==
        state.generation
      ) {
        return;
      }

      if (
        sourceURL !==
        state.sourceURL
      ) {
        return;
      }

      /*
         Leaflet ImageOverlay
         остаётся тем же самым.

         Меняется только src.

         bounds не трогаем.
         transform не трогаем.
      */

      state.outputURL =
        result;

      state.level =
        smoothingLevel;

      img.src =
        result;

    } catch (error) {
      /*
         Ошибка одного кадра
         не должна ломать весь CLOrad.
      */

      console.error(
        "CLOrad radar smoothing:",
        error
      );

    } finally {
      state.processing =
        false;
    }
  }

  /* =======================================================
     PROCESS ALL
  ======================================================= */

  function processAll() {
    const images =
      document.querySelectorAll(
        "img.clorad-gif-radar-image"
      );

    images.forEach(
      img => {
        const state =
          getState(img);

        /*
           Если Leaflet поставил
           новый URL — это новый кадр.
        */

        if (
          img.src &&
          state.outputURL &&
          img.src !==
            state.outputURL
        ) {
          state.sourceURL =
            img.src;

          state.outputURL =
            "";

          state.level =
            -1;

          state.generation++;
        }

        /*
           Первый кадр.
        */

        if (
          !state.sourceURL &&
          img.src
        ) {
          state.sourceURL =
            img.src;
        }

        processImage(
          img
        );
      }
    );
  }

  /* =======================================================
     UI STYLE
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
      .clorad-smoothing-row{
        display:flex;
        align-items:center;
        gap:10px;
        width:100%;
      }

      #${SETTING_ID}
      .clorad-smoothing-slider{
        flex:1;
        width:100%;
        accent-color:#72d39b;
      }

      #${SETTING_ID}
      .clorad-smoothing-value{
        min-width:42px;
        text-align:right;
        color:rgba(255,255,255,.68);
        font-size:12px;
        font-variant-numeric:tabular-nums;
      }

      #${SETTING_ID}
      .clorad-smoothing-scale{
        display:flex;
        justify-content:space-between;
        margin-top:3px;
        color:rgba(255,255,255,.38);
        font-size:10px;
      }

      /*
         НИКАКОГО CSS blur.

         Leaflet сам отвечает
         за географическое положение
         imageOverlay.
      */

      img.clorad-gif-radar-image{
        filter:none !important;
        transform:none !important;
      }

      body.light
      #${SETTING_ID}
      .clorad-smoothing-value{
        color:rgba(0,0,0,.58);
      }

      body.light
      #${SETTING_ID}
      .clorad-smoothing-scale{
        color:rgba(0,0,0,.42);
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     UI UPDATE
  ======================================================= */

  function updateSetting() {
    const setting =
      document.getElementById(
        SETTING_ID
      );

    if (!setting) {
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

    if (slider) {
      slider.value =
        smoothingLevel;
    }

    if (value) {
      value.textContent =
        smoothingLevel +
        "%";
    }
  }

  /* =======================================================
     INSTALL SETTING BUTTON
  ======================================================= */

  function installSetting() {
    const settings =
      document.getElementById(
        "settings"
      );

    if (!settings) {
      return;
    }

    if (
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
        id="cloradSmoothingHead"
        type="button"
      >
        <span>
          Сглаживание радара
        </span>

        <span class="settingArrow">
          ›
        </span>
      </button>

      <div class="settingBody">

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

    /*
       В текущем CLOrad эта настройка
       располагается после framesSetting.
    */

    const framesSetting =
      document.getElementById(
        "framesSetting"
      );

    if (
      framesSetting &&
      framesSetting.parentNode
    ) {
      framesSetting.parentNode.insertBefore(
        setting,
        framesSetting.nextSibling
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

    if (head) {
      head.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          const isOpen =
            setting.classList.contains(
              "open"
            );

          document
            .querySelectorAll(
              "#settings .setting.open"
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
            !isOpen
          );
        }
      );
    }

    const slider =
      setting.querySelector(
        ".clorad-smoothing-slider"
      );

    if (slider) {
      slider.addEventListener(
        "input",
        event => {
          event.stopPropagation();

          smoothingLevel =
            Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  Number(
                    event.target.value
                  )
                )
              )
            );

          saveLevel();

          /*
             Полностью отменяем
             старые вычисления.
          */

          processingGeneration++;

          document
            .querySelectorAll(
              "img.clorad-gif-radar-image"
            )
            .forEach(
              img => {
                const state =
                  getState(img);

                state.generation++;

                state.level =
                  -1;
              }
            );

          updateSetting();

          scheduleProcess();
        }
      );
    }

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

    /*
       Небольшая задержка.
       Если slider быстро двигается,
       запускается только последняя
       обработка.
    */

    processTimer =
      setTimeout(
        () => {
          processTimer =
            null;

          processAll();
        },
        120
      );
  }

  /* =======================================================
     WATCH LEAFLET FRAME CHANGES
  ======================================================= */

  const attributeObserver =
    new MutationObserver(
      mutations => {
        let changed = false;

        for (
          const mutation of mutations
        ) {
          if (
            mutation.type !==
            "attributes"
          ) {
            continue;
          }

          const img =
            mutation.target;

          if (
            !(img instanceof
              HTMLImageElement)
          ) {
            continue;
          }

          if (
            !img.classList.contains(
              "clorad-gif-radar-image"
            )
          ) {
            continue;
          }

          const state =
            getState(img);

          /*
             Наш собственный PNG
             не является новым кадром.
          */

          if (
            state.outputURL &&
            img.src ===
              state.outputURL
          ) {
            continue;
          }

          /*
             Leaflet установил
             настоящий новый кадр.
          */

          state.sourceURL =
            img.src;

          state.outputURL =
            "";

          state.level =
            -1;

          state.generation++;

          changed = true;
        }

        if (changed) {
          scheduleProcess();
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
        const state =
          getState(img);

        /*
           Если это результат
           нашего рендера — ничего
           повторно не делаем.
        */

        if (
          state.outputURL &&
          img.src ===
            state.outputURL
        ) {
          return;
        }

        state.sourceURL =
          img.src;

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

      processingGeneration++;

      document
        .querySelectorAll(
          "img.clorad-gif-radar-image"
        )
        .forEach(
          img => {
            const state =
              getState(img);

            state.generation++;
            state.level = -1;
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
     settings существует не всегда
     в момент загрузки скрипта.
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
        childList:true,
        subtree:true
      }
    );

    attributeObserver.observe(
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

  scheduleProcess();

})();
