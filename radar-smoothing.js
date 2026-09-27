/* =========================================================
   CLOrad — RADAR GEOMETRIC SMOOTHING
   ---------------------------------------------------------
   Геометрическое сглаживание радарного изображения.
   Без blur.
   Без смешивания RGB.
   Без изменения исходных радарных классов.

   UI полностью независим от .tools и Leaflet.
   Кнопка всегда создаётся непосредственно в body.
   Обработка выполняется только после отпускания ползунка.

   Серверная нагрузка:
   отсутствует — всё выполняется на устройстве пользователя.
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

    resolution: 2,
    radius: 1,
    passes: 1,

    cacheLimit: 5,
    minRegionPixels: 3,

    processDelay: 40

  };


  /* =======================================================
     STATE
  ======================================================= */

  let enabled = false;
  let strength = CONFIG.initial;

  let processing = false;
  let processTimer = null;

  let currentLayer = null;
  let currentSource = null;
  let currentProcessedURL = null;

  let cache = new Map();
  let cacheOrder = [];

  let mapHooksReady = false;
  let leafletHookReady = false;

  let uiObserver = null;
  let uiRepairTimer = null;
  let uiRepairRunning = false;


  /* =======================================================
     STYLE
  ======================================================= */

  function installStyle(){

    if(document.getElementById("clorad-smoothing-style")){
      return;
    }

    const style = document.createElement("style");

    style.id = "clorad-smoothing-style";

    style.textContent = `

      /* ===================================================
         SMOOTHING BUTTON
         Кнопка НЕ зависит от .tools
      =================================================== */

      #cloradSmoothingButton{
        position:fixed !important;

        left:16px !important;
        top:110px !important;

        width:44px !important;
        height:44px !important;

        min-width:44px !important;
        min-height:44px !important;

        max-width:44px !important;
        max-height:44px !important;

        margin:0 !important;
        padding:0 !important;

        display:grid !important;
        place-items:center !important;

        box-sizing:border-box !important;

        border:1px solid #35404a !important;
        border-radius:9px !important;

        background:#171e24 !important;
        color:#cbd2d7 !important;

        opacity:1 !important;
        visibility:visible !important;

        pointer-events:auto !important;

        cursor:pointer !important;

        z-index:2147483646 !important;

        appearance:none !important;
        -webkit-appearance:none !important;

        transform:none !important;

        overflow:visible !important;
      }


      #cloradSmoothingButton:hover{
        background:#202930 !important;
      }


      #cloradSmoothingButton:active{
        transform:scale(.96) !important;
      }


      #cloradSmoothingButton.active{
        background:#26332e !important;
        border-color:#51e29a !important;
        color:#51e29a !important;
      }


      #cloradSmoothingButton svg{
        width:24px !important;
        height:24px !important;

        display:block !important;

        fill:none !important;

        stroke:currentColor !important;
        stroke-width:1.8 !important;

        stroke-linecap:round !important;
        stroke-linejoin:round !important;

        pointer-events:none !important;

        opacity:1 !important;
        visibility:visible !important;
      }


      /* ===================================================
         PANEL
      =================================================== */

      #cloradSmoothingPanel{
        position:fixed !important;

        left:50% !important;
        bottom:174px !important;

        transform:
          translateX(-50%)
          translateY(10px) !important;

        width:min(520px,calc(100vw - 32px)) !important;
        height:54px !important;

        padding:0 15px !important;

        display:flex !important;
        align-items:center !important;
        gap:12px !important;

        box-sizing:border-box !important;

        background:#11181e !important;

        border:1px solid #35404a !important;
        border-radius:11px !important;

        box-shadow:0 8px 30px #0008 !important;

        opacity:0 !important;
        visibility:hidden !important;

        pointer-events:none !important;

        transition:
          opacity .16s ease,
          transform .16s ease,
          visibility .16s ease !important;

        z-index:2147483645 !important;
      }


      #cloradSmoothingPanel.show{
        opacity:1 !important;

        visibility:visible !important;

        pointer-events:auto !important;

        transform:
          translateX(-50%)
          translateY(0) !important;
      }


      #cloradSmoothingValue{
        width:43px !important;

        flex:none !important;

        text-align:center !important;

        color:#dce2e6 !important;

        font-size:13px !important;
        font-weight:600 !important;
      }


      #cloradSmoothingRange{
        width:100% !important;

        margin:0 !important;

        accent-color:#51e29a !important;

        cursor:pointer !important;
      }


      /* ===================================================
         STATUS
      =================================================== */

      #cloradSmoothingStatus{
        position:fixed !important;

        left:50% !important;
        bottom:235px !important;

        transform:translateX(-50%) !important;

        background:#151d23 !important;
        color:#cbd2d7 !important;

        border:1px solid #35404a !important;
        border-radius:8px !important;

        padding:7px 11px !important;

        font-size:11px !important;

        opacity:0 !important;
        visibility:hidden !important;

        pointer-events:none !important;

        transition:opacity .15s ease !important;

        z-index:2147483647 !important;
      }


      #cloradSmoothingStatus.show{
        opacity:1 !important;
        visibility:visible !important;
      }


      @media(max-width:600px){

        #cloradSmoothingButton{
          left:12px !important;
          top:108px !important;
        }

        #cloradSmoothingPanel{
          bottom:168px !important;
          width:calc(100vw - 24px) !important;
        }

      }

    `;

    document.head.appendChild(style);

  }


  /* =======================================================
     CREATE BUTTON
  ======================================================= */

  function createButton(){

    let button =
      document.getElementById(
        "cloradSmoothingButton"
      );


    if(button){
      return button;
    }


    button =
      document.createElement("button");

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
      КРИТИЧНО:

      Кнопка всегда добавляется непосредственно
      в body.

      Мы больше НЕ делаем:

        .tools.appendChild(button)

      Поэтому никакая перерисовка .tools
      не сможет удалить кнопку.
    */

    document.body.appendChild(button);


    return button;

  }


  /* =======================================================
     CREATE PANEL
  ======================================================= */

  function createPanel(){

    let panel =
      document.getElementById(
        "cloradSmoothingPanel"
      );


    if(panel){
      return panel;
    }


    panel =
      document.createElement("div");

    panel.id =
      "cloradSmoothingPanel";


    panel.innerHTML = `

      <span id="cloradSmoothingValue">
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


    document.body.appendChild(panel);


    return panel;

  }


  /* =======================================================
     CREATE STATUS
  ======================================================= */

  function createStatus(){

    let status =
      document.getElementById(
        "cloradSmoothingStatus"
      );


    if(status){
      return status;
    }


    status =
      document.createElement("div");

    status.id =
      "cloradSmoothingStatus";

    status.textContent =
      "Обработка радара…";


    document.body.appendChild(status);


    return status;

  }


  /* =======================================================
     CREATE UI
  ======================================================= */

  function createUI(){

    if(!document.body){
      return;
    }


    installStyle();


    const button =
      createButton();

    const panel =
      createPanel();

    createStatus();


    /* =====================================================
       BUTTON EVENTS
    ===================================================== */

    if(!button.__cloradSmoothingEvents){

      button.__cloradSmoothingEvents = true;


      button.addEventListener(
        "click",
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

            scanLayers();


            if(currentLayer){

              scheduleProcess();

            }

          }else{

            restoreOriginal();

          }

        }
      );

    }


    /* =====================================================
       RANGE EVENTS
    ===================================================== */

    const range =
      document.getElementById(
        "cloradSmoothingRange"
      );


    if(
      range &&
      !range.__cloradSmoothingEvents
    ){

      range.__cloradSmoothingEvents =
        true;


      range.addEventListener(
        "input",
        () => {

          strength =
            Number(range.value);


          const value =
            document.getElementById(
              "cloradSmoothingValue"
            );


          if(value){

            value.textContent =
              strength + "%";

          }

        }
      );


      /*
        ВАЖНО:

        input только меняет число.

        Реальная обработка начинается
        только на change — после отпускания
        ползунка.
      */

      range.addEventListener(
        "change",
        () => {

          if(enabled){

            scheduleProcess();

          }

        }
      );

    }

  }


  /* =======================================================
     UI WATCHER
  ======================================================= */

  function repairUI(){

    if(
      uiRepairRunning
    ){

      return;

    }


    uiRepairRunning =
      true;


    try{

      /*
        Если какой-либо другой код удалил кнопку,
        создаём её заново.
      */

      createUI();


    }finally{

      uiRepairRunning =
        false;

    }

  }


  function scheduleUIRepair(){

    if(uiRepairTimer){
      return;
    }


    uiRepairTimer =
      requestAnimationFrame(
        () => {

          uiRepairTimer =
            null;

          repairUI();

        }
      );

  }


  function startUIWatcher(){

    if(uiObserver){
      return;
    }


    if(!document.body){
      return;
    }


    uiObserver =
      new MutationObserver(
        mutations => {

          let relevant =
            false;


          for(
            const mutation of mutations
          ){

            if(
              mutation.type !==
              "childList"
            ){

              continue;

            }


            if(
              mutation.addedNodes.length ||
              mutation.removedNodes.length
            ){

              relevant =
                true;

              break;

            }

          }


          if(relevant){

            const button =
              document.getElementById(
                "cloradSmoothingButton"
              );

            const panel =
              document.getElementById(
                "cloradSmoothingPanel"
              );

            const range =
              document.getElementById(
                "cloradSmoothingRange"
              );


            if(
              !button ||
              !panel ||
              !range
            ){

              scheduleUIRepair();

            }

          }

        }
      );


    uiObserver.observe(
      document.body,
      {
        childList:true,
        subtree:true
      }
    );

  }


  /* =======================================================
     STATUS
  ======================================================= */

  function showStatus(){

    const element =
      document.getElementById(
        "cloradSmoothingStatus"
      );


    if(element){

      element.classList.add(
        "show"
      );

    }

  }


  function hideStatus(){

    const element =
      document.getElementById(
        "cloradSmoothingStatus"
      );


    if(element){

      element.classList.remove(
        "show"
      );

    }

  }


  /* =======================================================
     IMAGE LOADING
  ======================================================= */

  function loadImage(source){

    return new Promise(
      (resolve,reject) => {

        const image =
          new Image();


        image.crossOrigin =
          "anonymous";


        image.onload =
          () => resolve(image);


        image.onerror =
          () => reject(
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


  function pixelIndex(
    x,
    y,
    width
  ){

    return (
      (y * width + x) * 4
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
     BUILD PALETTE
  ======================================================= */

  function buildPalette(data){

    const counts =
      new Map();


    for(
      let i = 0;
      i < data.length;
      i += 8
    ){

      const a =
        data[i + 3];


      if(a < 12){
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
        (counts.get(key) || 0) + 1
      );

    }


    const colors =
      [...counts.entries()]
        .sort(
          (a,b) =>
            b[1] - a[1]
        )
        .slice(0,32)
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


    return colors.length
      ? colors
      : null;

  }


  /* =======================================================
     NEAREST COLOR
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


    if(a < 12){
      return -1;
    }


    let best = 0;
    let bestDistance = Infinity;


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


    map.fill(-1);


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

        map[
          y * width + x
        ] =
          nearestColor(
            data,
            pixelIndex(
              x,
              y,
              width
            ),
            palette
          );

      }

    }


    return map;

  }


  /* =======================================================
     GET CLASS
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
     BOUNDARY
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


    return (
      center !==
        getClass(
          classes,
          x - 1,
          y,
          width,
          height
        ) ||

      center !==
        getClass(
          classes,
          x + 1,
          y,
          width,
          height
        ) ||

      center !==
        getClass(
          classes,
          x,
          y - 1,
          width,
          height
        ) ||

      center !==
        getClass(
          classes,
          x,
          y + 1,
          width,
          height
        )
    );

  }


  /* =======================================================
     CORNER
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


    if(center < 0){
      return false;
    }


    let a;
    let b;
    let diagonal;


    if(corner === 0){

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

    }else if(corner === 1){

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

    }else if(corner === 2){

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


    if(
      a !== center &&
      b !== center
    ){

      return false;

    }


    if(
      a === center &&
      b === center
    ){

      return true;

    }


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

    if(amount <= 0){

      return sourceCanvas;

    }


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


    ctx.imageSmoothingEnabled =
      false;


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


        if(classIndex < 0){
          continue;
        }


        const color =
          palette[classIndex];


        if(!color){
          continue;
        }


        const boundary =
          isBoundary(
            classes,
            x,
            y,
            width,
            height
          );


        const px =
          x * scale;

        const py =
          y * scale;


        ctx.fillStyle =
          `rgba(
            ${color.r},
            ${color.g},
            ${color.b},
            ${color.a / 255}
          )`;


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


        ctx.beginPath();


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


        if(tr){

          ctx.quadraticCurveTo(
            px + scale,
            py,
            px + scale,
            py + inset
          );

        }


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


        if(br){

          ctx.quadraticCurveTo(
            px + scale,
            py + scale,
            px + scale - inset,
            py + scale
          );

        }


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


        if(bl){

          ctx.quadraticCurveTo(
            px,
            py + scale,
            px,
            py + scale - inset
          );

        }


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


    if(amount >= 40){

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
     OUTER GEOMETRY
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


    ctx.drawImage(
      canvas,
      0,
      0
    );


    const radius =
      Math.min(
        1.4,
        0.35 +
        amount / 100 *
        1.05
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

        const index =
          y * width + x;


        const current =
          classes[index];


        if(current < 0){
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
     CANVAS → URL
  ======================================================= */

  function canvasToURL(canvas){

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

  function cacheGet(key){

    if(!cache.has(key)){
      return null;
    }


    const value =
      cache.get(key);


    cacheOrder =
      cacheOrder.filter(
        x => x !== key
      );


    cacheOrder.push(key);


    return value;

  }


  function cacheSet(
    key,
    value
  ){

    if(cache.has(key)){

      cacheOrder =
        cacheOrder.filter(
          x => x !== key
        );

    }


    cache.set(
      key,
      value
    );


    cacheOrder.push(key);


    while(
      cacheOrder.length >
      CONFIG.cacheLimit
    ){

      const oldKey =
        cacheOrder.shift();


      const old =
        cache.get(oldKey);


      cache.delete(
        oldKey
      );


      if(
        old &&
        old !== currentProcessedURL
      ){

        try{
          URL.revokeObjectURL(old);
        }catch{}

      }

    }

  }


  function makeCacheKey(source){

    return (
      String(source) +
      "::" +
      String(strength)
    );

  }


  /* =======================================================
     PROCESS SOURCE
  ======================================================= */

  async function processSource(source){

    if(strength <= 0){
      return source;
    }


    const key =
      makeCacheKey(
        source
      );


    const cached =
      cacheGet(key);


    if(cached){
      return cached;
    }


    processing = true;

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


      const palette =
        buildPalette(
          imageData.data
        );


      if(!palette){
        return source;
      }


      const classes =
        buildClassMap(
          imageData.data,
          width,
          height,
          palette
        );


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

      processing = false;

      hideStatus();

    }

  }


  /* =======================================================
     RESTORE ORIGINAL
  ======================================================= */

  function restoreOriginal(){

    if(!currentLayer){
      return;
    }


    const image =
      currentLayer._image;


    if(!image){
      return;
    }


    if(currentSource){

      image.src =
        currentSource;

    }


    currentProcessedURL =
      null;

  }


  /* =======================================================
     APPLY TO LAYER
  ======================================================= */

  async function applyToLayer(layer){

    if(
      !enabled ||
      strength <= 0 ||
      !layer
    ){

      return;

    }


    const image =
      layer._image;


    if(!image){
      return;
    }


    let source =
      image.src;


    if(
      !source ||
      (
        !source.startsWith("data:") &&
        !source.startsWith("blob:") &&
        !source.startsWith("http")
      )
    ){

      return;

    }


    if(
      layer.__cloradSmoothSource
    ){

      currentSource =
        layer.__cloradSmoothSource;


      if(
        image.src !==
        currentSource
      ){

        image.src =
          currentSource;

      }

    }else{

      layer.__cloradSmoothSource =
        source;


      currentSource =
        source;

    }


    currentLayer =
      layer;


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
        image.src !==
        cached
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


      if(
        currentLayer !==
        layer
      ){

        return;

      }


      if(!enabled){
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
     SCHEDULE PROCESS
  ======================================================= */

  function scheduleProcess(){

    if(processTimer){

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
            currentLayer &&
            enabled
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
      !window.L.ImageOverlay
    ){

      return false;

    }


    if(
      L.ImageOverlay.prototype
        .__cloradSmoothingInstalled
    ){

      leafletHookReady =
        true;

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


          if(this._image){

            const image =
              this._image;


            image.addEventListener(
              "load",
              () => {

                if(
                  enabled &&
                  strength > 0 &&
                  currentLayer === this
                ){

                  scheduleProcess();

                }

              },
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


    leafletHookReady =
      true;


    return true;

  }


  /* =======================================================
     SCAN LAYERS
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

        currentLayer =
          layer;


        const image =
          layer._image;


        if(image){

          if(
            !layer.__cloradSmoothSource
          ){

            layer.__cloradSmoothSource =
              image.src;

          }


          currentSource =
            layer.__cloradSmoothSource;

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
     MAP HOOKS
  ======================================================= */

  function installMapHooks(){

    if(
      !window.map ||
      !window.map.on
    ){

      return false;

    }


    if(mapHooksReady){
      return true;
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


    mapHooksReady =
      true;


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


    setStrength(value){

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


      if(enabled){

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
     LEAFLET INITIALIZATION
  ======================================================= */

  function initLeaflet(){

    if(
      !installLeafletHook()
    ){

      setTimeout(
        initLeaflet,
        250
      );

      return;

    }


    if(
      !installMapHooks()
    ){

      setTimeout(
        initLeaflet,
        250
      );

      return;

    }


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

  }


  /* =======================================================
     START
  ======================================================= */

  function init(){

    /*
      Сначала полностью создаём UI.
    */

    createUI();


    /*
      Следим только за существованием
      наших элементов.
    */

    startUIWatcher();


    /*
      Leaflet запускается отдельно.
    */

    initLeaflet();


    /*
      Дополнительная страховка:
      если другой код всё-таки удалит
      элементы сразу после запуска.
    */

    setTimeout(
      repairUI,
      100
    );

    setTimeout(
      repairUI,
      500
    );

    setTimeout(
      repairUI,
      1500
    );

    setTimeout(
      repairUI,
      3000
    );

  }


  /* =======================================================
     DOM START
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
