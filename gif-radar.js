// ============================================================
// CLOrad — Meteoinfo GIF Radar
// Сервер декодирует GIF -> PNG.
// Клиент только получает готовые кадры.
//
// ВАЖНО:
// - интерфейс CLOrad не изменяется
// - текущий кадр никогда не удаляется до загрузки нового
// - используются два изображения для мгновенного переключения
// - пиксели не сглаживаются
// ============================================================

(function(){

"use strict";


// ============================================================
// НАСТРОЙКИ
// ============================================================

const GIF_API = "/api/radar-gif";


// Приблизительная геопривязка исходной карты Meteoinfo.
//
// Это именно географические границы изображения.
// Если после проверки понадобится небольшая корректировка,
// меняется только этот блок.
const GIF_BOUNDS = [
  [40, 20],
  [70, 70]
];


// Небольшой поворот исходного изображения.
// Это калибровочный параметр для проекции исходной карты.
const GIF_ROTATION_DEG = -1.2;


// ============================================================
// СОСТОЯНИЕ
// ============================================================

let gifActive = false;

let gifButton = null;

let gifLayer = null;

let gifFrames = [];

let gifFrameTimes = [];

let gifMeta = null;

let gifFrameRequest = 0;

let gifImageCache = new Map();

let gifPlayTimer = null;

let gifCurrentFrame = -1;


// ============================================================
// DOM
// ============================================================

function $(id){
  return document.getElementById(id);
}


// ============================================================
// CSS ТОЛЬКО ДЛЯ РАСТРА
// Интерфейс сайта не затрагивается.
// ============================================================

function installGIFCSS(){

  if(document.getElementById("clorad-gif-raster-style")){
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "clorad-gif-raster-style";

  style.textContent = `

    .clorad-gif-radar-image {
      position:absolute !important;
      pointer-events:none !important;
      user-select:none !important;
      -webkit-user-drag:none !important;

      image-rendering:pixelated !important;
      image-rendering:crisp-edges !important;

      transform-origin:50% 50% !important;

      backface-visibility:hidden !important;
      -webkit-backface-visibility:hidden !important;

      will-change:
        left,
        top,
        width,
        height,
        transform;

      display:block !important;
    }

  `;

  document.head.appendChild(style);
}


// ============================================================
// КНОПКА GIF
// ============================================================

function createGIFButton(){

  const rainButton =
    $("rainProduct");

  if(!rainButton){
    return;
  }

  gifButton =
    document.getElementById(
      "gifRadarNav"
    );

  if(gifButton){
    return;
  }

  gifButton =
    document.createElement("button");

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

  rainButton.after(
    gifButton
  );

  gifButton.addEventListener(
    "click",
    function(event){

      event.stopPropagation();

      activateGIF();

    }
  );
}


// ============================================================
// АКТИВНАЯ КНОПКА
// Используется существующий механизм CLOrad.
// ============================================================

function setActiveButton(){

  if(
    typeof window.setActiveNav ===
    "function"
  ){

    window.setActiveNav(
      gifButton
    );

    return;
  }

  document
    .querySelectorAll(".n")
    .forEach(
      button =>
        button.classList.remove(
          "active"
        )
    );

  if(gifButton){
    gifButton.classList.add(
      "active"
    );
  }
}


// ============================================================
// ОСТАНОВКА ОСНОВНОГО RADAR/iDark
// ============================================================

function stopNormalRadar(){

  if(
    typeof window.CLOradStopRadar ===
    "function"
  ){

    window.CLOradStopRadar();

  }

}


// ============================================================
// ВРЕМЯ КАДРОВ
//
// Сам GIF Meteoinfo сообщает диапазон последних 3 часов,
// но абсолютные timestamp каждого кадра в API не передаются.
// Поэтому здесь строится временная шкала.
// ============================================================

function buildGIFTimes(count){

  const result = [];

  if(!count){
    return result;
  }

  const newest =
    new Date();

  newest.setSeconds(
    0,
    0
  );

  const step =
    count > 1
      ? 180 / (count - 1)
      : 0;

  for(
    let i = 0;
    i < count;
    i++
  ){

    const minutesAgo =
      180 -
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
          timeZone:"Europe/Moscow"
        }
      )
    );

  }

  return result;
}


