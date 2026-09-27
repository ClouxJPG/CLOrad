/* =========================================================
   CLOrad — Data Aware Radar Smoothing
   Интерполяция исходных радарных значений
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

  const MAX_SCALE = 4;

  let smoothingLevel =
    DEFAULT_LEVEL;

  let processTimer = null;

  const processedSources =
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
     PALETTE
  ======================================================= */

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

      /*
         ВАЖНО:
         здесь именно ОДИН обратный
         слэш перед скобкой.
      */
      const match =
        color.match(
          /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/
        );

      if (!match) {
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
    let best = 0;

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

        best = i;
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

  /* =======================================================
     CREATE SMOOTHED RADAR
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

    const source =
      new Float32Array(
        sourceWidth *
        sourceHeight
      );

    source.fill(-1);

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

    if (!sourceCtx) {
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
    } catch (error) {
      console.error(
        "CLOrad smoothing:",
        error
      );

      return null;
    }

    const data =
      imageData.data;

    /*
       Восстанавливаем
       исходный радарный класс
       каждого непрозрачного
       пикселя.
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

        if (
          data[p + 3] < 20
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
       Интерполируем именно
       числовое радарное поле.

       Это НЕ CSS blur.
       Это НЕ размытие RGB.
    */

    for (
      let y = 0;
      y < outputHeight;
      y++
    ) {
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

        let sum = 0;
        let weight = 0;

        const values = [
          [
            v00,
            (1 - fx) *
            (1 - fy)
          ],
          [
            v10,
            fx *
            (1 - fy)
          ],
          [
            v01,
            (1 - fx) *
            fy
          ],
          [
            v11,
            fx * fy
          ]
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

        /*
           Никаких данных вокруг —
           прозрачность.
        */

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

        const amount =
          clamped -
          low;

        const colorA =
          palette[
            low
          ];

        const colorB =
          palette[
            high
          ];

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

        out[index + 3] = 255;
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
     PROCESS RADAR IMAGE
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

      const currentSource =
        img.dataset
          .cloradRadarSource ||
        img.src;

      /*
         Если GIF уже переключил
         кадр — старый результат
         не устанавливаем.
      */

      if (
        currentSource !==
        sourceUrl
      ) {
        return;
      }

      if (result) {
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

    } catch (error) {
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
     PROCESS ALL
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
     STYLE
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
     UPDATE UI
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
     INSTALL BUTTON
  ======================================================= */

  function installSetting() {
    const settings =
      document.getElementById(
        "settings"
      );

    if (
      !settings
    ) {
      return;
    }

    /*
       Уже установлен.
    */

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
       В ТВОЁМ index.html
       существующая настройка называется
       framesSetting.

       Поэтому вставляем именно
       ПОСЛЕ неё.
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

    /* =====================================================
       OPEN / CLOSE
    ===================================================== */

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

          setting.classList.toggle(
            "open"
          );
        }
      );
    }

    /* =====================================================
       SLIDER
    ===================================================== */

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
                Number(
                  event.target.value
                )
              )
            );

          saveLevel();

          updateSetting();

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

    processTimer =
      setTimeout(
        () => {
          processTimer =
            null;

          processAll();
        },
        100
      );
  }

  /* =======================================================
     WATCH GIF FRAMES
  ======================================================= */

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
               Не считаем собственный
               PNG новым GIF-кадром.
            */

            const source =
              element.dataset
                .cloradRadarSource;

            if (
              source &&
              element.src ===
              source
            ) {
              processedSources.delete(
                element
              );

              scheduleProcess();
            }
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
              Number(value) || 0
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
     На случай, если settings
     появляется позже.
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
