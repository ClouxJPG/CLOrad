/* =========================================================
   CLOrad — IDARKMETEO CONTROLLER
   Только управление продуктами, кадрами и слоями.
   Декодирование RDR находится в idarkmeteo-raster.js
========================================================= */

(function(){

"use strict";


/* =========================================================
   CHECK
========================================================= */

if(!window.map){

  console.error(
    "CLOrad IDARKMETEO: window.map не найден"
  );

  return;

}

if(!window.CLOIdarkRaster){

  console.error(
    "CLOrad IDARKMETEO: idarkmeteo-raster.js не подключён"
  );

  return;

}


/* =========================================================
   CONSTANTS
========================================================= */

const map =
  window.map;

const API =
  "/api/idarkmeteo?path=";


/* =========================================================
   PRODUCTS
========================================================= */

const PRODUCTS = {

  rain:{
    text:"Осадки-мм/ч",
    path:"frames/rain/wide.json",
    title:"Осадки",
    units:"мм/ч"
  },

  smoke:{
    text:"Дым/пепел",
    path:"frames/smoke/swath.json",
    title:"Дым / пепел",
    units:""
  },

  satrain:{
    text:"Спутниковые осадки",
    path:"frames/satrain/coarse.json",
    title:"Спутниковые осадки",
    units:"мм/ч"
  },

  cloudphase:{
    text:"Фаза облака",
    path:"frames/cloudphase/swath.json",
    title:"Фаза облака",
    units:""
  }

};


/* =========================================================
   STATE
========================================================= */

let activeProduct =
  null;

let activeFrames =
  [];

let activeMetadata =
  null;

let activeLayer =
  null;

let activeBlobUrl =
  null;

let frameIndex =
  0;

let requestGeneration =
  0;

let frameController =
  null;

let productController =
  null;

let refreshTimer =
  null;

let playTimer =
  null;

let playing =
  false;

let loading =
  false;


/* =========================================================
   FRAME COUNT
========================================================= */

let frameCount =
  24;


/* =========================================================
   ELEMENTS
========================================================= */

const $ =
  id =>
    document.getElementById(id);


/* =========================================================
   INITIAL STATE
========================================================= */

window.CLOIdarkMeteo =
  {

    loadProduct,

    stopRadar,

    getState:() => ({

      activeProduct,

      frameCount,

      frameIndex,

      frames:activeFrames.length,

      loading

    })

  };


/* =========================================================
   API URL
========================================================= */

function proxyUrl(path){

  return (
    API +
    encodeURIComponent(
      path
    )
  );

}


/* =========================================================
   TIME FORMAT
========================================================= */

function formatTime(value){

  if(!value){

    return "—";

  }

  const date =
    new Date(value);

  if(
    Number.isNaN(
      date.getTime()
    )
  ){

    return String(value);

  }

  return date.toLocaleTimeString(
    "ru-RU",
    {
      hour:"2-digit",
      minute:"2-digit",
      timeZone:"Europe/Moscow"
    }
  );

}


/* =========================================================
   BOUNDS
========================================================= */

function makeBounds(box){

  if(
    !Array.isArray(box) ||
    box.length < 4
  ){

    throw new Error(
      "Некорректный box"
    );

  }

  const back =
    (x,y) =>
      L.Projection
        .SphericalMercator
        .unproject(
          L.point(
            Number(x),
            Number(y)
          )
        );

  return L.latLngBounds(

    back(
      box[0],
      box[1]
    ),

    back(
      box[2],
      box[3]
    )

  );

}


/* =========================================================
   FETCH WITH ABORT + TIMEOUT
========================================================= */

async function fetchJSON(
  url,
  signal,
  timeout = 30000
){

  const controller =
    new AbortController();

  const abort =
    () => controller.abort();

  if(signal){

    if(signal.aborted){

      controller.abort();

    }else{

      signal.addEventListener(
        "abort",
        abort,
        {once:true}
      );

    }

  }

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try{

    return await fetch(
      url,
      {
        method:"GET",
        cache:"no-store",
        headers:{
          Accept:"application/json"
        },
        signal:
          controller.signal
      }
    );

  }finally{

    clearTimeout(timer);

    signal?.removeEventListener(
      "abort",
      abort
    );

  }

}


/* =========================================================
   FETCH RDR WITH RETRY
========================================================= */

async function fetchRaster(
  path,
  signal,
  attempts = 3
){

  let lastError =
    null;

  for(
    let attempt = 1;
    attempt <= attempts;
    attempt++
  ){

    if(signal?.aborted){

      throw new DOMException(
        "Отменено",
        "AbortError"
      );

    }

    try{

      const response =
        await fetch(
          proxyUrl(path),
          {
            method:"GET",
            cache:"force-cache",
            signal
          }
        );

      if(
        response.ok
      ){

        return await response.arrayBuffer();

      }

      /*
         404 / 401 / 403 нет смысла
         долбить повторно.
      */

      if(
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404
      ){

        throw new Error(
          "Кадр: HTTP " +
          response.status
        );

      }

      throw new Error(
        "Кадр: HTTP " +
        response.status
      );

    }catch(error){

      if(
        error?.name === "AbortError"
      ){

        throw error;

      }

      lastError =
        error;

      if(
        attempt < attempts
      ){

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              500 * attempt
            )
        );

      }

    }

  }

  throw (
    lastError ||
    new Error(
      "Не удалось загрузить RDR"
    )
  );

}


