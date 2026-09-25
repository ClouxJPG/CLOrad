/* =========================================================
   CLOrad — Meteoinfo GIF Radar
   Сервер декодирует GIF → прозрачный PNG.
   Leaflet получает подготовленный радарный растр.
========================================================= */

(() => {

  "use strict";


  /* =======================================================
     CONFIG
  ======================================================= */

  const API =
    "/api/radar-gif";


  /*
     Временная географическая рамка исходной карты.

     Она НЕ используется для ручного движения изображения.
     Сам слой теперь является штатным Leaflet ImageOverlay,
     поэтому zoom / drag / pinch идут синхронно с картой.
  */

  const GIF_BOUNDS = [
    [40, 20],
    [70, 70]
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

  let gifFront =
    null;

  let gifBack =
    null;


  /* =======================================================
     HELPERS
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
     CSS
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
        image-rendering:pixelated !important;
        image-rendering:crisp-edges !important;

        pointer-events:none !important;
        user-select:none !important;
        -webkit-user-drag:none !important;

        max-width:none !important;
        max-height:none !important;

        transform-origin:center center !important;
      }

    `;


    document.head.appendChild(
      style
    );

  }


  /* =======================================================
     LOAD IMAGE
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
          method:"GET",
          cache:"no-store"
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
      !Number.isInteger(count) ||
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
        newest.getMinutes() / 10
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
          minutesAgo * 60000
        );


      result.push(
        date.toLocaleTimeString(
          "ru-RU",
          {
            hour:"2-digit",
            minute:"2-digit",
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
     PRELOAD
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
     CREATE OVERLAY
  ======================================================= */

  function createGIFOverlay(
    url,
    opacity
  ){

    const layer =
      L.imageOverlay(
        url,
        GIF_BOUNDS,
        {
          opacity:
            opacity,

          interactive:
            false,

          zIndex:
            6,

          className:
            "clorad-gif-radar-image"
        }
      );


    /*
       Leaflet сам добавляет:

       zoom
       viewreset
       zoomanim

       Поэтому overlay физически следует
       за картой во время движения и zoom.
    */

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


    showLoading();


    try{

      /*
         Полностью загружаем PNG
         до его показа.
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
        !gifFront
      ){

        gifFront =
          createGIFOverlay(
            url,
            1
          );

      }else{

        /*
           Второй overlay загружается
           поверх старого.

           Старый кадр остаётся видимым
           до полной готовности нового.
        */

        gifBack =
          createGIFOverlay(
            url,
            0
          );


        const image =
          gifBack.getElement();


        image.onload =
          () => {

            if(
              !gifActive ||
              requestId !==
                gifFrameRequest
            ){

              return;

            }


            gifBack.setOpacity(
              1
            );


            if(
              gifFront
            ){

              window.map.removeLayer(
                gifFront
              );

            }


            gifFront =
              gifBack;


            gifBack =
              null;

          };

      }


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
       Полностью выключаем iDarkMeteo.
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


    $("loadingFrames")
      ?.classList
      .add("show");


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


      updateGIFTimeline(
        newestIndex
      );


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
      gifFront &&
      window.map &&
      window.map.hasLayer(
        gifFront
      )
    ){

      window.map.removeLayer(
        gifFront
      );

    }


    if(
      gifBack &&
      window.map &&
      window.map.hasLayer(
        gifBack
      )
    ){

      window.map.removeLayer(
        gifBack
      );

    }


    gifFront =
      null;

    gifBack =
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

            index = 0;

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
      .querySelectorAll(".n")
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
     PLAY
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
