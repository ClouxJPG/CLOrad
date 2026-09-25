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
     ВАЖНО:

     Теперь существует только ОДИН
     ImageOverlay на всё время работы GIF.

     Мы больше НЕ создаём новый overlay
     на каждый кадр.
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


    if(
      !data ||
      !data.ok
    ){

      throw new Error(
        data?.message ||
        data?.error ||
        "GIF API вернул ошибку"
      );

    }


    const count =
      Number(
        data.frames
      );


    if(
      !Number.isInteger(
        count
      ) ||
      count < 1
    ){

      throw new Error(
        "GIF не содержит кадров"
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

    /*
       Этот объект создаётся ОДИН РАЗ.

       Leaflet дальше сам управляет:

       zoom
       zoom animation
       drag
       pinch
       view reset

       При смене кадра объект НЕ удаляется.
    */

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
         Сначала полностью загружаем
         PNG в память.

         Поэтому текущий кадр
         остаётся на экране.
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
         ПЕРВЫЙ КАДР
      */

      if(
        !gifLayer
      ){

        gifLayer =
          createGIFLayer(
            url
          );

      }


      /*
         ГЛАВНОЕ ИЗМЕНЕНИЕ:

         НЕ:

         removeLayer()
         createLayer()
         addTo()

         А:

         setUrl()

         DOM-элемент остаётся тем же.
         Его Leaflet transform остаётся тем же.
      */

      else{

        gifLayer.setUrl(
          url
        );

      }


      /*
         На всякий случай
         принудительно оставляем
         слой поверх карты.
      */

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


      gifFrames =
        buildFrameUrls(
          Number(
            meta.frames
          )
        );


      gifFrameTimes =
        buildGIFTimes(
          gifFrames.length
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


    /*
       Сам объект можно обнулить,
       потому что при следующем включении
       создастся один новый слой.
    */

    gifLayer =
      null;


    gifFrames =
      [];

    gifFrameTimes =
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


    gifPlaying =
      !gifPlaying;


    if(
      !gifPlaying
    ){

      stopGIFPlayback();

      return;

    }


    $("play").innerHTML =
      '<svg viewBox="0 0 24 24">' +
      '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' +
      '</svg>';


    gifPlayTimer =
      setInterval(
        () => {

          if(
            !gifActive
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


          showGIFFrame(
            index
          );

        },
        700
      );

  }


  function stopGIFPlayback(){

    gifPlaying =
      false;


    if(
      gifPlayTimer
    ){

      clearInterval(
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