/* =========================================================
   UI
========================================================= */

function setLoading(value){

  loading =
    value;

  const el =
    $("loadingFrames");

  if(!el){

    return;

  }

  el.classList.toggle(
    "show",
    value
  );

}


function setTime(text){

  const el =
    $("timeLabel");

  if(el){

    el.textContent =
      text;

  }

}


function setFramesInfo(text){

  const el =
    $("framesInfo");

  if(el){

    el.textContent =
      text;

  }

}


function setIntensity(){

  const el =
    $("intensityValue");

  if(!el){

    return;

  }

  el.textContent =
    activeProduct === "rain"
      ? "мм/ч"
      : "—";

}


/* =========================================================
   NAV BUTTON
========================================================= */

function findButton(product){

  const config =
    PRODUCTS[product];

  if(!config){

    return null;

  }

  return [
    ...document.querySelectorAll(
      ".n"
    )
  ].find(
    button =>
      button.textContent
        .trim() ===
      config.text
  ) || null;

}


function setActiveButton(product){

  const target =
    findButton(
      product
    );

  document
    .querySelectorAll(".n")
    .forEach(
      button =>
        button.classList.toggle(
          "active",
          button === target
        )
    );

}


/* =========================================================
   REMOVE ACTIVE LAYER
========================================================= */

function removeActiveLayer(){

  const layer =
    activeLayer;

  const url =
    activeBlobUrl;

  activeLayer =
    null;

  activeBlobUrl =
    null;

  if(layer){

    try{

      map.removeLayer(
        layer
      );

    }catch{}

  }

  if(url){

    try{

      URL.revokeObjectURL(
        url
      );

    }catch{}

  }

}


/* =========================================================
   CANCEL CURRENT FRAME
========================================================= */

function cancelFrame(){

  if(frameController){

    try{

      frameController.abort();

    }catch{}

    frameController =
      null;

  }

}


/* =========================================================
   SHOW FRAME
========================================================= */