// ============================================================
// ВРЕМЯ TIMELINE
// ============================================================

function updateGIFTimeline(
  index
){

  const range =
    $("range");

  if(range){

    range.min =
      "0";

    range.max =
      String(
        Math.max(
          0,
          gifFrames.length - 1
        )
      );

    range.step =
      "1";

    range.value =
      String(index);

  }


  const times =
    gifFrameTimes;

  if(times.length){

    if($("times")){

      $("times").textContent =
        `${times[0]} — ${times[times.length - 1]}`;

    }

  }


  if($("timeLabel")){

    $("timeLabel").textContent =
      "GIF радар · " +
      (
        times[index] ||
        ""
      );

  }


  if($("framesInfo")){

    $("framesInfo").textContent =
      "GIF радар • кадров: " +
      gifFrames.length;

  }

}


// ============================================================
// LOAD IMAGE
// Один Promise на один URL.
// ============================================================

function loadGIFImage(
  url
){

  if(
    gifImageCache.has(url)
  ){

    return gifImageCache.get(url);

  }


  const promise =
    new Promise(
      function(resolve,reject){

        const image =
          new Image();

        image.decoding =
          "async";

        image.draggable =
          false;

        image.onload =
          function(){

            resolve(
              image
            );

          };

        image.onerror =
          function(){

            reject(
              new Error(
                "Не удалось загрузить GIF-кадр"
              )
            );

          };

        image.src =
          url;

      }
    );


  gifImageCache.set(
    url,
    promise
  );


  return promise;
}


// ============================================================
// ПРЕДЗАГРУЗКА СОСЕДНИХ КАДРОВ
// ============================================================

function preloadGIFNeighbors(
  index
){

  const indexes = [
    index - 2,
    index - 1,
    index + 1,
    index + 2,
    index + 3
  ];

  indexes.forEach(
    function(i){

      if(
        i < 0 ||
        i >= gifFrames.length
      ){

        return;

      }

      loadGIFImage(
        gifFrames[i]
      ).catch(
        function(){}
      );

    }
  );

}


// ============================================================
// КАСТОМНЫЙ LEAFLET LAYER
//
// Два <img> находятся одновременно.
// Поэтому при смене кадра старый остаётся видимым,
// пока новый полностью не загружен.
// ============================================================

