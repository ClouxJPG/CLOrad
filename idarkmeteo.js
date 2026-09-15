/* =========================================================
   CLOrad — IDARKMETEO
   Реальные данные:
   rain / cloudphase / smoke / satrain
========================================================= */

(function(){

  "use strict";

  const API = "/api/idarkmeteo?path=";

  const map = window.map;

  if(!map){
    console.error("CLOrad: карта не найдена");
    return;
  }

  const range =
    document.getElementById("range");

  const timeLabel =
    document.getElementById("timeLabel");

  const times =
    document.getElementById("times");

  const play =
    document.getElementById("play");

  const loading =
    document.getElementById("loadingFrames");

  const framesInfo =
    document.getElementById("framesInfo");

  const frameInput =
    document.getElementById("frameInput");

  /*
     Соответствие кнопок навигации
     продуктам Idarkmeteo.
  */

  const PRODUCTS = {

    rain:{
      button:"Осадки-мм/ч",
      mosaic:"wide",
      title:"Осадки",
      units:"мм/ч"
    },

    cloudphase:{
      button:"Фаза облака",
      mosaic:"swath",
      title:"Фаза облака",
      units:""
    },

    smoke:{
      button:"Дым/пепел",
      mosaic:"swath",
      title:"Дым / пепел",
      units:""
    },

    satrain:{
      button:"Спутниковые осадки",
      mosaic:"coarse",
      title:"Спутниковые осадки",
      units:"мм/ч"
    }

  };

  let activeProduct = null;

  let frames = [];

  let bounds = null;

  let overlay = null;

  let currentFrame = 0;

  let playing = false;

  let playTimer = null;

  let refreshTimer = null;

  let requestId = 0;


  /* =========================================================
     НАВИГАЦИЯ
  ========================================================= */

  const buttons =
    Array.from(
      document.querySelectorAll(
        ".n:not(#layersNav)"
      )
    );


  function getProductFromButton(button){

    const text =
      button.textContent
        .replace(/\s+/g," ")
        .trim();

    for(
      const key of Object.keys(PRODUCTS)
    ){

      if(
        PRODUCTS[key].button === text
      ){
        return key;
      }

    }

    return null;
  }


  /* =========================================================
     OVERLAY
  ========================================================= */

  function removeOverlay(){

    if(!overlay){
      return;
    }

    try{
      map.removeLayer(overlay);
    }catch(error){}

    overlay = null;

  }


  /* =========================================================
     PLAY
  ========================================================= */

  function stopPlayback(){

    playing = false;

    if(playTimer){

      clearTimeout(playTimer);

      playTimer = null;

    }

  }


  /* =========================================================
     LOADING
  ========================================================= */

  function setLoading(state){

    if(!loading){
      return;
    }

    loading.classList.toggle(
      "show",
      !!state
    );

  }


  /* =========================================================
     ВРЕМЯ
  ========================================================= */

  function formatTime(value){

    const date =
      new Date(value);

    if(
      Number.isNaN(
        date.getTime()
      )
    ){
      return value || "—";
    }

    return date.toLocaleString(
      "ru-RU",
      {
        day:"2-digit",
        month:"2-digit",
        hour:"2-digit",
        minute:"2-digit",
        timeZone:"Europe/Moscow"
      }
    );

  }


  /* =========================================================
     TIMELINE
  ========================================================= */

  function updateTimeline(){

    if(
      !activeProduct ||
      !frames.length
    ){

      range.min = "0";
      range.max = "0";
      range.value = "0";

      timeLabel.textContent =
        "Радар не подключён";

      times.innerHTML = "";

      if(framesInfo){

        framesInfo.textContent =
          "Радар пока не подключён";

      }

      return;

    }


    range.min = "0";

    range.max =
      String(
        Math.max(
          0,
          frames.length - 1
        )
      );

    range.value =
      String(currentFrame);


    const current =
      frames[currentFrame];


    timeLabel.textContent =
      activeProduct.title +
      " · " +
      formatTime(current.t);


    const newest =
      frames[0];

    const oldest =
      frames[
        frames.length - 1
      ];


    times.innerHTML =
      "<span>" +
      formatTime(oldest.t) +
      "</span>" +

      "<span>" +
      formatTime(newest.t) +
      "</span>";


    if(framesInfo){

      framesInfo.textContent =
        activeProduct.title +
        " · " +
        frames.length +
        " кадров · шаг " +
        (
          activeProduct.step ||
          "—"
        ) +
        " мин";

    }

  }


  /* =========================================================
     ПОКАЗ КАДРА
  ========================================================= */

  function showFrame(index){

    if(
      !frames.length ||
      !bounds
    ){
      return;
    }


    index =
      Math.max(
        0,
        Math.min(
          index,
          frames.length - 1
        )
      );


    currentFrame = index;


    removeOverlay();


    const frame =
      frames[currentFrame];


    if(
      !frame ||
      !frame.path
    ){
      return;
    }


    const url =
      API +
      encodeURIComponent(
        frame.path
      );


    overlay =
      L.imageOverlay(
        url,
        bounds,
        {
          opacity:1,
          interactive:false,
          zIndex:35
        }
      );


    overlay.addTo(map);


    range.value =
      String(currentFrame);


    updateTimeline();

  }


  /* =========================================================
     ЗАГРУЗКА ПРОДУКТА
  ========================================================= */

  async function loadProduct(
    product,
    options
  ){

    const config =
      PRODUCTS[product];


    if(!config){
      return;
    }


    const id =
      ++requestId;


    stopPlayback();

    setLoading(true);

    removeOverlay();


    activeProduct = {
      product:product,
      title:config.title,
      units:config.units,
      mosaic:config.mosaic,
      step:null
    };


    try{

      const path =
        "frames/" +
        product +
        "/" +
        config.mosaic +
        ".json";


      const response =
        await fetch(
          API +
          encodeURIComponent(path),
          {
            cache:"no-store"
          }
        );


      if(!response.ok){

        throw new Error(
          "HTTP " +
          response.status
        );

      }


      const data =
        await response.json();


      if(id !== requestId){
        return;
      }


      if(
        !data ||
        !Array.isArray(
          data.frames
        ) ||
        !data.frames.length
      ){

        throw new Error(
          "Кадры отсутствуют"
        );

      }


      /*
         box:

         [запад, юг, восток, север]

         Координаты EPSG:3857.
      */

      if(
        !Array.isArray(data.box) ||
        data.box.length < 4
      ){

        throw new Error(
          "У API отсутствует box"
        );

      }


      const southWest =
        L.Projection
          .SphericalMercator
          .unproject(
            L.point(
              data.box[0],
              data.box[1]
            )
          );


      const northEast =
        L.Projection
          .SphericalMercator
          .unproject(
            L.point(
              data.box[2],
              data.box[3]
            )
          );


      bounds =
        L.latLngBounds(
          southWest,
          northEast
        );


      activeProduct.step =
        data.step_minutes ||
        null;


      /*
         Количество кадров берём
         из существующей настройки.
      */

      let count =
        parseInt(
          frameInput?.value || "24",
          10
        );


      if(
        !Number.isFinite(count) ||
        count < 1
      ){

        count = 1;

      }


      /*
         API отдаёт:
         свежий → старый.
      */

      frames =
        data.frames.slice(
          0,
          count
        );


      /*
         Сохраняем текущую позицию
         при автоматическом обновлении.
      */

      let newIndex =
        frames.length - 1;


      if(
        options &&
        options.keepFrame
      ){

        newIndex =
          Math.min(
            currentFrame,
            frames.length - 1
          );

      }


      currentFrame =
        Math.max(
          0,
          newIndex
        );


      updateTimeline();

      showFrame(currentFrame);


      scheduleRefresh();

    }catch(error){

      if(id !== requestId){
        return;
      }


      console.error(
        "CLOrad Idarkmeteo:",
        error
      );


      activeProduct = null;

      frames = [];

      bounds = null;

      removeOverlay();


      timeLabel.textContent =
        "Слой недоступен";


      times.innerHTML = "";


      if(framesInfo){

        framesInfo.textContent =
          "Не удалось загрузить слой";

      }


      if(
        typeof window.msg ===
        "function"
      ){

        window.msg(
          "Не удалось загрузить " +
          config.title
        );

      }

    }finally{

      if(id === requestId){

        setLoading(false);

      }

    }

  }


  /* =========================================================
     АВТООБНОВЛЕНИЕ
  ========================================================= */

  function scheduleRefresh(){

    if(refreshTimer){

      clearTimeout(
        refreshTimer
      );

    }


    refreshTimer =
      setTimeout(
        async function(){

          refreshTimer = null;


          if(
            activeProduct
          ){

            await loadProduct(
              activeProduct.product,
              {
                keepFrame:true
              }
            );

          }

        },
        10 * 60 * 1000
      );

  }


  /* =========================================================
     ВЫБОР СЛОЯ
  ========================================================= */

  function selectProduct(product){

    const button =
      buttons.find(
        button =>
          getProductFromButton(
            button
          ) === product
      );


    if(!button){
      return;
    }


    buttons.forEach(
      item =>
        item.classList.remove(
          "active"
        )
    );


    button.classList.add(
      "active"
    );


    loadProduct(
      product
    );

  }


  /* =========================================================
     ПЕРЕХВАТ НАВИГАЦИИ
  ========================================================= */

  buttons.forEach(
    button => {

      const product =
        getProductFromButton(
          button
        );


      if(!product){
        return;
      }


      button.onclick =
        function(event){

          event.preventDefault();

          event.stopPropagation();


          selectProduct(
            product
          );

        };

    }
  );


  /* =========================================================
     СЛАЙДЕР
  ========================================================= */

  range.addEventListener(
    "input",
    function(){

      if(!activeProduct){
        return;
      }


      showFrame(
        parseInt(
          range.value,
          10
        ) || 0
      );

    }
  );


  /* =========================================================
     PLAY
  ========================================================= */

  play.onclick =
    function(){

      if(
        !activeProduct ||
        !frames.length
      ){
        return;
      }


      playing =
        !playing;


      if(playTimer){

        clearTimeout(
          playTimer
        );

        playTimer = null;

      }


      if(!playing){
        return;
      }


      function tick(){

        if(
          !playing ||
          !activeProduct
        ){
          return;
        }


        currentFrame =
          currentFrame >=
          frames.length - 1
            ? 0
            : currentFrame + 1;


        showFrame(
          currentFrame
        );


        playTimer =
          setTimeout(
            tick,
            650
          );

      }


      tick();

    };


  /* =========================================================
     НАСТРОЙКА КОЛИЧЕСТВА КАДРОВ
  ========================================================= */

  const frameMinus =
    document.getElementById(
      "frameMinus"
    );

  const framePlus =
    document.getElementById(
      "framePlus"
    );


  if(frameMinus){

    frameMinus.addEventListener(
      "click",
      function(){

        if(activeProduct){

          setTimeout(
            () =>
              loadProduct(
                activeProduct.product,
                {
                  keepFrame:true
                }
              ),
            0
          );

        }

      }
    );

  }


  if(framePlus){

    framePlus.addEventListener(
      "click",
      function(){

        if(activeProduct){

          setTimeout(
            () =>
              loadProduct(
                activeProduct.product,
                {
                  keepFrame:true
                }
              ),
            0
          );

        }

      }
    );

  }


  if(frameInput){

    frameInput.addEventListener(
      "change",
      function(){

        if(activeProduct){

          loadProduct(
            activeProduct.product,
            {
              keepFrame:true
            }
          );

        }

      }
    );

  }


  /* =========================================================
     ПУБЛИЧНЫЙ API ДЛЯ БУДУЩИХ СЛОЁВ
  ========================================================= */

  window.CLOradIdarkmeteo = {

    load:loadProduct,

    reload:function(){

      if(activeProduct){

        loadProduct(
          activeProduct.product,
          {
            keepFrame:true
          }
        );

      }

    },

    getActive:function(){

      return activeProduct
        ? activeProduct.product
        : null;

    }

  };


})();