async function showFrame(
  frame,
  generation,
  index
){

  if(
    !frame ||
    !frame.path
  ){

    throw new Error(
      "У кадра отсутствует path"
    );

  }


  /*
     Отменяем предыдущую загрузку.
  */

  cancelFrame();


  frameController =
    new AbortController();

  const signal =
    frameController.signal;


  setLoading(
    true
  );


  /*
     Загружаем НОВЫЙ кадр,
     старый пока НЕ удаляем.
  */

  const buffer =
    await fetchRaster(
      frame.path,
      signal,
      3
    );


  if(
    generation !==
    requestGeneration
  ){

    return;

  }


  const result =
    await window
      .CLOIdarkRaster
      .frameToImageUrl(
        buffer
      );


  /*
     Поддерживаем оба варианта
     результата декодера.
  */

  const imageUrl =
    typeof result === "string"
      ? result
      : result?.url;

  const header =
    typeof result === "object"
      ? result?.header
      : null;


  if(!imageUrl){

    throw new Error(
      "Декодер RDR не вернул изображение"
    );

  }


  if(
    generation !==
    requestGeneration ||
    signal.aborted
  ){

    try{

      URL.revokeObjectURL(
        imageUrl
      );

    }catch{}

    return;

  }


  const box =
    activeMetadata?.box ||
    header?.box;


  if(!box){

    try{

      URL.revokeObjectURL(
        imageUrl
      );

    }catch{}

    throw new Error(
      "В RDR отсутствует box"
    );

  }


  const bounds =
    makeBounds(
      box
    );


  /*
     Создаём новый слой.
  */

  const newLayer =
    L.imageOverlay(
      imageUrl,
      bounds,
      {
        opacity:1,
        interactive:false,
        crossOrigin:true,
        zIndex:35
      }
    );


  /*
     Новый слой добавляем ПЕРВЫМ.
  */

  newLayer.addTo(
    map
  );


  /*
     Если за время addTo
     пользователь переключил продукт,
     сразу убираем новый слой.
  */

  if(
    generation !==
    requestGeneration
  ){

    map.removeLayer(
      newLayer
    );

    try{

      URL.revokeObjectURL(
        imageUrl
      );

    }catch{}

    return;

  }


  /*
     Старый слой теперь можно удалить.
  */

  const oldLayer =
    activeLayer;

  const oldUrl =
    activeBlobUrl;


  activeLayer =
    newLayer;

  activeBlobUrl =
    imageUrl;


  if(oldLayer){

    try{

      map.removeLayer(
        oldLayer
      );

    }catch{}

  }


  if(oldUrl){

    try{

      URL.revokeObjectURL(
        oldUrl
      );

    }catch{}

  }


  frameIndex =
    index;


  const range =
    $("range");

  if(range){

    range.value =
      index;

  }


  const times =
    $("times");

  if(times){

    times.innerHTML =
      "<span>" +
      formatTime(
        activeFrames[0]?.t
      ) +
      "</span>" +
      "<span>" +
      formatTime(
        activeFrames[
          activeFrames.length - 1
        ]?.t
      ) +
      "</span>";

  }


  setTime(
    `${PRODUCTS[activeProduct].title} • ${formatTime(frame.t)}`
  );


  setIntensity();


  setLoading(
    false
  );

}


/* =========================================================
   LOAD SELECTED FRAME
========================================================= */

async function loadSelectedFrame(
  index
){

  if(
    !activeProduct ||
    !activeFrames.length
  ){

    return;

  }


  const frame =
    activeFrames[index];

  if(!frame){

    return;

  }


  const generation =
    requestGeneration;


  try{

    await showFrame(
      frame,
      generation,
      index
    );

  }catch(error){

    if(
      generation !==
      requestGeneration
    ){

      return;

    }

    if(
      error?.name === "AbortError"
    ){

      return;

    }

    console.error(
      "CLOrad IDARKMETEO frame:",
      error
    );

    setLoading(
      false
    );

    setTime(
      "Ошибка загрузки слоя"
    );

    msg(
      error?.message ||
      "Ошибка загрузки слоя"
    );

  }

}


/* =========================================================
   LOAD PRODUCT
========================================================= */

