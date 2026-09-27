/* =========================================================
   CLOrad — Layers Fix
   Принудительное управление панелью "Слои"
   Загружается ПОСЛЕ всех остальных скриптов
========================================================= */

(() => {

  "use strict";

  function initLayersFix(){

    const layers =
      document.getElementById("layers");

    const layersNav =
      document.getElementById("layersNav");

    const oyaSwitch =
      document.getElementById("oyaSwitch");

    const reflectivitySwitch =
      document.getElementById("reflectivitySwitch");

    const lightningSwitch =
      document.getElementById("lightningSwitch");

    if(!layers){

      console.error(
        "CLOrad Layers Fix: #layers не найден"
      );

      return;

    }

    /* =====================================================
       ПАНЕЛЬ СЛОЁВ — ПРЯМО В BODY
    ===================================================== */

    if(
      layers.parentElement !== document.body
    ){

      document.body.appendChild(
        layers
      );

    }

    /* =====================================================
       ПРИНУДИТЕЛЬНЫЕ СТИЛИ
    ===================================================== */

    layers.style.setProperty(
      "position",
      "fixed",
      "important"
    );

    layers.style.setProperty(
      "z-index",
      "2147483647",
      "important"
    );

    layers.style.setProperty(
      "pointer-events",
      "auto",
      "important"
    );

    layers.style.setProperty(
      "touch-action",
      "none",
      "important"
    );

    layers
      .querySelectorAll("*")
      .forEach(
        element => {

          element.style.setProperty(
            "pointer-events",
            "auto",
            "important"
          );

        }
      );

    /* SVG и текст не должны забирать клик
       у кнопки */

    layers
      .querySelectorAll(
        "svg,span,i"
      )
      .forEach(
        element => {

          element.style.setProperty(
            "pointer-events",
            "none",
            "important"
          );

        }
      );

    /* =====================================================
       ОТКРЫТИЕ / ЗАКРЫТИЕ
    ===================================================== */

    function toggleLayers(){

      const hidden =
        layers.classList.contains(
          "hidden"
        );

      if(hidden){

        layers.classList.remove(
          "hidden"
        );

        layers.style.setProperty(
          "display",
          "block",
          "important"
        );

        layers.style.setProperty(
          "opacity",
          "1",
          "important"
        );

        layers.style.setProperty(
          "pointer-events",
          "auto",
          "important"
        );

      }else{

        layers.classList.add(
          "hidden"
        );

        layers.style.setProperty(
          "pointer-events",
          "none",
          "important"
        );

      }

    }

    /* =====================================================
       КНОПКА "СЛОИ"
    ===================================================== */

    if(layersNav){

      /*
         Убираем старые onclick
      */

      layersNav.onclick =
        null;

      /*
         Новый прямой обработчик
      */

      layersNav.onclick =
        function(event){

          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          toggleLayers();

          return false;

        };

      /*
         Pointer events
      */

      layersNav.addEventListener(
        "pointerdown",
        event => {

          event.preventDefault();
          event.stopPropagation();

        },
        true
      );

      layersNav.addEventListener(
        "pointerup",
        event => {

          event.preventDefault();
          event.stopPropagation();

          toggleLayers();

        },
        true
      );

    }

    /* =====================================================
       SWITCH HELPER
    ===================================================== */

    function setupSwitch(
      element,
      onText,
      offText
    ){

      if(!element){
        return;
      }

      element.style.setProperty(
        "pointer-events",
        "auto",
        "important"
      );

      element.style.setProperty(
        "touch-action",
        "none",
        "important"
      );

      /*
         Удаляем старый onclick
      */

      element.onclick =
        null;

      /*
         Новый onclick
      */

      element.onclick =
        function(event){

          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          element.classList.toggle(
            "on"
          );

          const enabled =
            element.classList.contains(
              "on"
            );

          if(
            typeof window.msg ===
            "function"
          ){

            window.msg(
              enabled
                ? onText
                : offText
            );

          }

          return false;

        };

      /*
         Pointerdown отдельно,
         чтобы Leaflet/MapLibre
         вообще не получили событие
      */

      element.addEventListener(
        "pointerdown",
        event => {

          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

        },
        true
      );

    }

    /* =====================================================
       ВСЕ ТРИ СЛОЯ
    ===================================================== */

    setupSwitch(
      oyaSwitch,
      "Опасные явления",
      "Опасные явления выключены"
    );

    setupSwitch(
      reflectivitySwitch,
      "Отражаемость",
      "Отражаемость выключена"
    );

    setupSwitch(
      lightningSwitch,
      "Молнии",
      "Молнии выключены"
    );

    /* =====================================================
       ЗАЩИТА ОТ LEAFLET / MAPLIBRE
    ===================================================== */

    layers.addEventListener(
      "pointerdown",
      event => {

        event.stopPropagation();

      },
      true
    );

    layers.addEventListener(
      "pointerup",
      event => {

        event.stopPropagation();

      },
      true
    );

    layers.addEventListener(
      "mousedown",
      event => {

        event.stopPropagation();

      },
      true
    );

    layers.addEventListener(
      "mouseup",
      event => {

        event.stopPropagation();

      },
      true
    );

    layers.addEventListener(
      "click",
      event => {

        event.stopPropagation();

      },
      true
    );

    /* =====================================================
       ДИАГНОСТИКА
    ===================================================== */

    console.log(
      "CLOrad Layers Fix: OK"
    );

    console.log(
      "layers:",
      layers
    );

    console.log(
      "layersNav:",
      layersNav
    );

    console.log(
      "oyaSwitch:",
      oyaSwitch
    );

    console.log(
      "reflectivitySwitch:",
      reflectivitySwitch
    );

    console.log(
      "lightningSwitch:",
      lightningSwitch
    );

  }

  /* =======================================================
     INIT
  ======================================================= */

  if(
    document.readyState ===
    "loading"
  ){

    document.addEventListener(
      "DOMContentLoaded",
      initLayersFix
    );

  }else{

    initLayersFix();

  }

})();
