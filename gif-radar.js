/* =========================================================
   CLOrad — Meteoinfo GIF Radar
   Сервер декодирует GIF → прозрачный PNG.
   Leaflet получает уже подготовленный радарный растр.
========================================================= */

(() => {

  "use strict";


  /* =======================================================
     CONFIG
  ======================================================= */

  const API =
    "/api/radar-gif";


  /*
     Географический охват исходной карты Meteoinfo.

     ВАЖНО:
     Мы больше НЕ вращаем изображение.

     Leaflet сам масштабирует этот слой при zoom.
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
     RASTER CSS
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
        position:absolute !important;
        display:block !important;

        pointer-events:none !important;
        user-select:none !important;
        -webkit-user-drag:none !important;

        image-rendering:pixelated !important;
        image-rendering:crisp-edges !important;

        transform:none !important;

        backface-visibility:hidden !important;
        -webkit-backface-visibility:hidden !important;

        will-change:left,top,width,height;
      }

    `;


    document.head.appendChild(
      style
    );

  }


  /* =======================================================
     DOUBLE-BUFFER IMAGE LAYER
  ======================================================= */

  const GIFImageLayer =
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

        this._front =
          null;

        this._back =
          null;

      },


      onAdd(map){

        this._map =
          map;


        const pane =
          map.getPanes()
            .overlayPane;


        this._front =
          this._createImage(
            pane
          );


        this._back =
          this._createImage(
            pane
          );


        /*
           Сначала показываем front.
        */

        this._front.style.opacity =
          "0";

        this._back.style.opacity =
          "0";


        this._reset();


        /*
           Загружаем первый кадр.
        */

        this._loadInto(
          this._front,
          this._url,
          true
        );

      },


      onRemove(){

        if(
          this._front
        ){

          this._front.remove();

        }


        if(
          this._back
        ){

          this._back.remove();

        }


        this._front =
          null;

        this._back =
          null;

        this._map =
          null;

      },


      getEvents(){

        return {

          /*
             Только после окончания zoom.

             НИКАКОГО zoomanim.

             Поэтому слой не борется
             с анимацией Leaflet.
          */

          zoomend:
            this._reset,

          viewreset:
            this._reset,

          moveend:
            this._reset

        };

      },


      _createImage(
        pane
      ){

        const img =
          L.DomUtil.create(
            "img",
            "clorad-gif-radar-image",
            pane
          );


        img.alt =
          "";

        img.draggable =
          false;

        img.decoding =
          "async";

        img.style.position =
          "absolute";

        img.style.pointerEvents =
          "none";

        img.style.userSelect =
          "none";

        img.style.imageRendering =
          "pixelated";

        img.style.opacity =
          "0";

        img.style.zIndex =
          String(
            this.options.zIndex ?? 6
          );


        return img;

      },


      _loadInto(
        img,
        url,
        first = false
      ){

        if(
          !img
        ){

          return;

        }


        const generation =
          ++this._generation;


        img.onload =
          () => {

            /*
               Старый запрос уже не актуален.
            */

            if(
              generation !==
              this._generation
            ){

              return;

            }


            /*
               Сначала выставляем геометрию.
            */

            this._reset();


            /*
               Затем показываем готовый кадр.
            */

            img.style.opacity =
              "1";


            /*
               Если это новый back/front,
               второй кадр скрываем.
            */

            if(
              this._front === img
            ){

              if(
                this._back
              ){

                this._back.style.opacity =
                  "0";

              }

            }else{

              if(
                this._front
              ){

                this._front.style.opacity =
                  "0";

              }

            }

          };


        img.onerror =
          () => {

            console.error(
              "CLOrad: ошибка GIF image"
            );

          };


        img.src =
          url;

      },


      setUrl(
        url
      ){

        this._url =
          url;


        /*
           Если front сейчас отображается,
           новый кадр загружаем в back.

           Если back отображается,
           загружаем в front.

           Старый кадр остаётся видимым
           до полного onload нового.
        */

        const frontVisible =
          this._front &&
          this._front.style.opacity ===
            "1";


        const target =
          frontVisible
            ? this._back
            : this._front;


        if(
          !target
        ){

          return this;

        }


        const oldFront =
          this._front;


        const oldBack =
          this._back;


        const generation =
          ++this._generation;


        target.onload =
          () => {

            if(
              generation !==
              this._generation
            ){

              return;

            }


            this._reset();


            target.style.opacity =
              "1";


            if(
              target === oldFront
            ){

              oldBack.style.opacity =
                "0";

            }else{

              oldFront.style.opacity =
                "0";

            }

          };


        target.onerror =
          () => {

            console.error(
              "CLOrad: ошибка загрузки GIF кадра"
            );

          };


        target.src =
          url;


        return this;

      },


      _reset(){

        if(
          !this._map
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


        [
          this._front,
          this._back
        ]
        .forEach(
          img => {

            if(
              !img
            ){

              return;

            }


            img.style.left =
              `${nw.x}px`;


            img.style.top =
              `${nw.y}px`;


            img.style.width =
              `${width}px`;


            img.style.height =
              `${height}px`;

          }
        );

      }

    });


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
        Number(
          data.frames
        )
      ) ||
      Number(
        data.frames
      ) < 1
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
          )
          .catch(
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

      /*
         Сначала полностью загружаем
         PNG в память браузера.

         Поэтому новый кадр не может
         появиться наполовину.
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
         Первый слой.
      */

      if(
        !gifLayer
      ){

        gifLayer =
          new GIFImageLayer(
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

        /*
           Старый кадр остаётся видимым,
           пока новый не загрузится.
        */

        gifLayer.setUrl(
          url
        );

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
       Самое важное:

       сначала полностью выключаем
       iDarkMeteo.
    */

    if(
      typeof window.CLOradStopRadar ===
      "function"
    ){

      window.CLOradStopRadar();

    }


    /*
       Теперь активируем GIF.
    */

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

    /*
       Отменяем ВСЕ старые async frame requests.
    */

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