async function loadProduct(
  productName,
  keepFrame = false
){

  const config =
    PRODUCTS[productName];

  if(!config){

    return;

  }


  /*
     Каждая загрузка продукта
     получает собственное поколение.
  */

  const generation =
    ++requestGeneration;


  if(refreshTimer){

    clearTimeout(
      refreshTimer
    );

    refreshTimer =
      null;

  }


  if(productController){

    try{

      productController.abort();

    }catch{}

  }


  cancelFrame();


  productController =
    new AbortController();


  const signal =
    productController.signal;


  activeProduct =
    productName;

  activeFrames =
    [];

  activeMetadata =
    null;

  frameIndex =
    0;


  setActiveButton(
    productName
  );


  setLoading(
    true
  );

  setTime(
    "Подключение к радару…"
  );

  setFramesInfo(
    "Подключение к радару…"
  );


  try{

    const response =
      await fetchJSON(
        proxyUrl(
          config.path
        ),
        signal,
        30000
      );


    if(
      generation !==
      requestGeneration
    ){

      return;

    }


    if(
      !response.ok
    ){

      throw new Error(
        "frames: HTTP " +
        response.status
      );

    }


    const metadata =
      await response.json();


    if(
      generation !==
      requestGeneration
    ){

      return;

    }


    if(
      !metadata ||
      !Array.isArray(
        metadata.frames
      )
    ){

      throw new Error(
        "Некорректный ответ frames"
      );

    }


    activeMetadata =
      metadata;


    /*
       API отдаёт:
       newest → oldest

       CLOrad использует:
       oldest → newest
    */

    let frames =
      metadata.frames
        .filter(
          frame =>
            frame &&
            frame.path
        )
        .slice(
          0,
          frameCount
        )
        .reverse();


    activeFrames =
      frames;


    if(!frames.length){

      throw new Error(
        "Кадры отсутствуют"
      );

    }


    const range =
      $("range");


    if(range){

      range.min =
        0;

      range.max =
        Math.max(
          0,
          frames.length - 1
        );

    }


    let selectedIndex =
      frames.length - 1;


    if(keepFrame){

      selectedIndex =
        Math.min(
          Number(
            range?.value || 0
          ),
          frames.length - 1
        );

    }


    frameIndex =
      selectedIndex;


    if(range){

      range.value =
        selectedIndex;

    }


    setFramesInfo(
      "Загружено кадров: " +
      frames.length
    );


    const times =
      $("times");

    if(times){

      times.innerHTML =
        "<span>" +
        formatTime(
          frames[0]?.t
        ) +
        "</span>" +
        "<span>" +
        formatTime(
          frames[
            frames.length - 1
          ]?.t
        ) +
        "</span>";

    }


    await showFrame(
      frames[selectedIndex],
      generation,
      selectedIndex
    );


    if(
      generation !==
      requestGeneration
    ){

      return;

    }


    setLoading(
      false
    );


    /*
       Автоматическое обновление
       продукта каждые 10 минут.
    */

    refreshTimer =
      setTimeout(
        () => {

          if(
            generation ===
            requestGeneration
          ){

            loadProduct(
              productName,
              true
            );

          }

        },
        10 * 60 * 1000
      );


  }catch(error){

    if(
      generation !==
      requestGeneration
    ){

      return;

    }


    if(
      error?.name === "AbortError"
    ){

      return;

    }


    console.error(
      "CLOrad IDARKMETEO:",
      error
    );


    setLoading(
      false
    );


    removeActiveLayer();


    setTime(
      "Ошибка подключения"
    );


    setFramesInfo(
      error?.message ||
      "Ошибка загрузки кадра"
    );


    const intensity =
      $("intensityValue");

    if(intensity){

      intensity.textContent =
        "Нет данных";

    }


    msg(
      error?.message ||
      "Ошибка подключения"
    );

  }

}


/* =========================================================
   STOP RADAR
========================================================= */

function stopRadar(){

  ++requestGeneration;


  if(refreshTimer){

    clearTimeout(
      refreshTimer
    );

    refreshTimer =
      null;

  }


  if(productController){

    try{

      productController.abort();

    }catch{}

    productController =
      null;

  }


  cancelFrame();


  activeProduct =
    null;

  activeFrames =
    [];

  activeMetadata =
    null;

  frameIndex =
    0;


  removeActiveLayer();


  const range =
    $("range");

  if(range){

    range.max =
      0;

    range.value =
      0;

  }


  const times =
    $("times");

  if(times){

    times.textContent =
      "";

  }


  setTime(
    "Радар не подключён"
  );


  setFramesInfo(
    "Радар пока не подключён"
  );


  setLoading(
    false
  );


  const intensity =
    $("intensityValue");

  if(intensity){

    intensity.textContent =
      "Нет данных";

  }

}


/* =========================================================
   FRAME COUNT
========================================================= */

function reloadWithFrameCount(){

  if(!activeProduct){

    return;

  }

  loadProduct(
    activeProduct,
    true
  );

}


$("frameMinus")?.addEventListener(
  "click",
  event => {

    event.stopPropagation();

    frameCount =
      Math.max(
        1,
        frameCount - 1
      );

    $("frameInput").value =
      frameCount;

    reloadWithFrameCount();

  }
);


