/* =========================================================
   CLOrad — RADAR GEOMETRIC SMOOTHING
   ---------------------------------------------------------
   Не blur.
   Не смешивание RGB.
   Не изменение радарных значений.

   Алгоритм:
   1. Получаем исходный радарный кадр.
   2. Определяем классы цветов.
   3. Находим границы цветовых областей.
   4. Обрабатываем внутренние и внешние углы.
   5. Строим увеличенную геометрию области.
   6. Рисуем только исходными цветами.
   7. Возвращаем изображение обратно в Leaflet.

   Нагрузка:
   - сервер: отсутствует;
   - обработка: устройство пользователя;
   - кадр обрабатывается только после отпускания ползунка;
   - обработанные кадры кэшируются.
========================================================= */

(() => {

  "use strict";

  /* =======================================================
     CONFIG
  ======================================================= */

  const CONFIG = {

    /* сила сглаживания */
    min: 0,
    max: 100,
    step: 5,
    initial: 0,

    /*
      Увеличение внутреннего canvas.

      1 = минимальная нагрузка
      2 = нормальный режим
      3 = более плавный контур
    */
    resolution: 2,

    /*
      Радиус геометрического сглаживания.
      Не использовать слишком большие значения:
      это резко увеличивает количество операций.
    */
    radius: 1,

    /*
      Количество итераций обработки контура.
    */
    passes: 1,

    /*
      Максимальное количество кадров
      в памяти одновременно.
    */
    cacheLimit: 5,

    /*
      Минимальная площадь области,
      которую имеет смысл сглаживать.
    */
    minRegionPixels: 3,

    /*
      Небольшая задержка перед обработкой.
      Даёт Safari возможность закончить
      предыдущие операции.
    */
    processDelay: 40

  };


  /* =======================================================
     STATE
  ======================================================= */

  let enabled = false;

  let strength =
    CONFIG.initial;

  let processing = false;

  let processTimer = null;

  let currentLayer = null;

  let currentSource = null;

  let currentProcessedURL = null;

  let cache =
    new Map();

  let cacheOrder = [];


  /* =======================================================
     STYLE
  ======================================================= */

  function installStyle(){

    if(
      document.getElementById(
        "clorad-smoothing-style"
      )
    ){

      return;

    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "clorad-smoothing-style";

    style.textContent = `

      #cloradSmoothingButton{

        position:relative;

        width:44px;
        height:44px;

        border:1px solid #35404a;
        border-radius:9px;

        background:#171e24;
        color:#cbd2d7;

        display:grid;
        place-items:center;

        padding:0;

        z-index:2147483646;

      }

      #cloradSmoothingButton.active{

        background:#26332e;
        border-color:#51e29a;
        color:#51e29a;

      }

      #cloradSmoothingButton svg{

        width:24px;
        height:24px;

        fill:none;

        stroke:currentColor;
        stroke-width:1.8;

        stroke-linecap:round;
        stroke-linejoin:round;

      }

      #cloradSmoothingPanel{

        position:fixed;

        left:50%;
        bottom:174px;

        transform:
          translateX(-50%)
          translateY(10px);

        width:
          min(
            520px,
            calc(100vw - 32px)
          );

        height:54px;

        padding:
          0 15px;

        display:flex;

        align-items:center;

        gap:12px;

        background:#11181e;

        border:1px solid #35404a;
        border-radius:11px;

        box-shadow:
          0 8px 30px #0008;

        opacity:0;

        pointer-events:none;

        transition:
          opacity .16s ease,
          transform .16s ease;

        z-index:2147483645;

      }

      #cloradSmoothingPanel.show{

        opacity:1;

        pointer-events:auto;

        transform:
          translateX(-50%)
          translateY(0);

      }

      #cloradSmoothingValue{

        width:43px;

        text-align:center;

        color:#dce2e6;

        font-size:13px;

        font-weight:600;

        flex:none;

      }

      #cloradSmoothingRange{

        width:100%;

        margin:0;

        accent-color:#51e29a;

      }

      #cloradSmoothingStatus{

        position:fixed;

        left:50%;

        bottom:235px;

        transform:translateX(-50%);

        background:#151d23;

        color:#cbd2d7;

        border:1px solid #35404a;

        border-radius:8px;

        padding:7px 11px;

        font-size:11px;

        opacity:0;

        pointer-events:none;

        transition:opacity .15s ease;

        z-index:2147483647;

      }

      #cloradSmoothingStatus.show{

        opacity:1;

      }

      @media(max-width:600px){

        #cloradSmoothingPanel{

          bottom:168px;

          width:
            calc(100vw - 24px);

        }

      }

    `;

    document.head.appendChild(
      style
    );

  }


  /* =======================================================
     UI
  ======================================================= */

  function createUI(){

    installStyle();

    let button =
      document.getElementById(
        "cloradSmoothingButton"
      );

    if(!button){

      button =
        document.createElement(
          "button"
        );

      button.id =
        "cloradSmoothingButton";

      button.type =
        "button";

      button.title =
        "Сглаживание радара";

      button.setAttribute(
        "aria-label",
        "Сглаживание радара"
      );

      button.innerHTML = `

        <svg viewBox="0 0 24 24">

          <path
            d="M4 17
               C7 17 7 11 10 11
               C13 11 13 7 16 7
               C18 7 19 5 20 4"
          />

          <path
            d="M4 20
               C8 20 8 16 11 16
               C14 16 15 12 18 12
               C19 12 20 11 20 10"
          />

        </svg>

      `;

      /*
        Пытаемся поставить кнопку рядом
        с существующими инструментами.
      */

      const candidates = [

        ".tools",

        ".controls",

        ".leftTools",

        "#tools"

      ];

      let parent = null;

      for(
        const selector of candidates
      ){

        const node =
          document.querySelector(
            selector
          );

        if(node){

          parent = node;
          break;

        }

      }

      if(parent){

        parent.appendChild(
          button
        );

      }else{

        button.style.position =
          "fixed";

        button.style.left =
          "16px";

        button.style.top =
          "110px";

        document.body.appendChild(
          button
        );

      }

    }


    let panel =
      document.getElementById(
        "cloradSmoothingPanel"
      );

    if(!panel){

      panel =
        document.createElement(
          "div"
        );

      panel.id =
        "cloradSmoothingPanel";

      panel.innerHTML = `

        <span
          id="cloradSmoothingValue"
        >
          ${strength}%
        </span>

        <input
          id="cloradSmoothingRange"
          type="range"
          min="${CONFIG.min}"
          max="${CONFIG.max}"
          step="${CONFIG.step}"
          value="${strength}"
        >

      `;

      document.body.appendChild(
        panel
      );

    }


    let status =
      document.getElementById(
        "cloradSmoothingStatus"
      );

    if(!status){

      status =
        document.createElement(
          "div"
        );

      status.id =
        "cloradSmoothingStatus";

      status.textContent =
        "Обработка радара…";

      document.body.appendChild(
        status
      );

    }


    button.onclick =
      () => {

        enabled =
          !enabled;

        button.classList.toggle(
          "active",
          enabled
        );

        panel.classList.toggle(
          "show",
          enabled
        );

        if(enabled){

          if(
            currentLayer
          ){

            scheduleProcess();

          }

        }else{

          restoreOriginal();

        }

      };


    const range =
      document.getElementById(
        "cloradSmoothingRange"
      );

    range.oninput =
      () => {

        strength =
          Number(
            range.value
          );

        document.getElementById(
          "cloradSmoothingValue"
        ).textContent =
          strength + "%";

      };

    /*
      ВАЖНО:
      обработка начинается после отпускания
      пальца, а не на каждом input.
    */

    range.onchange =
      () => {

        if(
          enabled
        ){

          scheduleProcess();

        }

      };

  }


  /* =======================================================
     STATUS
  ======================================================= */

  function showStatus(){

    const element =
      document.getElementById(
        "cloradSmoothingStatus"
      );

    if(!element){
      return;
    }

    element.classList.add(
      "show"
    );

  }


  function hideStatus(){

    const element =
      document.getElementById(
        "cloradSmoothingStatus"
      );

    if(!element){
      return;
    }

    element.classList.remove(
      "show"
    );

  }


  /* =======================================================
     IMAGE LOADING
  ======================================================= */

  function loadImage(
    source
  ){

    return new Promise(
      (resolve,reject) => {

        const image =
          new Image();

        image.crossOrigin =
          "anonymous";

        image.onload =
          () => resolve(
            image
          );

        image.onerror =
          () =>
            reject(
              new Error(
                "Не удалось прочитать радарный кадр"
              )
            );

        image.src =
          source;

      }
    );

  }


  /* =======================================================
     CANVAS
  ======================================================= */

  function createCanvas(
    width,
    height
  ){

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      width;

    canvas.height =
      height;

    return canvas;

  }


  /* =======================================================
     PIXEL HELPERS
  ======================================================= */

  function pixelIndex(
    x,
    y,
    width
  ){

    return (
      (y * width + x) *
      4
    );

  }


  function sameColor(
    data,
    a,
    b
  ){

    return (
      data[a] === data[b] &&
      data[a + 1] === data[b + 1] &&
      data[a + 2] === data[b + 2] &&
      data[a + 3] === data[b + 3]
    );

  }


  function isVisible(
    data,
    index
  ){

    return (
      data[index + 3] >
      12
    );

  }


  /* =======================================================
     COLOR HASH
  ======================================================= */

  function colorKey(
    r,
    g,
    b,
    a
  ){

    return (
      r + "," +
      g + "," +
      b + "," +
      a
    );

  }


  /* =======================================================
     BUILD COLOR CLASSES
  ======================================================= */

  function buildPalette(
    data
  ){

    const counts =
      new Map();

    const length =
      data.length;

    /*
      Считаем цвета через один пиксель.
      Это резко уменьшает стоимость
      поиска палитры.
    */

    for(
      let i = 0;
      i < length;
      i += 8
    ){

      const a =
        data[i + 3];

      if(
        a < 12
      ){

        continue;

      }

      const key =
        colorKey(
          data[i],
          data[i + 1],
          data[i + 2],
          a
        );

      counts.set(
        key,
        (
          counts.get(key) ||
          0
        ) + 1
      );

    }


    const colors =
      [...counts.entries()]
        .sort(
          (a,b) =>
            b[1] - a[1]
        )
        .slice(
          0,
          32
        )
        .map(
          entry => {

            const parts =
              entry[0]
                .split(",")
                .map(Number);

            return {

              r:parts[0],
              g:parts[1],
              b:parts[2],
              a:parts[3]

            };

          }
        );


    /*
      Если картинка почти полностью
      прозрачная — ничего не делаем.
    */

    if(
      !colors.length
    ){

      return null;

    }

    return colors;

  }


  /* =======================================================
     COLOR CLASSIFICATION
  ======================================================= */

  function nearestColor(
    data,
    index,
    palette
  ){

    const r =
      data[index];

    const g =
      data[index + 1];

    const b =
      data[index + 2];

    const a =
      data[index + 3];

    if(
      a < 12
    ){

      return -1;

    }

    let best =
      0;

    let bestDistance =
      Infinity;

    for(
      let i = 0;
      i < palette.length;
      i++
    ){

      const c =
        palette[i];

      const dr =
        r - c.r;

      const dg =
        g - c.g;

      const db =
        b - c.b;

      const distance =
        dr * dr +
        dg * dg +
        db * db;

      if(
        distance <
        bestDistance
      ){

        bestDistance =
          distance;

        best =
          i;

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
  ){

    const map =
      new Int16Array(
        width * height
      );

    map.fill(
      -1
    );

    for(
      let y = 0;
      y < height;
      y++
    ){

      for(
        let x = 0;
        x < width;
        x++
      ){

        const source =
          pixelIndex(
            x,
            y,
            width
          );

        map[
          y * width + x
        ] =
          nearestColor(
            data,
            source,
            palette
          );

      }

    }

    return map;

  }


  /* =======================================================
     NEIGHBOUR
  ======================================================= */

  function getClass(
    classes,
    x,
    y,
    width,
    height
  ){

    if(
      x < 0 ||
      y < 0 ||
      x >= width ||
      y >= height
    ){

      return -1;

    }

    return classes[
      y * width + x
    ];

  }


  /* =======================================================
     BOUNDARY TEST
  ======================================================= */

  function isBoundary(
    classes,
    x,
    y,
    width,
    height
  ){

    const center =
      getClass(
        classes,
        x,
        y,
        width,
        height
      );

    const left =
      getClass(
        classes,
        x - 1,
        y,
        width,
        height
      );

    const right =
      getClass(
        classes,
        x + 1,
        y,
        width,
        height
      );

    const top =
      getClass(
        classes,
        x,
        y - 1,
        width,
        height
      );

    const bottom =
      getClass(
        classes,
        x,
        y + 1,
        width,
        height
      );

    return (
      center !== left ||
      center !== right ||
      center !== top ||
      center !== bottom
    );

  }


  /* =======================================================
     CORNER DECISION
  ======================================================= */

  function cornerFilled(
    classes,
    x,
    y,
    corner,
    width,
    height
  ){

    const center =
      getClass(
        classes,
        x,
        y,
        width,
        height
      );

    if(
      center < 0
    ){

      return false;

    }


    let a;
    let b;
    let diagonal;


    /*
      0 = верхний левый
      1 = верхний правый
      2 = нижний правый
      3 = нижний левый
    */

    if(
      corner === 0
    ){

      a =
        getClass(
          classes,
          x - 1,
          y,
          width,
          height
        );

      b =
        getClass(
          classes,
          x,
          y - 1,
          width,
          height
        );

      diagonal =
        getClass(
          classes,
          x - 1,
          y - 1,
          width,
          height
        );

    }else if(
      corner === 1
    ){

      a =
        getClass(
          classes,
          x + 1,
          y,
          width,
          height
        );

      b =
        getClass(
          classes,
          x,
          y - 1,
          width,
          height
        );

      diagonal =
        getClass(
          classes,
          x + 1,
          y - 1,
          width,
          height
        );

    }else if(
      corner === 2
    ){

      a =
        getClass(
          classes,
          x + 1,
          y,
          width,
          height
        );

      b =
        getClass(
          classes,
          x,
          y + 1,
          width,
          height
        );

      diagonal =
        getClass(
          classes,
          x + 1,
          y + 1,
          width,
          height
        );

    }else{

      a =
        getClass(
          classes,
          x - 1,
          y,
          width,
          height
        );

      b =
        getClass(
          classes,
          x,
          y + 1,
          width,
          height
        );

      diagonal =
        getClass(
          classes,
          x - 1,
          y + 1,
          width,
          height
        );

    }


    /*
      Если два соседних пикселя принадлежат
      другой области, угол вырезаем.

      Это и создаёт округление внешнего
      контура.
    */

    if(
      a !== center &&
      b !== center
    ){

      return false;

    }


    /*
      Если оба соседа наши,
      угол полностью сохраняем.
    */

    if(
      a === center &&
      b === center
    ){

      return true;

    }


    /*
      Один сосед наш, один чужой.

      Диагональный пиксель позволяет определить,
      нужен ли более мягкий переход.
    */

    if(
      diagonal === center
    ){

      return true;

    }

    return true;

  }


  /* =======================================================
     GEOMETRIC RENDER
  ======================================================= */

  function renderGeometry(
    sourceCanvas,
    classes,
    palette,
    width,
    height,
    amount
  ){

    /*
      При 0% отдаём исходную картинку.
    */

    if(
      amount <= 0
    ){

      return sourceCanvas;

    }


    /*
      2x — основной режим.
      При 75%+ можно использовать 3x,
      но только для небольших кадров.
    */

    let scale =
      CONFIG.resolution;

    if(
      amount >= 80 &&
      width * height < 1500000
    ){

      scale = 3;

    }


    const output =
      createCanvas(
        width * scale,
        height * scale
      );

    const ctx =
      output.getContext(
        "2d",
        {
          alpha:true
        }
      );


    ctx.clearRect(
      0,
      0,
      output.width,
      output.height
    );


    /*
      ВАЖНО:
      отключаем сглаживание самой картинки.
      Мы сами строим геометрию.
    */

    ctx.imageSmoothingEnabled =
      false;


    /*
      Для каждой исходной области
      строим геометрическую форму.

      Цвет берётся только из исходной
      палитры — никаких новых RGB цветов.
    */

    for(
      let y = 0;
      y < height;
      y++
    ){

      for(
        let x = 0;
        x < width;
        x++
      ){

        const classIndex =
          classes[
            y * width + x
          ];

        if(
          classIndex < 0
        ){

          continue;

        }


        /*
          Проверяем границу.
          Внутренние пиксели можно рисовать
          одним прямоугольником без дополнительных
          вычислений.
        */

        const boundary =
          isBoundary(
            classes,
            x,
            y,
            width,
            height
          );


        const color =
          palette[
            classIndex
          ];

        if(!color){
          continue;
        }


        ctx.fillStyle =
          `rgba(
            ${color.r},
            ${color.g},
            ${color.b},
            ${color.a / 255}
          )`;


        const px =
          x * scale;

        const py =
          y * scale;


        if(
          !boundary ||
          amount < 15
        ){

          ctx.fillRect(
            px,
            py,
            scale,
            scale
          );

          continue;

        }


        /*
          Рисуем не квадрат,
          а четырёхугольник с
          обработанными углами.
        */

        const inset =
          Math.min(
            scale * 0.5,
            scale *
              (
                0.12 +
                amount / 100 *
                0.38
              )
          );


        const tl =
          cornerFilled(
            classes,
            x,
            y,
            0,
            width,
            height
          );

        const tr =
          cornerFilled(
            classes,
            x,
            y,
            1,
            width,
            height
          );

        const br =
          cornerFilled(
            classes,
            x,
            y,
            2,
            width,
            height
          );

        const bl =
          cornerFilled(
            classes,
            x,
            y,
            3,
            width,
            height
          );


        /*
          Используем квадратичные кривые
          только там, где угол действительно
          находится на границе.

          Это даёт округление, но не меняет
          внутреннюю часть области.
        */

        ctx.beginPath();


        /* верх */

        if(tl){

          ctx.moveTo(
            px,
            py + inset
          );

        }else{

          ctx.moveTo(
            px + inset,
            py + inset
          );

        }


        if(tr){

          ctx.lineTo(
            px + scale - inset,
            py
          );

        }else{

          ctx.lineTo(
            px + scale - inset,
            py + inset
          );

        }


        /* правый верхний */

        if(tr){

          ctx.quadraticCurveTo(
            px + scale,
            py,
            px + scale,
            py + inset
          );

        }


        /* правый */

        if(br){

          ctx.lineTo(
            px + scale,
            py + scale - inset
          );

        }else{

          ctx.lineTo(
            px + scale - inset,
            py + scale - inset
          );

        }


        /* правый нижний */

        if(br){

          ctx.quadraticCurveTo(
            px + scale,
            py + scale,
            px + scale - inset,
            py + scale
          );

        }


        /* низ */

        if(bl){

          ctx.lineTo(
            px + inset,
            py + scale
          );

        }else{

          ctx.lineTo(
            px + inset,
            py + scale - inset
          );

        }


        /* левый нижний */

        if(bl){

          ctx.quadraticCurveTo(
            px,
            py + scale,
            px,
            py + scale - inset
          );

        }


        /* левый */

        if(tl){

          ctx.lineTo(
            px,
            py + inset
          );

        }else{

          ctx.lineTo(
            px + inset,
            py + inset
          );

        }


        ctx.closePath();

        ctx.fill();

      }

    }


    /*
      Второй проход.

      Здесь очень лёгкое геометрическое
      сглаживание только границ.

      Мы не используем blur и не смешиваем
      RGB-значения.
    */

    if(
      amount >= 40
    ){

      return refineOuterGeometry(
        output,
        classes,
        palette,
        width,
        height,
        scale,
        amount
      );

    }


    return output;

  }


  /* =======================================================
     OUTER GEOMETRY REFINEMENT
  ======================================================= */

  function refineOuterGeometry(
    canvas,
    classes,
    palette,
    width,
    height,
    scale,
    amount
  ){

    /*
      Для сохранения производительности
      работаем только на boundary mask.
    */

    const output =
      createCanvas(
        canvas.width,
        canvas.height
      );

    const ctx =
      output.getContext(
        "2d",
        {
          alpha:true
        }
      );

    ctx.imageSmoothingEnabled =
      false;


    /*
      Сначала переносим уже построенную
      геометрию.
    */

    ctx.drawImage(
      canvas,
      0,
      0
    );


    /*
      Небольшая дополнительная коррекция
      внешних углов.

      Радиус ограничен.
    */

    const radius =
      Math.min(
        1.4,
        0.35 +
        amount / 100 *
        1.05
      );


    /*
      Работаем только по исходной сетке.
    */

    for(
      let y = 0;
      y < height;
      y++
    ){

      for(
        let x = 0;
        x < width;
        x++
      ){

        const index =
          y * width + x;

        const current =
          classes[index];

        if(
          current < 0
        ){

          continue;

        }


        const left =
          getClass(
            classes,
            x - 1,
            y,
            width,
            height
          );

        const right =
          getClass(
            classes,
            x + 1,
            y,
            width,
            height
          );

        const top =
          getClass(
            classes,
            x,
            y - 1,
            width,
            height
          );

        const bottom =
          getClass(
            classes,
            x,
            y + 1,
            width,
            height
          );


        /*
          Если область касается внешнего
          прозрачного пространства,
          дополнительно округляем внешний край.
        */

        const outside =
          left < 0 ||
          right < 0 ||
          top < 0 ||
          bottom < 0;


        if(!outside){

          continue;

        }


        const color =
          palette[current];

        if(!color){

          continue;

        }


        ctx.fillStyle =
          `rgba(
            ${color.r},
            ${color.g},
            ${color.b},
            ${color.a / 255}
          )`;


        const px =
          x * scale;

        const py =
          y * scale;


        /*
          Небольшой круглый cap на внешних
          переходах.

          Он находится только внутри
          существующей радарной области.
        */

        ctx.beginPath();

        ctx.arc(
          px + scale / 2,
          py + scale / 2,
          scale *
            (
              0.43 +
              radius * 0.035
            ),
          0,
          Math.PI * 2
        );

        ctx.fill();

      }

    }


    return output;

  }


  /* =======================================================
     CANVAS → BLOB URL
  ======================================================= */

  function canvasToURL(
    canvas
  ){

    return new Promise(
      (resolve,reject) => {

        canvas.toBlob(
          blob => {

            if(!blob){

              reject(
                new Error(
                  "Не удалось создать PNG радара"
                )
              );

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

  }


  /* =======================================================
     CACHE
  ======================================================= */

  function cacheGet(
    key
  ){

    if(
      !cache.has(key)
    ){

      return null;

    }

    const value =
      cache.get(key);

    /*
      Перемещаем запись в конец
      как LRU.
    */

    cacheOrder =
      cacheOrder.filter(
        x => x !== key
      );

    cacheOrder.push(
      key
    );

    return value;

  }


  function cacheSet(
    key,
    value
  ){

    if(
      cache.has(key)
    ){

      cacheOrder =
        cacheOrder.filter(
          x => x !== key
        );

    }

    cache.set(
      key,
      value
    );

    cacheOrder.push(
      key
    );


    while(
      cacheOrder.length >
      CONFIG.cacheLimit
    ){

      const oldKey =
        cacheOrder.shift();

      const old =
        cache.get(
          oldKey
        );

      cache.delete(
        oldKey
      );


      if(
        old &&
        old !== currentProcessedURL
      ){

        try{

          URL.revokeObjectURL(
            old
          );

        }catch{}

      }

    }

  }


  /* =======================================================
     SOURCE KEY
  ======================================================= */

  function makeCacheKey(
    source
  ){

    return (
      String(source) +
      "::" +
      String(strength)
    );

  }


  /* =======================================================
     PROCESS IMAGE
  ======================================================= */

  async function processSource(
    source
  ){

    if(
      strength <= 0
    ){

      return source;

    }


    const key =
      makeCacheKey(
        source
      );

    const cached =
      cacheGet(
        key
      );

    if(cached){

      return cached;

    }


    processing =
      true;

    showStatus();


    try{

      const image =
        await loadImage(
          source
        );


      const width =
        image.naturalWidth ||
        image.width;

      const height =
        image.naturalHeight ||
        image.height;


      if(
        !width ||
        !height
      ){

        return source;

      }


      /*
        Не обрабатываем огромные изображения
        полностью в несколько раз.

        GIF Meteoinfo обычно около
        1122×1136, поэтому попадает
        в нормальный режим.
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
            willReadFrequently:true
          }
        );

      sourceCtx.imageSmoothingEnabled =
        false;

      sourceCtx.drawImage(
        image,
        0,
        0,
        width,
        height
      );


      const imageData =
        sourceCtx.getImageData(
          0,
          0,
          width,
          height
        );


      /*
        Определяем фактическую палитру
        самого кадра.

        Благодаря этому пользовательские
        палитры тоже работают автоматически.
      */

      const palette =
        buildPalette(
          imageData.data
        );


      if(
        !palette ||
        palette.length < 1
      ){

        return source;

      }


      /*
        Строим карту классов.
      */

      const classes =
        buildClassMap(
          imageData.data,
          width,
          height,
          palette
        );


      /*
        Геометрический рендер.
      */

      const result =
        renderGeometry(
          sourceCanvas,
          classes,
          palette,
          width,
          height,
          strength
        );


      if(
        result ===
        sourceCanvas
      ){

        return source;

      }


      const url =
        await canvasToURL(
          result
        );


      cacheSet(
        key,
        url
      );


      return url;

    }finally{

      processing =
        false;

      hideStatus();

    }

  }


  /* =======================================================
     RESTORE ORIGINAL
  ======================================================= */

  function restoreOriginal(){

    if(
      !currentLayer
    ){

      return;

    }

    const image =
      currentLayer._image;

    if(
      !image
    ){

      return;

    }

    if(
      currentSource
    ){

      image.src =
        currentSource;

    }

    currentProcessedURL =
      null;

  }


  /* =======================================================
     APPLY
  ======================================================= */

  async function applyToLayer(
    layer
  ){

    if(
      !enabled ||
      strength <= 0 ||
      !layer
    ){

      return;

    }


    const image =
      layer._image;

    if(
      !image
    ){

      return;

    }


    /*
      Не обрабатываем один и тот же
      URL повторно.
    */

    const source =
      image.src;


    if(
      !source ||
      source.startsWith(
        "data:"
      ) === false &&
      source.startsWith(
        "blob:"
      ) === false &&
      source.startsWith(
        "http"
      ) === false
    ){

      return;

    }


    /*
      Если это уже наш результат,
      сначала возвращаем исходник.
    */

    if(
      layer.__cloradSmoothSource
    ){

      currentSource =
        layer.__cloradSmoothSource;

      image.src =
        currentSource;

    }else{

      layer.__cloradSmoothSource =
        source;

      currentSource =
        source;

    }


    /*
      Запоминаем слой.
    */

    currentLayer =
      layer;


    /*
      Ждём загрузки исходника.
    */

    if(
      !image.complete ||
      !image.naturalWidth
    ){

      await new Promise(
        resolve => {

          const done =
            () => {

              image.removeEventListener(
                "load",
                done
              );

              image.removeEventListener(
                "error",
                done
              );

              resolve();

            };

          image.addEventListener(
            "load",
            done,
            {
              once:true
            }
          );

          image.addEventListener(
            "error",
            done,
            {
              once:true
            }
          );

        }
      );

    }


    /*
      Если пользователь уже выключил
      сглаживание — выходим.
    */

    if(
      !enabled ||
      strength <= 0
    ){

      return;

    }


    const original =
      layer.__cloradSmoothSource;


    const key =
      makeCacheKey(
        original
      );

    const cached =
      cacheGet(
        key
      );


    if(cached){

      if(
        image.src !== cached
      ){

        image.src =
          cached;

      }

      currentProcessedURL =
        cached;

      return;

    }


    try{

      const processed =
        await processSource(
          original
        );


      /*
        За время обработки мог
        появиться новый кадр.
      */

      if(
        currentLayer !== layer
      ){

        return;

      }


      if(
        !enabled
      ){

        return;

      }


      if(
        processed &&
        processed !== original
      ){

        image.src =
          processed;

        currentProcessedURL =
          processed;

      }

    }catch(error){

      console.error(
        "CLOrad smoothing:",
        error
      );

    }

  }


  /* =======================================================
     SCHEDULE
  ======================================================= */

  function scheduleProcess(){

    if(
      processTimer
    ){

      clearTimeout(
        processTimer
      );

    }


    processTimer =
      setTimeout(
        () => {

          processTimer =
            null;

          if(
            currentLayer
          ){

            applyToLayer(
              currentLayer
            );

          }

        },
        CONFIG.processDelay
      );

  }


  /* =======================================================
     LEAFLET HOOK
  ======================================================= */

  function installLeafletHook(){

    if(
      !window.L ||
      !L.ImageOverlay
    ){

      return false;

    }


    if(
      L.ImageOverlay.prototype
        .__cloradSmoothingInstalled
    ){

      return true;

    }


    L.ImageOverlay.prototype
      .__cloradSmoothingInstalled =
      true;


    const originalOnAdd =
      L.ImageOverlay.prototype.onAdd;


    L.ImageOverlay.prototype.onAdd =
      function(map){

        const result =
          originalOnAdd.call(
            this,
            map
          );


        /*
          Это именно Leaflet imageOverlay.
        */

        if(
          this.options &&
          (
            this.options.className ===
            "clorad-gif-radar-image" ||
            this.options.className ===
            "clorad-radar-raster"
          )
        ){

          currentLayer =
            this;


          const image =
            this._image;


          if(image){

            const handleLoad =
              () => {

                if(
                  !this.__cloradSmoothSource
                ){

                  this.__cloradSmoothSource =
                    image.src;

                }

                currentSource =
                  this.__cloradSmoothSource;


                if(
                  enabled &&
                  strength > 0
                ){

                  scheduleProcess();

                }

              };


            image.addEventListener(
              "load",
              handleLoad
            );


            /*
              Иногда картинка уже загрузилась
              до установки listener.
            */

            if(
              image.complete &&
              image.naturalWidth
            ){

              setTimeout(
                handleLoad,
                0
              );

            }

          }

        }


        return result;

      };


    /*
      Перехватываем setUrl.

      Это важно для timeline:
      при смене кадра Leaflet меняет
      src того же overlay.
    */

    const originalSetUrl =
      L.ImageOverlay.prototype.setUrl;


    L.ImageOverlay.prototype.setUrl =
      function(url){

        if(
          this.options &&
          (
            this.options.className ===
            "clorad-gif-radar-image" ||
            this.options.className ===
            "clorad-radar-raster"
          )
        ){

          /*
            Новый кадр становится новым
            исходником.
          */

          this.__cloradSmoothSource =
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


          /*
            Leaflet загрузит новый кадр.
            После load запустится обработка.
          */

          if(
            this._image
          ){

            const image =
              this._image;

            const process =
              () => {

              if(
                enabled &&
                strength > 0 &&
                currentLayer === this
              ){

                scheduleProcess();

              }

            };


            image.addEventListener(
              "load",
              process,
              {
                once:true
              }
            );

          }


          return result;

        }


        return originalSetUrl.call(
          this,
          url
        );

      };


    return true;

  }


  /* =======================================================
     LAYER DETECTION FALLBACK
  ======================================================= */

  function scanLayers(){

    if(
      !window.map ||
      !map._layers
    ){

      return;

    }


    for(
      const key in map._layers
    ){

      const layer =
        map._layers[key];

      if(
        !layer ||
        !layer.options
      ){

        continue;

      }


      const className =
        layer.options.className;


      if(
        className ===
          "clorad-gif-radar-image" ||
        className ===
          "clorad-radar-raster"
      ){

        if(
          currentLayer !== layer
        ){

          currentLayer =
            layer;

          const image =
            layer._image;

          if(
            image
          ){

            if(
              !layer.__cloradSmoothSource
            ){

              layer.__cloradSmoothSource =
                image.src;

            }

            currentSource =
              layer.__cloradSmoothSource;

          }

        }


        if(
          enabled &&
          strength > 0
        ){

          scheduleProcess();

        }

        return;

      }

    }

  }


  /* =======================================================
     MAP EVENTS
  ======================================================= */

  function installMapHooks(){

    if(
      !window.map
    ){

      return false;

    }


    map.on(
      "layeradd",
      event => {

        const layer =
          event.layer;

        if(
          !layer ||
          !layer.options
        ){

          return;

        }


        const className =
          layer.options.className;


        if(
          className !==
            "clorad-gif-radar-image" &&
          className !==
            "clorad-radar-raster"
        ){

          return;

        }


        currentLayer =
          layer;


        const image =
          layer._image;


        if(!image){

          return;

        }


        const process =
          () => {

            if(
              !layer.__cloradSmoothSource
            ){

              layer.__cloradSmoothSource =
                image.src;

            }

            currentSource =
              layer.__cloradSmoothSource;


            if(
              enabled &&
              strength > 0
            ){

              scheduleProcess();

            }

          };


        image.addEventListener(
          "load",
          process,
          {
            once:true
          }
        );


        if(
          image.complete &&
          image.naturalWidth
        ){

          setTimeout(
            process,
            0
          );

        }

      }
    );


    map.on(
      "layerremove",
      event => {

        if(
          event.layer ===
          currentLayer
        ){

          currentLayer =
            null;

          currentSource =
            null;

          currentProcessedURL =
            null;

        }

      }
    );


    return true;

  }


  /* =======================================================
     PUBLIC API
  ======================================================= */

  window.CLOradRadarSmoothing = {

    enable(){

      enabled =
        true;

      const button =
        document.getElementById(
          "cloradSmoothingButton"
        );

      const panel =
        document.getElementById(
          "cloradSmoothingPanel"
        );

      if(button){

        button.classList.add(
          "active"
        );

      }

      if(panel){

        panel.classList.add(
          "show"
        );

      }

      scanLayers();

      scheduleProcess();

    },

    disable(){

      enabled =
        false;

      restoreOriginal();

      const button =
        document.getElementById(
          "cloradSmoothingButton"
        );

      const panel =
        document.getElementById(
          "cloradSmoothingPanel"
        );

      if(button){

        button.classList.remove(
          "active"
        );

      }

      if(panel){

        panel.classList.remove(
          "show"
        );

      }

    },

    setStrength(
      value
    ){

      strength =
        Math.max(
          CONFIG.min,
          Math.min(
            CONFIG.max,
            Number(value) || 0
          )
        );


      const range =
        document.getElementById(
          "cloradSmoothingRange"
        );

      const valueElement =
        document.getElementById(
          "cloradSmoothingValue"
        );


      if(range){

        range.value =
          strength;

      }

      if(valueElement){

        valueElement.textContent =
          strength + "%";

      }


      if(
        enabled
      ){

        scheduleProcess();

      }

    },

    clearCache(){

      for(
        const url of cache.values()
      ){

        try{

          URL.revokeObjectURL(
            url
          );

        }catch{}

      }

      cache.clear();

      cacheOrder = [];

    },

    isEnabled(){

      return enabled;

    },

    getStrength(){

      return strength;

    }

  };


  /* =======================================================
     INITIALIZATION
  ======================================================= */

  function init(){

    createUI();

    /*
      Leaflet уже должен быть загружен,
      потому что этот файл подключается
      после gif-radar.js.
    */

    if(
      installLeafletHook()
    ){

      installMapHooks();

      setTimeout(
        scanLayers,
        250
      );

      setTimeout(
        scanLayers,
        1000
      );

      setTimeout(
        scanLayers,
        2500
      );

    }else{

      /*
        Запасной вариант, если скрипт
        оказался загружен чуть раньше Leaflet.
      */

      setTimeout(
        init,
        250
      );

    }

  }


  /* =======================================================
     START
  ======================================================= */

  if(
    document.readyState ===
    "loading"
  ){

    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once:true
      }
    );

  }else{

    init();

  }

})();
