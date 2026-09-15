/* =========================================================
   CLOrad — IDARKMETEO
   Реальные данные:
   rain / cloudphase / smoke / satrain
========================================================= */

(function(){

  "use strict";


  /* =========================================================
     API
  ========================================================= */

  const API =
    "/api/idarkmeteo?path=";


  /* =========================================================
     MAP
  ========================================================= */

  const map =
    window.map;


  if(!map){

    console.error(
      "CLOrad Idarkmeteo: карта не найдена"
    );

    return;
  }


  /* =========================================================
     DOM
  ========================================================= */

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

  const frameMinus =
    document.getElementById("frameMinus");

  const framePlus =
    document.getElementById("framePlus");


  if(
    !range ||
    !timeLabel ||
    !times ||
    !play
  ){

    console.error(
      "CLOrad Idarkmeteo: таймлайн не найден"
    );

    return;
  }


  /* =========================================================
     ПРОДУКТЫ
  ========================================================= */

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


  /* =========================================================
     СОСТОЯНИЕ
  ========================================================= */

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
     КНОПКИ
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
      map.removeLayer(
        overlay
      );
    }catch(error){}

    overlay = null;
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
     СТАТУС
  ========================================================= */

  function setStatus(text){

    timeLabel.textContent =
      text;
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
        minute:"2-digit"
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

      setStatus(
        "Радар не подключён"
      );

      times.innerHTML = "";

      if(framesInfo){

        framesInfo.textContent =
          "Радар пока не подключён";
      }

      return;
    }


    range.min =
      "0";


    range.max =
      String(
        frames.length - 1
      );


    range.value =
      String(
        currentFrame
      );


    const current =
      frames[currentFrame];


    if(!current){
      return;
    }


    setStatus(
      activeProduct.title +
      " · " +
      formatTime(
        current.t
      )
    );


    const oldest =
      frames[0];


    const newest =
      frames[
        frames.length - 1
      ];


    times.innerHTML =
      "<span>" +
      formatTime(
        oldest.t
      ) +
      "</span>" +
      "<span>" +
      formatTime(
        newest.t
      ) +
      "</span>";


    if(framesInfo){

      framesInfo.textContent =
        activeProduct.title +
        " · " +
        frames.length +
        " кадров" +
        (
          activeProduct.step
            ? " · шаг " +
              activeProduct.step +
              " мин"
            : ""
        );
    }
  }


  /* =========================================================
     URL КАДРА
  ========================================================= */

  function frameUrl(path){

    if(!path){
      return null;
    }


    return (
      API +
      encodeURIComponent(
        path
      )
    );
  }


  /* =========================================================
     BOX
  ========================================================= */

  function makeBounds(box){

    if(
      !Array.isArray(box) ||
      box.length < 4
    ){

      throw new Error(
        "API не вернул box"
      );
    }


    const west =
      Number(box[0]);

    const south =
      Number(box[1]);

    const east =
      Number(box[2]);

    const north =
      Number(box[3]);


    if(
      !Number.isFinite(west) ||
      !Number.isFinite(south) ||
      !Number.isFinite(east) ||
      !Number.isFinite(north)
    ){

      throw new Error(
        "Некорректный box"
      );
    }


    const southWest =
      L.Projection
        .SphericalMercator
        .unproject(
          L.point(
            west,
            south
          )
        );


    const northEast =
      L.Projection
        .SphericalMercator
        .unproject(
          L.point(
            east,
            north
          )
        );


    return L.latLngBounds(
      southWest,
      northEast
    );
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


    currentFrame =
      index;


    const frame =
      frames[currentFrame];


    if(
      !frame ||
      !frame.path
    ){

      console.error(
        "CLOrad: неправильный кадр",
        frame
      );

      return;
    }


    const url =
      frameUrl(
        frame.path
      );


    if(!url){
      return;
    }


    removeOverlay();


    console.log(
      "CLOrad: загружаю кадр:",
      frame.path
    );


    const image =
      L.imageOverlay(
        url,
        bounds,
        {
          opacity:1,
          interactive:false,
          zIndex:35,
          crossOrigin:true
        }
      );


    overlay =
      image;


    image.once(
      "load",
      function(){

        console.log(
          "CLOrad: кадр загружен:",
          frame.path
        );

      }
    );


    image.once(
      "error",
      function(){

        console.error(
          "CLOrad: кадр не загрузился:",
          url
        );


        if(
          overlay === image
        ){

          try{
            map.removeLayer(
              image
            );
          }catch(error){}

          overlay = null;
        }


        setStatus(
          "Ошибка загрузки кадра"
        );

      }
    );


    image.addTo(map);


    updateTimeline();
  }


  /* =========================================================
     PLAY
  ========================================================= */

  function stopPlayback(){

    playing =
      false;


    if(playTimer){

      clearTimeout(
        playTimer
      );

      playTimer = null;
    }
  }


  play.addEventListener(
    "click",
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
    }
  );


  /* =========================================================
     SLIDER
  ========================================================= */

  range.addEventListener(
    "input",
    function(){

      if(
        !activeProduct ||
        !frames.length
      ){
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
     КОЛИЧЕСТВО КАДРОВ
  ========================================================= */

  function reloadCurrentProduct(){

    if(!activeProduct){
      return;
    }


    loadProduct(
      activeProduct.product,
      {
        keepFrame:true
      }
    );
  }


  if(frameMinus){

    frameMinus.addEventListener(
      "click",
      reloadCurrentProduct
    );
  }


  if(framePlus){

    framePlus.addEventListener(
      "click",
      reloadCurrentProduct
    );
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
        function(){

          refreshTimer = null;


          if(activeProduct){

            loadProduct(
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


    frames = [];

    bounds = null;

    currentFrame = 0;


    setStatus(
      "Подключение к радару…"
    );


    if(framesInfo){

      framesInfo.textContent =
        "Получение данных…";
    }


    try{

      /*
       * -----------------------------------------------------
       * METADATA
       * -----------------------------------------------------
       */

      const path =
        "frames/" +
        product +
        "/" +
        config.mosaic +
        ".json";


      const url =
        API +
        encodeURIComponent(
          path
        );


      console.log(
        "CLOrad: metadata:",
        url
      );


      const response =
        await fetch(
          url,
          {
            method:"GET",
            cache:"no-store",
            headers:{
              "Accept":
                "application/json"
            }
          }
        );


      if(!response.ok){

        const text =
          await response.text()
            .catch(
              () => ""
            );


        throw new Error(
          "Metadata HTTP " +
          response.status +
          (
            text
              ? " · " +
                text.slice(
                  0,
                  200
                )
              : ""
          )
        );
      }


      const data =
        await response.json();


      if(id !== requestId){
        return;
      }


      console.log(
        "CLOrad: metadata:",
        data
      );


      if(
        !data ||
        !Array.isArray(
          data.frames
        ) ||
        !data.frames.length
      ){

        throw new Error(
          "В metadata нет кадров"
        );
      }


      /*
       * -----------------------------------------------------
       * BOUNDS
       * -----------------------------------------------------
       */

      bounds =
        makeBounds(
          data.box
        );


      /*
       * -----------------------------------------------------
       * STEP
       * -----------------------------------------------------
       */

      activeProduct.step =
        Number(
          data.step_minutes
        ) || null;


      /*
       * -----------------------------------------------------
       * КОЛИЧЕСТВО КАДРОВ
       * -----------------------------------------------------
       */

      let count =
        parseInt(
          frameInput?.value ||
          "24",
          10
        );


      if(
        !Number.isFinite(count) ||
        count < 1
      ){

        count = 1;
      }


      /*
       * API:
       *
       * новый → старый
       *
       * интерфейс:
       *
       * старый → новый
       */

      frames =
        data.frames
          .filter(
            frame =>
              frame &&
              typeof frame.path ===
                "string" &&
              frame.path.length > 0 &&
              typeof frame.t ===
                "string" &&
              frame.t.length > 0
          )
          .slice(
            0,
            count
          )
          .reverse();


      if(!frames.length){

        throw new Error(
          "После фильтрации кадров нет"
        );
      }


      /*
       * -----------------------------------------------------
       * ПОКАЗЫВАЕМ НОВЕЙШИЙ
       * -----------------------------------------------------
       */

      if(
        options &&
        options.keepFrame
      ){

        currentFrame =
          Math.min(
            currentFrame,
            frames.length - 1
          );

      }else{

        currentFrame =
          frames.length - 1;
      }


      updateTimeline();


      showFrame(
        currentFrame
      );


      scheduleRefresh();


    }catch(error){

      if(id !== requestId){
        return;
      }


      console.error(
        "CLOrad Idarkmeteo ERROR:",
        error
      );


      activeProduct = null;

      frames = [];

      bounds = null;

      removeOverlay();


      setStatus(
        "Радар не подключён"
      );


      times.innerHTML = "";


      range.min = "0";
      range.max = "0";
      range.value = "0";


      if(framesInfo){

        framesInfo.textContent =
          "Ошибка подключения к Idarkmeteo";
      }


      if(
        typeof window.msg ===
        "function"
      ){

        window.msg(
          "Не удалось подключить радар"
        );
      }

    }finally{

      if(id === requestId){

        setLoading(false);
      }
    }
  }


  /* =========================================================
     КНОПКИ ПРОДУКТОВ
     
     ВАЖНО:
     НЕТ АВТОЗАПУСКА.
     
     При открытии сайта:
     ни один продукт не выбран.
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


      button.addEventListener(
        "click",
        function(event){

          event.preventDefault();
          event.stopPropagation();


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

        },
        true
      );

    }
  );


  /* =========================================================
     НАЧАЛЬНОЕ СОСТОЯНИЕ
  ========================================================= */

  buttons.forEach(
    button =>
      button.classList.remove(
        "active"
      )
  );


  setStatus(
    "Радар не подключён"
  );


  if(framesInfo){

    framesInfo.textContent =
      "Радар пока не подключён";
  }


  console.log(
    "CLOrad: Idarkmeteo готов"
  );


})();