$("framePlus")?.addEventListener(
  "click",
  event => {

    event.stopPropagation();

    frameCount++;

    $("frameInput").value =
      frameCount;

    reloadWithFrameCount();

  }
);


$("frameInput")?.addEventListener(
  "change",
  event => {

    let value =
      parseInt(
        event.target.value,
        10
      );


    if(
      !Number.isFinite(value) ||
      value < 1
    ){

      value =
        1;

    }


    frameCount =
      value;


    event.target.value =
      value;


    reloadWithFrameCount();

  }
);


/* =========================================================
   PRODUCT BUTTONS
========================================================= */

function bindProductButton(
  productName
){

  const button =
    findButton(
      productName
    );

  if(!button){

    console.warn(
      "CLOrad: кнопка не найдена:",
      productName
    );

    return;

  }


  /*
     Защита от повторного bind.
  */

  if(
    button.dataset.idarkBound === "1"
  ){

    return;

  }


  button.dataset.idarkBound =
    "1";


  button.addEventListener(
    "click",
    event => {

      event.preventDefault();
      event.stopPropagation();


      setActiveButton(
        productName
      );


      loadProduct(
        productName
      );

    }
  );

}


bindProductButton(
  "rain"
);

bindProductButton(
  "smoke"
);

bindProductButton(
  "satrain"
);

bindProductButton(
  "cloudphase"
);


/* =========================================================
   MAP BUTTON
========================================================= */

const mapButton =
  [
    ...document.querySelectorAll(".n")
  ].find(
    button =>
      button.textContent.trim() ===
      "Карта"
  );


if(mapButton){

  mapButton.addEventListener(
    "click",
    event => {

      event.preventDefault();
      event.stopPropagation();

      setActiveButton(
        "__none__"
      );

      stopRadar();

    }
  );

}


/* =========================================================
   OTHER NAV BUTTONS
========================================================= */

const warningButton =
  [
    ...document.querySelectorAll(".n")
  ].find(
    button =>
      button.textContent.trim() ===
      "Предупр."
  );


if(warningButton){

  warningButton.addEventListener(
    "click",
    event => {

      event.preventDefault();
      event.stopPropagation();

      setActiveButton(
        "__none__"
      );

      msg(
        "Предупреждения"
      );

    }
  );

}


/* =========================================================
   TIMELINE
========================================================= */

$("range")?.addEventListener(
  "input",
  () => {

    if(
      !activeProduct ||
      !activeFrames.length
    ){

      return;

    }


    const index =
      Number(
        $("range").value
      );


    if(
      !Number.isInteger(index) ||
      !activeFrames[index]
    ){

      return;

    }


    frameIndex =
      index;


    /*
       Немедленно показываем время
       выбранного кадра.
    */

    setTime(
      `${PRODUCTS[activeProduct].title} • ${formatTime(activeFrames[index].t)}`
    );


    loadSelectedFrame(
      index
    );

  }
);


/* =========================================================
   PLAY
========================================================= */

function stopPlayback(){

  playing =
    false;


  if(playTimer){

    clearInterval(
      playTimer
    );

    playTimer =
      null;

  }


  const button =
    $("play");

  if(button){

    button.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>';

  }

}


$("play")?.addEventListener(
  "click",
  () => {

    if(
      !activeFrames.length
    ){

      msg(
        "Радар пока не подключён"
      );

      return;

    }


    if(playing){

      stopPlayback();

      return;

    }


    playing =
      true;


    $("play").innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';


    playTimer =
      setInterval(
        () => {

          if(
            !activeFrames.length ||
            !activeProduct
          ){

            stopPlayback();

            return;

          }


          let next =
            frameIndex + 1;


          if(
            next >=
            activeFrames.length
          ){

            next =
              0;

          }


          const range =
            $("range");


          if(range){

            range.value =
              next;

          }


          frameIndex =
            next;


          loadSelectedFrame(
            next
          );

        },
        700
      );

  }
);


/* =========================================================
   INITIAL
========================================================= */

$("range").max =
  0;

$("range").value =
  0;

setTime(
  "Радар не подключён"
);

setFramesInfo(
  "Радар пока не подключён"
);

setLoading(
  false
);


/*
   Осадки запускаются только один раз
   после полной загрузки DOM.
*/

loadProduct(
  "rain"
);

})();
