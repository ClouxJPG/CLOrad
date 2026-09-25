/* =========================================================
   CLOrad — Meteoinfo GIF Radar
   ========================================================= */

(() => {

  "use strict";


  /* =======================================================
     CONFIG
  ======================================================= */

  const API =
    "/api/radar-gif";


  /*
     Уже перепроецированный Web Mercator PNG.
  */

  const GIF_BOUNDS = [

    [
      38.2155955810,
      14.9892981264
    ],

    [
      69.6543707199,
      72.9237642948
    ]

  ];


  /* =======================================================
     STATE
  ======================================================= */

  let gifActive =
    false;

  let gifFrames =
    [];

  let gifFrameTimes =
    [];

  let gifFrameDelays =
    [];

  let gifFrameRequest =
    0;

  let gifMeta =
    null;

  let gifImageCache =
    new Map();

  let gifPlaying =
    false;

  let gifPlayTimer =
    null;

  /*
     Один постоянный ImageOverlay
     на всё время работы GIF.
  */

  let gifLayer =
    null;


  /* =======================================================
     HELPER
  ======================================================= */

  const $ =
    id =>
      document.getElementById(id);


  function showLoading(){

    $("loadingFrames")
      ?.classList
      .add("show");

  }


  function hideLoading(){

    $("loadingFrames")
      ?.classList
      .remove("show");

  }


  /* =======================================================
     STYLE
  ======================================================= */

  function installGIFStyle(){

    if(
      document.getElementById(
        "clorad-gif-style"
      )
    ){

      return;

    }


    const style =
      document.createElement(
        "style"
      );


    style.id =
      "clorad-gif-style";


    style.textContent = `

      .clorad-gif-radar-image{

        image-rendering:
          pixelated !important;

        image-rendering:
          crisp-edges !important;

        pointer-events:
          none !important;

        user-select:
          none !important;

        -webkit-user-drag:
          none !important;

        max-width:
          none !important;

        max-height:
          none !important;

      }

    `;


    document.head.appendChild(
      style
    );

  }


  /* =======================================================
     IMAGE PRELOAD
  ======================================================= */

  function loadImage(
    url
  ){

    if(
      gifImageCache.has(
        url
      )
    ){

      return gifImageCache.get(
        url
      );

    }


    const promise =
      new Promise(
        (
          resolve,
          reject
        ) => {

          const img =
            new Image();


          img.decoding =
            "async";


          img.onload =
            () => {

              resolve(
                img
              );

            };


          img.onerror =
            () => {

              gifImageCache.delete(
                url
              );


              reject(
                new Error(
                  "Не удалось загрузить GIF-кадр"
                )
              );

            };


          img.src =
            url;

        }
      );


    gifImageCache.set(
      url,
      promise
    );


    return promise;

  }


  /* =======================================================
     META
  ======================================================= */

  async function loadGIFMeta(){

    const response =
      await fetch(
        `${API}?mode=meta`,
        {
          method:
            "GET",

          cache:
            "no-store"
        }
      );


    if(
      !response.ok
    ){

      throw new Error(
        "GIF API: HTTP " +
        response.status
      );

    }


    const data =
      await response.json();


    /*
       ВАЖНО:

       API возвращает:

       {
         frames: 19,
         width: 1200,
         height: 1200,
         delays: [...]
       }

       Поэтому наличие data.ok НЕ требуется.
    */

    if(
      !data ||
      !Number.isInteger(
        Number(data.frames)
      ) ||
      Number(data.frames) < 1
    ){

      throw new Error(
        data?.message ||
        data?.error ||
        "GIF API вернул некорректные данные"
      );

    }


    gifMeta =
      data;


    return data;

  }


  /* =======================================================
     FRAME URLS
  ======================================================= */

  function buildFrameUrls(
    count
  ){

    const result =
      [];


    for(
      let i = 0;
      i < count;
      i++
    ){

      result.push(
        `${API}?frame=${i}`
      );

    }


    return result;

  }


  /* =======================================================
     FRAME DELAYS
  ======================================================= */

  function buildGIFDelays(
    count,
    delays
  ){

    const result =
      [];


    for(
      let i = 0;
      i < count;
      i++
    ){

      const value =
        Number(
          delays?.[i]
        );


      /*
         Если API дал настоящий delay —
         используем его.

         Если нет —
         стандартно 700 мс.
      */

      if(
        Number.isFinite(value) &&
        value > 0
      ){

        result.push(
          value
        );

      }else{

        result.push(
          700
        );

      }

    }


    return result;

  }


  /* =======================================================
     FRAME TIMES
  ======================================================= */

  function buildGIFTimes(
    count
  ){

    const result =
      [];


    const newest =
      new Date();


    newest.setSeconds(
      0,
      0
    );


    newest.setMinutes(
      Math.floor(
        newest.getMinutes() /
        10
      ) * 10
    );


    const spanMinutes =
      180;


    const step =
      count > 1
        ? spanMinutes /
          (count - 1)
        : 0;


    for(
      let i = 0;
      i < count;
      i++
    ){

      const minutesAgo =
        spanMinutes -
        i * step;


      const date =
        new Date(
          newest.getTime() -
          minutesAgo *
          60000
        );


      result.push(
        date.toLocaleTimeString(
          "ru-RU",
          {

            hour:
              "2-digit",

            minute:
              "2-digit",

            timeZone:
              "Europe/Moscow"

          }
        )
      );

    }


    return result;

  }


  /* =======================================================
     TIMELINE
  ======================================================= */

  function updateGIFTimeline(
    index
  ){

    if(
      !$("range")
    ){

      return;

    }


    const count =
      gifFrames.length;


    $("range").min =
      0;


    $("range").max =
      Math.max(
        0,
        count - 1
      );


    $("range").value =
      index;


    const time =
      gifFrameTimes[index] ||
      "—";


    $("timeLabel").textContent =
      "GIF радар · " +
      time;


    $("times").innerHTML =
      "<span>" +
      (
        gifFrameTimes[0] ||
        "—"
      ) +
      "</span>" +

      "<span>" +
      (
        gifFrameTimes[
          gifFrameTimes.length - 1
        ] ||
        "—"
      ) +
      "</span>";


    $("framesInfo").textContent =
      "GIF радар • кадров: " +
      count;


    $("intensityValue").textContent =
      "радар";

  }


  /* =======================================================
     PRELOAD NEIGHBORS
  ======================================================= */

  function preloadGIFNeighbors(
    index
  ){

    [

      index - 2,
      index - 1,
      index + 1,
      index + 2

    ]
    .filter(
      i =>
        i >= 0 &&
        i < gifFrames.length
    )
    .forEach(
      i => {

        loadImage(
          gifFrames[i]
        )
        .catch(
          () => {}
        );

      }
    );

  }


  /* =======================================================
     CREATE SINGLE OVERLAY
  ======================================================= */

  function createGIFLayer(
    url
  ){

    const layer =
      L.imageOverlay(
        url,
        GIF_BOUNDS,
        {

          opacity:
            1,

          interactive:
            false,

          zIndex:
            6,

          className:
            "clorad-gif-radar-image"

        }
      );


    layer.addTo(
      window.map
    );


    return layer;

  }


  /* =======================================================
     SHOW FRAME
  ======================================================= */

  async function showGIFFrame(
    index
  ){

    if(
      !gifActive ||
      !gifFrames.length
    ){

      return;

    }


    index =
      Math.max(
        0,
        Math.min(
          Number(index),
          gifFrames.length - 1
        )
      );


    const requestId =
      ++gifFrameRequest;


    const url =
      gifFrames[index];


    try{

      /*
         Сначала загружаем PNG.
         Старый кадр остаётся на месте,
         пока новый полностью не готов.
      */

      await loadImage(
        url
      );


      if(
        !gifActive ||
        requestId !==
          gifFrameRequest
      ){

        return;

      }


      /*
         Первый кадр.
      */

      if(
        !gifLayer
      ){

        gifLayer =
          createGIFLayer(
            url
          );

      }else{

        /*
           Меняем только источник
           существующего ImageOverlay.
        */

        gifLayer.setUrl(
          url
        );

      }


      gifLayer.setOpacity(
        1
      );


      gifLayer.bringToFront();


      updateGIFTimeline(
        index
      );


      preloadGIFNeighbors(
        index
      );


    }catch(error){

      console.error(
        "CLOrad GIF frame:",
        error
      );


      if(
        requestId ===
        gifFrameRequest
      ){

        msg(
          error?.message ||
          "Ошибка GIF-кадра"
        );

      }

    }finally{

      if(
        requestId ===
        gifFrameRequest
      ){

        hideLoading();

      }

    }

  }


  /* =======================================================
     ACTIVATE
  ======================================================= */

  async function activateGIF(){

    if(
      gifActive
    ){

      return;

    }


    /*
       Останавливаем iDarkMeteo.
    */

    if(
      typeof window.CLOradStopRadar ===
      "function"
    ){

      window.CLOradStopRadar();

    }


    gifActive =
      true;


    setActiveNav(
      gifButton
    );


    showLoading();


    $("framesInfo").textContent =
      "Загрузка GIF-радара…";


    $("timeLabel").textContent =
      "Загрузка GIF-радара…";


    try{

      const meta =
        await loadGIFMeta();


      if(
        !gifActive
      ){

        return;

      }


      const count =
        Number(
          meta.frames
        );


      gifFrames =
        buildFrameUrls(
          count
        );


      gifFrameTimes =
        buildGIFTimes(
          count
        );


      gifFrameDelays =
        buildGIFDelays(
          count,
          meta.delays
        );


      const newestIndex =
        gifFrames.length - 1;


      await showGIFFrame(
        newestIndex
      );


    }catch(error){

      console.error(
        "CLOrad GIF:",
        error
      );


      gifActive =
        false;


      if(
        gifLayer
      ){

        if(
          window.map.hasLayer(
            gifLayer
          )
        ){

          window.map.removeLayer(
            gifLayer
          );

        }

        gifLayer =
          null;

      }


      $("timeLabel").textContent =
        "Ошибка GIF-радара";


      $("framesInfo").textContent =
        error?.message ||
        "Не удалось загрузить GIF";


      msg(
        error?.message ||
        "Ошибка GIF-радара"
      );

    }finally{

      hideLoading();

    }

  }


  /* =======================================================
     DEACTIVATE
  ======================================================= */

  function deactivateGIF(){

    gifFrameRequest++;


    gifActive =
      false;


    stopGIFPlayback();


    if(
      gifLayer &&
      window.map &&
      window.map.hasLayer(
        gifLayer
      )
    ){

      window.map.removeLayer(
        gifLayer
      );

    }


    gifLayer =
      null;


    gifFrames =
      [];

    gifFrameTimes =
      [];

    gifFrameDelays =
      [];

    gifMeta =
      null;


    gifImageCache.clear();


    if(
      $("range")
    ){

      $("range").max =
        0;

      $("range").value =
        0;

    }


    if(
      $("times")
    ){

      $("times").textContent =
        "";

    }


    if(
      $("timeLabel")
    ){

      $("timeLabel").textContent =
        "Радар не подключён";

    }


    if(
      $("framesInfo")
    ){

      $("framesInfo").textContent =
        "Радар пока не подключён";

    }


    if(
      $("intensityValue")
    ){

      $("intensityValue").textContent =
        "Нет данных";

    }

  }


  /* =======================================================
     PLAY
  ======================================================= */

  function playGIF(){

    if(
      !gifActive ||
      !gifFrames.length
    ){

      return;

    }


    if(
      gifPlaying
    ){

      stopGIFPlayback();

      return;

    }


    gifPlaying =
      true;


    $("play").innerHTML =
      '<svg viewBox="0 0 24 24">' +
      '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' +
      '</svg>';


    /*
       Вместо setInterval(700):

       каждый следующий кадр запускается
       через delay именно этого кадра.

       Поэтому GIF воспроизводится с
       оригинальной скоростью Meteoinfo.
    */

    const playNext =
      () => {

        if(
          !gifActive ||
          !gifPlaying
        ){

          stopGIFPlayback();

          return;

        }


        let index =
          Number(
            $("range").value
          );


        index++;


        if(
          index >=
          gifFrames.length
        ){

          index =
            0;

        }


        $("range").value =
          index;


        const delay =
          Number(
            gifFrameDelays[index]
          ) || 700;


        /*
           Сразу начинаем подготовку кадра.
        */

        showGIFFrame(
          index
        );


        gifPlayTimer =
          setTimeout(
            playNext,
            delay
          );

      };


    const currentIndex =
      Number(
        $("range").value
      );


    const firstDelay =
      Number(
        gifFrameDelays[currentIndex]
      ) || 700;


    gifPlayTimer =
      setTimeout(
        playNext,
        firstDelay
      );

  }


  function stopGIFPlayback(){

    gifPlaying =
      false;


    if(
      gifPlayTimer
    ){

      clearTimeout(
        gifPlayTimer
      );

    }


    gifPlayTimer =
      null;


    if(
      $("play")
    ){

      $("play").innerHTML =
        '<svg viewBox="0 0 24 24">' +
        '<path d="M7 4l13 8-13 8z"/>' +
        '</svg>';

    }

  }


  /* =======================================================
     GIF BUTTON
  ======================================================= */

  let gifButton =
    document.getElementById(
      "gifRadarNav"
    );


  if(
    !gifButton
  ){

    gifButton =
      document.createElement(
        "button"
      );


    gifButton.className =
      "n";


    gifButton.id =
      "gifRadarNav";


    gifButton.innerHTML = `
      <svg viewBox="0 0 24 24">
        <rect
          x="4"
          y="4"
          width="16"
          height="16"
          rx="2"
        />
        <path d="M9 8v8l6-4z"/>
      </svg>
      GIF радар
    `;


    const rainButton =
      $("rainProduct");


    if(
      rainButton
    ){

      rainButton.after(
        gifButton
      );

    }

  }


  /* =======================================================
     ACTIVE NAV
  ======================================================= */

  function setActiveNav(
    button
  ){

    document
      .querySelectorAll(
        ".n"
      )
      .forEach(
        item =>
          item.classList.remove(
            "active"
          )
      );


    if(
      button
    ){

      button.classList.add(
        "active"
      );

    }

  }


  /* =======================================================
     RANGE
  ======================================================= */

  $("range").addEventListener(
    "input",
    () => {

      if(
        !gifActive
      ){

        return;

      }


      showGIFFrame(
        Number(
          $("range").value
        )
      );

    }
  );


  /* =======================================================
     PLAY BUTTON
  ======================================================= */

  $("play").addEventListener(
    "click",
    event => {

      if(
        !gifActive
      ){

        return;

      }


      event.stopImmediatePropagation();


      playGIF();

    },
    true
  );


  /* =======================================================
     GIF BUTTON
  ======================================================= */

  gifButton.addEventListener(
    "click",
    event => {

      event.stopPropagation();


      activateGIF();

    }
  );


  /* =======================================================
     NAV SWITCHING
  ======================================================= */

  nav.addEventListener(
    "click",
    event => {

      const button =
        event.target.closest(
          ".n"
        );


      if(
        !button
      ){

        return;

      }


      if(
        button.id ===
        "layersNav"
      ){

        return;

      }


      if(
        button ===
        gifButton
      ){

        return;

      }


      deactivateGIF();

    },
    true
  );


  /* =======================================================
     PUBLIC API
  ======================================================= */

  window.CLOradDeactivateGIF =
    deactivateGIF;


  window.CLOradGIFActive =
    () =>
      gifActive;


  window.CLOradShowGIFFrame =
    showGIFFrame;


  window.CLOradPlayGIF =
    playGIF;


  /* =======================================================
     INIT
  ======================================================= */

  installGIFStyle();

})();
