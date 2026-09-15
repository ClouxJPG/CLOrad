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
      "CLOrad Idarkmeteo: window.map не найден"
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
      "CLOrad Idarkmeteo: элементы таймлайна не найдены"
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

      timeLabel.textContent =
        "Радар не подключён";

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


    timeLabel.textContent =
      activeProduct.title +
      " · " +
      formatTime(
        current.t
      );


    const oldest =
      frames[0];


    const newest =
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


    /*
     * Idarkmeteo сейчас может возвращать:
     *
     * data/rain/wide/20260915/0700.rdr
     *
     * API proxy сам преобразует .rdr → archive PNG.
     *
     * Поэтому здесь путь НЕ меняем.
     */

    return (
      API +
      encodeURIComponent(
        path
      )
    );
  }


  /* =========================================================
     BOX → LEAFLET BOUNDS
  ========================================================= */

  function makeBounds(box){

    if(
      !Array.isArray(box) ||
      box.length < 4
    ){

      throw new Error(
        "API не вернул корректный box"
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
      "CLOrad Idarkmeteo: загружаю кадр",
      frame.t,
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
          "CLOrad Idarkmeteo: PNG загружен",
          frame.path
        );

      }
    );


    image.once(
      "error",
      function(){

        console.error(
          "CLOrad Idarkmeteo: ошибка загрузки кадра",
          {
            path:frame.path,
            url:url
          }
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

      }
    );


    image.addTo(map);


    range.value =
      String(
        currentFrame
      );


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


      const url =
        API +
        encodeURIComponent(
          path
        );


      console.log(
        "CLOrad Idarkmeteo: metadata",
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

        const errorText =
          await response.text()
            .catch(
              () => ""
            );


        throw new Error(
          "Metadata HTTP " +
          response.status +
          (
            errorText
              ? " · " +
                errorText.slice(
                  0,
                  180
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
        "CLOrad Idarkmeteo: metadata получена",
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
          "API не вернул кадры"
        );
      }


      bounds =
        makeBounds(
          data.box
        );


      activeProduct.step =
        Number(
          data.step_minutes
        ) || null;


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
       * Интерфейс:
       *
       * старый → новый
       */

      frames =
        data.frames
          .filter(
            frame =>
              frame &&
              frame.path &&
              frame.t
          )
          .slice(
            0,
            count
          )
          .reverse();


      if(!frames.length){

        throw new Error(
          "Корректных кадров нет"
        );
      }


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


      showFrame(
        currentFrame
      );


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
          "Ошибка подключения к Idarkmeteo";
      }


      if(
        typeof window.msg ===
        "function"
      ){

        window.msg(
          "Ошибка подключения к радару"
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
     КНОПКИ ПРОДУКТОВ
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
        };
    }
  );


  /* =========================================================
     АВТОЗАПУСК РАДАРА
  ========================================================= */

  /*
   * Сразу загружаем отражаемость/осадки,
   * чтобы после открытия сайта не было
   * вечного «Радар не подключён».
   */

  const rainButton =
    buttons.find(
      button =>
        getProductFromButton(
          button
        ) === "rain"
    );


  if(rainButton){

    rainButton.classList.add(
      "active"
    );
  }


  /*
   * Небольшая задержка нужна,
   * чтобы Leaflet успел полностью
   * инициализировать карту.
   */

  setTimeout(
    function(){

      loadProduct(
        "rain"
      );

    },
    0
  );


  /* =========================================================
     READY
  ========================================================= */

  console.log(
    "CLOrad: Idarkmeteo подключён"
  );

})();