const RotatedGIFLayer =
  L.Layer.extend({

    initialize:
      function(
        url,
        bounds,
        options
      ){

        this._url =
          url;

        this._bounds =
          L.latLngBounds(
            bounds
          );

        this.options =
          options || {};

        this._front =
          0;

        this._images =
          [];

      },


    onAdd:
      function(map){

        this._map =
          map;


        const pane =
          map.getPanes()
            .overlayPane;


        for(
          let i = 0;
          i < 2;
          i++
        ){

          const img =
            L.DomUtil.create(
              "img",
              "clorad-gif-radar-image",
              pane
            );

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

          img.style.zIndex =
            String(
              this.options.zIndex ??
              6
            );

          img.style.visibility =
            "hidden";

          this._images.push(
            img
          );

        }


        // Первый кадр.
        this._images[0].src =
          this._url;

        this._images[0].style.visibility =
          "visible";


        this._reset();

      },


    onRemove:
      function(){

        this._images.forEach(
          function(img){

            img.onload =
              null;

            img.onerror =
              null;

            img.remove();

          }
        );


        this._images =
          [];

        this._map =
          null;

      },


    getEvents:
      function(){

        return {

          zoom:
            this._reset,

          viewreset:
            this._reset,

          zoomanim:
            this._animateZoom

        };

      },


    setUrl:
      function(
        url
      ){

        if(
          !this._images.length
        ){

          this._url =
            url;

          return this;

        }


        const oldIndex =
          this._front;

        const newIndex =
          oldIndex === 0
            ? 1
            : 0;


        const oldImage =
          this._images[
            oldIndex
          ];

        const newImage =
          this._images[
            newIndex
          ];


        /*
         * ВАЖНО:
         *
         * новый img сначала скрыт.
         * Старый остаётся видимым.
         *
         * Только после onload:
         * новый -> visible
         * старый -> hidden
         *
         * Поэтому пустого кадра нет.
         */

        newImage.style.visibility =
          "hidden";

        newImage.src =
          url;


        const showNew =
          function(){

            newImage.onload =
              null;

            newImage.onerror =
              null;


            newImage.style.visibility =
              "visible";


            oldImage.style.visibility =
              "hidden";


            this._front =
              newIndex;


            this._reset();

          }.bind(this);


        newImage.onload =
          showNew;


        newImage.onerror =
          function(){

            newImage.onload =
              null;

          };


        this._url =
          url;


        this._reset();


        return this;

      },


    _setPosition:
      function(
        nw,
        se
      ){

        if(
          !this._images.length
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


        const transform =
          `rotate(${GIF_ROTATION_DEG}deg)`;


        this._images.forEach(
          function(img){

            img.style.left =
              `${nw.x}px`;

            img.style.top =
              `${nw.y}px`;

            img.style.width =
              `${width}px`;

            img.style.height =
              `${height}px`;

            img.style.transform =
              transform;

          }
        );

      },


    _reset:
      function(){

        if(
          !this._map ||
          !this._images.length
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


    _animateZoom:
      function(e){

        if(
          !this._map ||
          !this._images.length
        ){

          return;

        }


        /*
         * Leaflet 1.9.4.
         * Используем его zoom-анимационный
         * расчёт, чтобы GIF не "съезжал".
         */

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


// ============================================================
// ЗАГРУЗКА META
// ============================================================

async function loadGIFMeta(){

  const response =
    await fetch(
      `${GIF_API}?mode=meta`,
      {
        method:"GET",
        cache:"no-store"
      }
    );


  if(!response.ok){

    throw new Error(
      "GIF metadata HTTP " +
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
      data?.error ||
      "GIF metadata error"
    );

  }


  return data;

}


// ============================================================
// ПОЛУЧЕНИЕ URL КАДРА
// ============================================================

function frameURL(
  index
){

  return (
    `${GIF_API}?frame=${index}`
  );

}


// ============================================================
// ПОКАЗ КАДРА
// ============================================================

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


  const request =
    ++gifFrameRequest;


  const url =
    gifFrames[index];


  if($("loadingFrames")){

    $("loadingFrames")
      .classList.add(
        "show"
      );

  }


  try{

    /*
     * Сначала полностью загружаем
     * новый кадр.
     *
     * Старый слой при этом вообще
     * не трогаем.
     */

    await loadGIFImage(
      url
    );


    if(
      !gifActive ||
      request !== gifFrameRequest
    ){

      return;

    }


    if(!gifLayer){

      gifLayer =
        new RotatedGIFLayer(
          url,
          GIF_BOUNDS,
          {
            zIndex:6
          }
        );

      gifLayer.addTo(
        map
      );

    }else{

      /*
       * setUrl() сам держит старый
       * кадр до полной загрузки нового.
       */

      gifLayer.setUrl(
        url
      );

    }


    gifCurrentFrame =
      index;


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

  }finally{

    if(
      request === gifFrameRequest &&
      $("loadingFrames")
    ){

      $("loadingFrames")
        .classList.remove(
          "show"
        );

    }

  }

}


// ============================================================
// АКТИВАЦИЯ GIF
// ============================================================

async function activateGIF(){

  if(gifActive){

    return;

  }


  gifActive =
    true;


  gifFrameRequest++;


  // Останавливаем iDarkMeteo.
  stopNormalRadar();


  // Ставим активной существующую кнопку.
  setActiveButton();


  try{

    /*
     * Если метаданные уже есть,
     * повторно их не скачиваем.
     */

    if(!gifMeta){

      gifMeta =
        await loadGIFMeta();

    }


    if(
      !gifActive
    ){

      return;

    }


    const count =
      Number(
        gifMeta.frames || 0
      );


    if(!count){

      throw new Error(
        "Meteoinfo GIF не содержит кадров"
      );

    }


    gifFrames =
      Array.from(
        {
          length:count
        },
        function(_,i){

          return frameURL(i);

        }
      );


    gifFrameTimes =
      buildGIFTimes(
        count
      );


    /*
     * Последний кадр = самый свежий.
     */

    const newest =
      count - 1;


    if($("range")){

      $("range").min =
        "0";

      $("range").max =
        String(
          count - 1
        );

      $("range").step =
        "1";

      $("range").value =
        String(
          newest
        );

    }


    /*
     * Загружаем самый свежий кадр.
     */

    await showGIFFrame(
      newest
    );


  }catch(error){

    console.error(
      "CLOrad GIF activation:",
      error
    );

    gifActive =
      false;

    gifFrameRequest++;


    if($("timeLabel")){

      $("timeLabel").textContent =
        "Ошибка GIF радара";

    }

  }

}


// ============================================================
// ДЕАКТИВАЦИЯ GIF
// ============================================================

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


  /*
   * Удаляем только GIF.
   * Обычные iDark-слои здесь НЕ трогаем.
   */

  if(
    gifLayer &&
    map.hasLayer(
      gifLayer
    )
  ){

    map.removeLayer(
      gifLayer
    );

  }


  gifLayer =
    null;

  gifCurrentFrame =
    -1;


  if($("loadingFrames")){

    $("loadingFrames")
      .classList.remove(
        "show"
      );

  }

}


// ============================================================
// PLAY GIF
// ============================================================

function stopGIFPlayback(){

  if(
    gifPlayTimer !== null
  ){

    clearInterval(
      gifPlayTimer
    );

    gifPlayTimer =
      null;

  }

}


function playGIF(){

  if(
    !gifActive ||
    !gifFrames.length
  ){

    return;

  }


  stopGIFPlayback();


  let index =
    gifCurrentFrame >= 0
      ? gifCurrentFrame
      : 0;


  gifPlayTimer =
    setInterval(
      function(){

        if(
          !gifActive
        ){

          stopGIFPlayback();

          return;

        }


        index++;


        if(
          index >= gifFrames.length
        ){

          index =
            0;

        }


        showGIFFrame(
          index
        );

      },
      700
    );

}


// ============================================================
// TIMELINE
// Перехватываем только GIF-режим.
// ============================================================

function setupTimeline(){

  const range =
    $("range");


  if(!range){
    return;
  }


  range.addEventListener(
    "input",
    function(){

      if(
        !gifActive
      ){

        return;

      }


      const index =
        Number(
          range.value
        );


      showGIFFrame(
        index
      );

    },
    true
  );


  const play =
    $("play");


  if(play){

    play.addEventListener(
      "click",
      function(){

        if(
          !gifActive
        ){

          return;

        }


        playGIF();

      },
      true
    );

  }

}


// ============================================================
// НАВИГАЦИЯ
//
// ВАЖНО:
// "Слои" НЕ выключает GIF.
//
// Любая другая кнопка .n выключает GIF.
// ============================================================

function setupNavigation(){

  const nav =
    document.querySelector(
      ".nav"
    );


  if(!nav){
    return;
  }


  nav.addEventListener(
    "click",
    function(event){

      const button =
        event.target.closest(
          ".n"
        );


      if(!button){
        return;
      }


      // "Слои" НЕ выключает GIF.
      if(
        button.id ===
        "layersNav"
      ){

        return;

      }


      // Нажали сам GIF.
      if(
        button === gifButton
      ){

        return;

      }


      // Любая другая кнопка выключает GIF.
      deactivateGIF();

    },
    true
  );

}


// ============================================================
// ГЛОБАЛЬНЫЕ ФУНКЦИИ
// ============================================================

window.CLOradDeactivateGIF =
  deactivateGIF;


window.CLOradGIFActive =
  function(){

    return gifActive;

  };


// ============================================================
// INIT
// ============================================================

function init(){

  installGIFCSS();

  createGIFButton();

  setupTimeline();

  setupNavigation();

}


if(
  document.readyState ===
  "loading"
){

  document.addEventListener(
    "DOMContentLoaded",
    init
  );

}else{

  init();

}

})();
