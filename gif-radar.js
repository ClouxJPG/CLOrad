/* =========================================================
   CLOrad GIF RADAR
   Независимый радарный GIF-слой
========================================================= */

(() => {

  "use strict";


  /* =======================================================
     CONFIG
  ======================================================= */

  const API_URL =
    "/api/radar-gif";


  /*
     GIF полностью независим от основного
     RDR / iDarkMeteo слоя.
  */

  let gifFrames = [];
  let gifLayer = null;
  let gifFrameIndex = 0;
  let gifTimer = null;
  let gifEnabled = false;
  let gifRequest = 0;


  /* =======================================================
     BUTTON
  ======================================================= */

  function createButton(){

    const head =
      document.querySelector(".header .head");

    if(!head){

      console.error(
        "CLOrad GIF: .header .head не найден"
      );

      return;

    }


    /*
       Не создаём кнопку повторно.
    */

    if(
      document.getElementById(
        "gifRadarBtn"
      )
    ){

      return;

    }


    const button =
      document.createElement("button");


    button.className =
      "h";


    button.id =
      "gifRadarBtn";


    button.type =
      "button";


    button.setAttribute(
      "aria-label",
      "GIF радар"
    );


    button.title =
      "GIF радар";


    /*
       Иконка — квадрат.
       Сделана в том же стиле SVG,
       что и остальные кнопки .h.
    */

    button.innerHTML = `
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <rect
          x="5"
          y="5"
          width="14"
          height="14"
          rx="1.5"
        />
      </svg>
    `;


    /*
       Вставляем перед меню.
       Получается:

       Поиск
       Тема
       Настройки
       GIF
       Меню
    */

    const menuButton =
      document.getElementById(
        "menuBtn"
      );


    if(menuButton){

      head.insertBefore(
        button,
        menuButton
      );

    }else{

      head.appendChild(
        button
      );

    }


    button.addEventListener(
      "click",
      event => {

        event.stopPropagation();

        toggleGIF();

      }
    );


    /*
       Добавляем стили только для GIF.
       Основной index.html не изменяется.
    */

    addStyles();


    console.log(
      "CLOrad GIF: кнопка создана"
    );

  }


  /* =======================================================
     STYLES
  ======================================================= */

  function addStyles(){

    if(
      document.getElementById(
        "cloradGifStyles"
      )
    ){

      return;

    }


    const style =
      document.createElement("style");


    style.id =
      "cloradGifStyles";


    style.textContent = `

      #gifRadarBtn{
        flex:none;
      }

      #gifRadarBtn.active{
        background:#222b34;
        border:1px solid #35404a;
        color:#53e39b;
      }

      body.light #gifRadarBtn.active{
        background:#e1e5e8;
        border-color:#c4ccd1;
        color:#36bd78;
      }

    `;


    document.head.appendChild(
      style
    );

  }


  /* =======================================================
     MESSAGE
  ======================================================= */

  function message(text){

    /*
       Используем существующий msg()
       из index.html, если он есть.
    */

    if(
      typeof window.msg ===
      "function"
    ){

      window.msg(text);

      return;

    }


    console.log(
      "CLOrad GIF:",
      text
    );

  }


  /* =======================================================
     FETCH
  ======================================================= */

  async function fetchGIFData(){

    const response =
      await fetch(
        API_URL,
        {
          method:"GET",
          cache:"no-store",
          headers:{
            "Accept":
              "application/json"
          }
        }
      );


    if(
      !response.ok
    ){

      let detail = "";

      try{

        const data =
          await response.json();

        detail =
          data.message ||
          data.error ||
          "";

      }catch{}


      throw new Error(
        "GIF API: HTTP " +
        response.status +
        (
          detail
            ? " — " + detail
            : ""
        )
      );

    }


    const data =
      await response.json();


    if(
      !data ||
      !Array.isArray(
        data.frames
      )
    ){

      throw new Error(
        "GIF API вернул некорректные кадры"
      );

    }


    if(
      !data.frames.length
    ){

      throw new Error(
        "GIF не содержит кадров"
      );

    }


    if(
      !data.bounds
    ){

      throw new Error(
        "GIF API не вернул географические bounds"
      );

    }


    return data;

  }


  /* =======================================================
     BOUNDS
  ======================================================= */

  function getBounds(bounds){

    /*
       Ожидаемый формат:

       [
         [south, west],
         [north, east]
       ]

       либо:

       {
         south,
         west,
         north,
         east
       }
    */


    if(
      Array.isArray(bounds) &&
      bounds.length === 2 &&
      Array.isArray(bounds[0]) &&
      Array.isArray(bounds[1])
    ){

      return L.latLngBounds(
        [
          Number(bounds[0][0]),
          Number(bounds[0][1])
        ],
        [
          Number(bounds[1][0]),
          Number(bounds[1][1])
        ]
      );

    }


    if(
      bounds &&
      Number.isFinite(
        Number(bounds.south)
      ) &&
      Number.isFinite(
        Number(bounds.west)
      ) &&
      Number.isFinite(
        Number(bounds.north)
      ) &&
      Number.isFinite(
        Number(bounds.east)
      )
    ){

      return L.latLngBounds(
        [
          Number(bounds.south),
          Number(bounds.west)
        ],
        [
          Number(bounds.north),
          Number(bounds.east)
        ]
      );

    }


    throw new Error(
      "Некорректные bounds GIF"
    );

  }


  /* =======================================================
     REMOVE GIF LAYER
  ======================================================= */

  function removeGIFLayer(){

    if(
      gifLayer
    ){

      try{

        map.removeLayer(
          gifLayer
        );

      }catch{}

      gifLayer =
        null;

    }

  }


  /* =======================================================
     STOP GIF
  ======================================================= */

  function stopGIF(){

    if(
      gifTimer
    ){

      clearInterval(
        gifTimer
      );

      gifTimer =
        null;

    }

  }


  /* =======================================================
     SHOW FRAME
  ======================================================= */

  function showGIFFrame(){

    if(
      !gifEnabled ||
      !gifFrames.length
    ){

      return;

    }


    const frame =
      gifFrames[
        gifFrameIndex
      ];


    if(
      !frame ||
      !frame.url
    ){

      return;

    }


    /*
       Только GIF-слой.
       Никакой activeLayer здесь нет.
    */

    if(
      gifLayer
    ){

      map.removeLayer(
        gifLayer
      );

      gifLayer =
        null;

    }


    const bounds =
      getBounds(
        frame.bounds ||
        window.__cloradGifBounds
      );


    gifLayer =
      L.imageOverlay(
        frame.url,
        bounds,
        {
          opacity:1,
          interactive:false,
          zIndex:5
        }
      );


    gifLayer.addTo(
      map
    );


    /*
       Если API передал время —
       показываем его в консоли.
       Основной timeline не трогаем.
    */

    if(
      frame.t
    ){

      console.log(
        "CLOrad GIF:",
        frame.t
      );

    }

  }


  /* =======================================================
     START ANIMATION
  ======================================================= */

  function startAnimation(){

    stopGIF();


    /*
       Первый кадр сразу.
    */

    gifFrameIndex = 0;

    showGIFFrame();


    /*
       Время кадра берём из API,
       если оно есть.
    */

    let delay = 500;


    if(
      gifFrames[0]?.duration
    ){

      delay =
        Math.max(
          100,
          Number(
            gifFrames[0].duration
          )
        );

    }


    gifTimer =
      setInterval(
        () => {

          if(
            !gifEnabled ||
            !gifFrames.length
          ){

            return;

          }


          gifFrameIndex++;


          if(
            gifFrameIndex >=
            gifFrames.length
          ){

            gifFrameIndex = 0;

          }


          showGIFFrame();


        },
        delay
      );

  }


  /* =======================================================
     LOAD GIF
  ======================================================= */

  async function loadGIF(){

    const request =
      ++gifRequest;


    message(
      "Загрузка GIF радара…"
    );


    try{

      const data =
        await fetchGIFData();


      if(
        request !== gifRequest
      ){

        return;

      }


      gifFrames =
        data.frames
          .map(
            frame => {

              if(
                typeof frame ===
                "string"
              ){

                return {
                  url:frame
                };

              }


              return {
                url:
                  frame.url ||
                  frame.path,

                t:
                  frame.t ||
                  frame.time,

                duration:
                  frame.duration,

                bounds:
                  frame.bounds
              };

            }
          )
          .filter(
            frame =>
              frame.url
          );


      if(
        !gifFrames.length
      ){

        throw new Error(
          "После обработки GIF кадров нет"
        );

      }


      window.__cloradGifBounds =
        data.bounds;


      /*
         Если API прислал bounds
         отдельно — применяем их
         ко всем кадрам.
      */

      gifFrames =
        gifFrames.map(
          frame => ({
            ...frame,
            bounds:
              frame.bounds ||
              data.bounds
          })
        );


      startAnimation();


      message(
        "GIF радар включён"
      );


    }catch(error){

      console.error(
        "CLOrad GIF:",
        error
      );


      gifEnabled =
        false;


      const button =
        document.getElementById(
          "gifRadarBtn"
        );


      button?.classList.remove(
        "active"
      );


      stopGIF();
      removeGIFLayer();


      message(
        error?.message ||
        "Не удалось загрузить GIF"
      );

    }

  }


  /* =======================================================
     TOGGLE
  ======================================================= */

  async function toggleGIF(){

    const button =
      document.getElementById(
        "gifRadarBtn"
      );


    gifEnabled =
      !gifEnabled;


    if(
      !gifEnabled
    ){

      /*
         Выключаем ТОЛЬКО GIF.
         Остальные слои не трогаем.
      */

      stopGIF();
      removeGIFLayer();


      if(button){

        button.classList.remove(
          "active"
        );

      }


      message(
        "GIF радар выключен"
      );


      return;

    }


    if(button){

      button.classList.add(
        "active"
      );

    }


    /*
       Если кадры уже были получены —
       не скачиваем GIF повторно.
    */

    if(
      gifFrames.length
    ){

      startAnimation();

      message(
        "GIF радар включён"
      );

      return;

    }


    await loadGIF();

  }


  /* =======================================================
     PUBLIC API
  ======================================================= */

  window.CLOradGIF = {

    enable:() => {

      if(!gifEnabled){

        toggleGIF();

      }

    },

    disable:() => {

      if(gifEnabled){

        toggleGIF();

      }

    },

    reload:() => {

      gifFrames = [];

      gifFrameIndex = 0;

      stopGIF();
      removeGIFLayer();

      if(
        gifEnabled
      ){

        loadGIF();

      }

    },

    isEnabled:() =>
      gifEnabled

  };


  /* =======================================================
     INIT
  ======================================================= */

  function init(){

    createButton();

  }


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
