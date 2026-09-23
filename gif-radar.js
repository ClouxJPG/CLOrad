/* =========================================================
   CLOrad — Meteoinfo GIF Radar
   Сервер декодирует GIF → PNG.
   Телефон получает уже готовые кадры.
========================================================= */

(() => {

  "use strict";


  /* =======================================================
     CONFIG
  ======================================================= */

  const API =
    "/api/radar-gif";

  /*
     Географическая привязка исходной карты Meteoinfo.

     Это калибровочные границы исходного изображения.
  */

  const GIF_BOUNDS = [
    [40, 20],
    [70, 70]
  ];

  /*
     Небольшая коррекция наклона исходной карты.

     Если направление наклона окажется противоположным,
     меняется только знак этого числа.
  */

  const GIF_ROTATION_DEG =
    -1.2;


  /* =======================================================
     STATE
  ======================================================= */

  let gifActive =
    false;

  let gifLayer =
    null;

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
     PIXEL-PERFECT CSS
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
      document.createElement("style");

    style.id =
      "clorad-gif-style";


    style.textContent = `

      .clorad-gif-radar-image{
        image-rendering:pixelated !important;
        image-rendering:crisp-edges !important;
        -webkit-user-drag:none !important;
        user-select:none !important;
        pointer-events:none !important;
      }

    `;


    document.head.appendChild(
      style
    );

  }


  /* =======================================================
     ROTATED IMAGE LAYER
  ======================================================= */

  const RotatedImageLayer =
    L.Layer.extend({

      initialize(
        url,
        bounds,
        options = {}
      ){

        this._url =
          url;

        this._bounds =
          L.latLngBounds(
            bounds
          );

        this.options =
          options;

      },


      onAdd(map){

        this._map =
          map;


        const img =
          this._image =
            L.DomUtil.create(
              "img",
              "clorad-gif-radar-image",
              map.getPanes().overlayPane
            );


        img.src =
          this._url;

        img.alt =
          "";

        img.decoding =
          "async";

        img.draggable =
          false;


        img.style.position =
          "absolute";

        img.style.pointerEvents =
          "none";

        img.style.userSelect =
          "none";

        img.style.imageRendering =
          "pixelated";

        img.style.transformOrigin =
          "50% 50%";

        img.style.willChange =
          "transform,left,top,width,height";

        img.style.zIndex =
          String(
            this.options.zIndex ?? 6
          );


        this._reset();

      },


      onRemove(){

        if(
          this._image
        ){

          this._image.remove();

        }


        this._image =
          null;

        this._map =
          null;

      },


      getEvents(){

        return {

          zoom:
            this._reset,

          viewreset:
            this._reset,

          zoomanim:
            this._animateZoom

        };

      },


      setUrl(url){

        this._url =
          url;


        if(
          this._image
        ){

          this._image.src =
            url;

        }


        return this;

      },


      _setPosition(
        nw,
        se
      ){

        if(
          !this._image
        ){

          return;

        }


        const width =
          Math.max(
            1,
            se.x - nw.x
          );


        const height =
          Math.max(
            1,
            se.y - nw.y
          );


        this._image.style.left =
          `${nw.x}px`;


        this._image.style.top =
          `${nw.y}px`;


        this._image.style.width =
          `${width}px`;


        this._image.style.height =
          `${height}px`;


        this._image.style.transform =
          `rotate(${GIF_ROTATION_DEG}deg)`;

      },


      _reset(){

        if(
          !this._map ||
          !this._image
        ){

          return;

        }


        const nw =
          this._map.latLngToLayerPoint(
            this._bounds.getNorthWest()
          );


        const se =
          this._map.latLngToLayerPoint(
            this._bounds.getSouthEast()
          );


        this._setPosition(
          nw,
          se
        );

      },


      _animateZoom(e){

        if(
          !this._map ||
          !this._image
        ){

          return;

        }


        const nw =
          this._map._latLngToNewLayerPoint(
            this._bounds.getNorthWest(),
            e.zoom,
            e.center
          );


        const se =
          this._map._latLngToNewLayerPoint(
            this._bounds.getSouthEast(),
            e.zoom,
            e.center
          );


        this._setPosition(
          nw,
          se
        );

      }

    });


  /* =======================================================
     LOAD IMAGE
  ======================================================= */

  function loadImage(url){

    if(
      gifImageCache.has(url)
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


    if(
      !Number.isInteger(
        Number(data.frames)
      ) ||
      Number(data.frames) < 1
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
     BUILD FRAME URLS
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


    /*
       Meteoinfo описывает GIF как
       последние 3 часа.

       Сам endpoint кадров абсолютные
       timestamp каждого кадра не отдаёт,
       поэтому здесь используется
       расчётная временная шкала.
    */

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
          minutesAgo *
          60000
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
     UPDATE TIMELINE
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
     PRELOAD NEIGHBOURS
  ======================================================= */

  function preloadGIFNeighbors(
    index
  ){

    const indexes =
      [
        index - 1,
        index + 1,
        index - 2,
        index + 2
      ];


    indexes
      .filter(
        i =>
          i >= 0 &&
          i < gifFrames.length
      )
      .forEach(
        i => {

          loadImage(
            gifFrames[i]
          ).catch(
            () => {}
          );

        }
      );

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

      await loadImage(
        url
      );


      if(
        !gifActive ||
        requestId !== gifFrameRequest
      ){

        return;

      }


      /*
         Один постоянный слой.

         При смене кадра сам Leaflet-слой
         не уничтожается.
      */

      if(
        !gifLayer
      ){

        gifLayer =
          new RotatedImageLayer(
            url,
            GIF_BOUNDS,
            {
              zIndex:6
            }
          );


        gifLayer.addTo(
          window.map
        );

      }else{

        gifLayer.setUrl(
          url
        );

        gifLayer._reset();

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


    gifActive =
      true;


    /*
       Останавливаем iDarkMeteo
       ДО загрузки GIF.
    */

    if(
      typeof window.CLOradStopRadar ===
      "function"
    ){

      window.CLOradStopRadar();

    }


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


      /*
         Последний кадр =
         самый новый.
      */

      const newestIndex =
        gifFrames.length - 1;


      $("range").min =
        0;

      $("range").max =
        newestIndex;

      $("range").value =
        newestIndex;


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

    if(
      !gifActive &&
      !gifLayer
    ){

      return;

    }


    gifActive =
      false;


    gifFrameRequest++;


    stopGIFPlayback();


    if(
      gifLayer &&
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

    gifMeta =
      null;


    gifImageCache.clear();


    $("range").max =
      0;

    $("range").value =
      0;

    $("times").textContent =
      "";

    $("timeLabel").textContent =
      "Радар не подключён";

    $("framesInfo").textContent =
      "Радар пока не подключён";

    $("intensityValue").textContent =
      "Нет данных";

  }


  /* =======================================================
     PLAY GIF
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
            !gifActive ||
            !gifFrames.length
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
     NAV ACTIVE
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


      /*
         Слои НЕ выключают GIF.
      */

      if(
        button.id ===
        "layersNav"
      ){

        return;

      }


      /*
         Сам GIF не выключает себя.
      */

      if(
        button ===
        gifButton
      ){

        return;

      }


      /*
         Любой другой раздел
         выключает GIF.
      */

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
