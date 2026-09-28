/* =========================================================
   CLOrad — RainRadar
   rainradar.ru / composite
   Отдельный радарный слой

   index.html НЕ изменяется.
   Кнопка RainRadar создаётся этим файлом автоматически
   внутри существующего блока #layers.

   Источник:
   https://rainradar.ru/composite/

   Структура:
   /composite/{timestamp}/{z}/{x}_{y}.png

   Manifest:
   /composite/manifest.json
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const RR_ROOT =
    "https://rainradar.ru/composite/";

  const RR_MANIFEST =
    RR_ROOT + "manifest.json";

  /*
     RainRadar использует тайлы уровней 3–5.
  */
  const RR_MIN_ZOOM = 3;
  const RR_MAX_ZOOM = 5;

  /*
     Географические границы покрытия RainRadar.
     Они нужны, чтобы Leaflet не запрашивал тайлы
     по всему миру.
  */
  const RR_BOUNDS = [
    [35, 15],
    [72, 180]
  ];

  /*
     Обновление manifest.
     60 секунд достаточно: сами данные идут
     примерно с шагом 10 минут.
  */
  const RR_MANIFEST_CACHE_MS = 60000;


  /* =======================================================
     STATE
     ======================================================= */

  let rainRadarLayer = null;

  let rainRadarEnabled = false;

  let rainRadarManifest = null;

  let rainRadarFrames = [];

  let rainRadarActiveTimestamp = null;

  let rainRadarManifestLoadedAt = 0;

  let rainRadarButton = null;

  let rainRadarLoading = false;

  let rainRadarObserver = null;


  /* =======================================================
     HELPERS
     ======================================================= */

  function get(id) {
    return document.getElementById(id);
  }


  function showMessage(text) {
    if (typeof window.msg === "function") {
      window.msg(text);
      return;
    }

    const old = document.getElementById(
      "cloradRainRadarMessage"
    );

    if (old) {
      old.remove();
    }

    const box =
      document.createElement("div");

    box.id =
      "cloradRainRadarMessage";

    box.textContent = text;

    box.style =
      "position:fixed;" +
      "z-index:2147483647;" +
      "left:50%;" +
      "bottom:125px;" +
      "transform:translateX(-50%);" +
      "background:#202930;" +
      "color:#fff;" +
      "padding:9px 14px;" +
      "border-radius:8px;" +
      "border:1px solid #3d4850;" +
      "white-space:nowrap;" +
      "max-width:calc(100% - 30px);" +
      "overflow:hidden;" +
      "text-overflow:ellipsis;";

    document.body.appendChild(box);

    setTimeout(() => {
      box.remove();
    }, 1800);
  }


  function getMap() {
    return window.map || null;
  }


  /* =======================================================
     RAINRADAR BUTTON
     ======================================================= */

  function createRainRadarButton() {
    if (rainRadarButton) {
      return rainRadarButton;
    }

    const layers =
      get("layers");

    if (!layers) {
      return null;
    }

    /*
       Не создаём вторую кнопку.
    */
    const existing =
      get("rainradarSwitch");

    if (existing) {
      rainRadarButton = existing;
      return existing;
    }

    const layer =
      document.createElement("div");

    layer.className =
      "layer";

    layer.id =
      "rainradarLayerControl";


    /* =====================================================
       ICON
       ===================================================== */

    const icon =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
      );

    icon.setAttribute(
      "viewBox",
      "0 0 24 24"
    );

    const circle =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );

    circle.setAttribute(
      "cx",
      "12"
    );

    circle.setAttribute(
      "cy",
      "12"
    );

    circle.setAttribute(
      "r",
      "7"
    );

    const drop =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );

    drop.setAttribute(
      "d",
      "M12 5c0 3-5 6-5 10a5 5 0 0 0 10 0c0-4-5-7-5-10z"
    );

    icon.appendChild(circle);
    icon.appendChild(drop);


    /* =====================================================
       TEXT
       ===================================================== */

    const text =
      document.createElement("span");

    text.textContent =
      "RainRadar";


    /* =====================================================
       SWITCH
       ===================================================== */

    const button =
      document.createElement("button");

    button.className =
      "switch";

    button.id =
      "rainradarSwitch";

    button.type =
      "button";

    const knob =
      document.createElement("i");

    button.appendChild(knob);


    /* =====================================================
       BUILD
       ===================================================== */

    layer.appendChild(icon);
    layer.appendChild(text);
    layer.appendChild(button);


    /*
       Сначала пытаемся найти существующий
       ДМРЛ-композит / Осадки-мм/ч.

       Если найден — RainRadar ставим сразу
       после него.

       Если нет — ставим в конец блока #layers.
    */

    const children =
      Array.from(
        layers.querySelectorAll(
          ":scope > .layer"
        )
      );


    let insertAfter =
      null;


    for (
      const item of children
    ) {
      const label =
        item
          .querySelector("span")
          ?.textContent
          ?.trim()
          ?.toLowerCase() || "";

      if (
        label.includes("дмрл") ||
        label.includes("композит") ||
        label.includes("осадки-мм") ||
        label.includes("осадки мм") ||
        label.includes("мм/ч")
      ) {
        insertAfter = item;
      }
    }


    if (insertAfter) {
      insertAfter.after(layer);
    } else {
      layers.appendChild(layer);
    }


    rainRadarButton =
      button;


    /*
       Полностью повторяем поведение
       существующих переключателей.
    */

    button.addEventListener(
      "pointerdown",
      event => {
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );


    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        toggleRainRadar();
      },
      true
    );


    return button;
  }


  /* =======================================================
     FIND / INSERT BUTTON
     ======================================================= */

  function ensureRainRadarButton() {
    if (
      get("rainradarSwitch")
    ) {
      rainRadarButton =
        get("rainradarSwitch");

      return true;
    }

    return !!createRainRadarButton();
  }


  /*
     Некоторые существующие CLOrad-модули могут
     добавлять свои .layer динамически.

     Поэтому немного ждём и при необходимости
     переставляем RainRadar после появления
     ДМРЛ/осадков.
  */

  function placeButtonCorrectly() {
    const layers =
      get("layers");

    const button =
      get("rainradarSwitch");

    if (
      !layers ||
      !button
    ) {
      return;
    }

    const rainLayer =
      button.closest(".layer");

    if (!rainLayer) {
      return;
    }

    const children =
      Array.from(
        layers.querySelectorAll(
          ":scope > .layer"
        )
      );

    let target =
      null;

    for (
      const item of children
    ) {
      if (item === rainLayer) {
        continue;
      }

      const label =
        item
          .querySelector("span")
          ?.textContent
          ?.trim()
          ?.toLowerCase() || "";

      if (
        label.includes("дмрл") ||
        label.includes("композит") ||
        label.includes("осадки-мм") ||
        label.includes("осадки мм") ||
        label.includes("мм/ч")
      ) {
        target = item;
      }
    }

    if (
      target &&
      target.nextElementSibling !==
        rainLayer
    ) {
      target.after(rainLayer);
    }
  }


  /* =======================================================
     MANIFEST
     ======================================================= */

  async function loadManifest(
    force = false
  ) {
    const now =
      Date.now();

    if (
      !force &&
      rainRadarManifest &&
      now -
        rainRadarManifestLoadedAt <
        RR_MANIFEST_CACHE_MS
    ) {
      return rainRadarManifest;
    }


    const response =
      await fetch(
        RR_MANIFEST,
        {
          method: "GET",
          cache: "no-store"
        }
      );


    if (!response.ok) {
      throw new Error(
        `RainRadar manifest: HTTP ${response.status}`
      );
    }


    const data =
      await response.json();


    if (!Array.isArray(data)) {
      throw new Error(
        "RainRadar: manifest имеет неверный формат"
      );
    }


    rainRadarManifest =
      data;

    rainRadarManifestLoadedAt =
      now;


    parseManifest(
      data
    );


    return data;
  }


  /* =======================================================
     PARSE MANIFEST
     ======================================================= */

  function parseManifest(
    manifest
  ) {
    const frames = [];


    for (
      const item of manifest
    ) {
      if (
        !Array.isArray(item) ||
        item.length < 2
      ) {
        continue;
      }


      const timestamp =
        Number(item[0]);

      const groups =
        item[1];


      if (
        !Number.isFinite(timestamp) ||
        !Array.isArray(groups)
      ) {
        continue;
      }


      const tiles = [];


      /*
         Manifest RainRadar имеет группы координат.
         По структуре:

         группа 0 → z=3
         группа 1 → z=4
         группа 2 → z=5
      */

      for (
        let z = 0;
        z < groups.length;
        z++
      ) {
        const group =
          groups[z];

        if (
          !Array.isArray(group)
        ) {
          continue;
        }


        const zoom =
          z + 3;


        for (
          const coordinate
            of group
        ) {
          if (
            !Array.isArray(
              coordinate
            ) ||
            coordinate.length < 2
          ) {
            continue;
          }


          const x =
            Number(
              coordinate[0]
            );

          const y =
            Number(
              coordinate[1]
            );


          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y)
          ) {
            continue;
          }


          tiles.push({
            z: zoom,
            x,
            y
          });
        }
      }


      frames.push({
        timestamp,
        date:
          new Date(
            timestamp * 1000
          ),
        tiles
      });
    }


    frames.sort(
      (a, b) =>
        a.timestamp -
        b.timestamp
    );


    rainRadarFrames =
      frames;


    return frames;
  }


  /* =======================================================
     LATEST FRAME
     ======================================================= */

  function getLatestFrame() {
    if (
      !rainRadarFrames.length
    ) {
      return null;
    }

    return (
      rainRadarFrames[
        rainRadarFrames.length - 1
      ]
    );
  }


  /* =======================================================
     FIND FRAME FOR TIMESTAMP
     ======================================================= */

  function findFrame(
    timestamp
  ) {
    return (
      rainRadarFrames.find(
        frame =>
          frame.timestamp ===
          timestamp
      ) ||
      null
    );
  }


  /* =======================================================
     FORMAT TIME
     ======================================================= */

  function formatRainRadarTime(
    timestamp
  ) {
    const date =
      new Date(
        timestamp * 1000
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "—";
    }


    return date.toLocaleString(
      "ru-RU",
      {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow"
      }
    );
  }


  /* =======================================================
     BUILD TILE URL
     ======================================================= */

  function tileUrl(
    timestamp
  ) {
    return (
      RR_ROOT +
      timestamp +
      "/{z}/{x}_{y}.png"
    );
  }


  /* =======================================================
     REMOVE LAYER
     ======================================================= */

  function removeRainRadarLayer() {
    const map =
      getMap();

    if (
      map &&
      rainRadarLayer &&
      map.hasLayer(
        rainRadarLayer
      )
    ) {
      map.removeLayer(
        rainRadarLayer
      );
    }

    rainRadarLayer =
      null;
  }


  /* =======================================================
     CREATE LAYER
     ======================================================= */

  function createRainRadarLayer(
    timestamp
  ) {
    const map =
      getMap();

    if (!map) {
      throw new Error(
        "Карта CLOrad ещё не готова"
      );
    }


    removeRainRadarLayer();


    rainRadarLayer =
      L.tileLayer(
        tileUrl(timestamp),
        {
          minZoom:
            RR_MIN_ZOOM,

          maxZoom:
            14,

          minNativeZoom:
            RR_MIN_ZOOM,

          maxNativeZoom:
            RR_MAX_ZOOM,

          opacity:
            1,

          zIndex:
            620,

          noWrap:
            true,

          bounds:
            RR_BOUNDS,

          updateWhenZooming:
            true,

          updateWhenIdle:
            true,

          keepBuffer:
            2,

          crossOrigin:
            true,

          className:
            "clorad-rainradar-layer"
        }
      );


    rainRadarLayer.addTo(
      map
    );


    /*
       RainRadar должен быть выше
       базовой карты и остальных карт,
       но не ломать интерфейс.
    */

    if (
      typeof rainRadarLayer.bringToFront ===
      "function"
    ) {
      rainRadarLayer.bringToFront();
    }


    rainRadarActiveTimestamp =
      timestamp;


    return rainRadarLayer;
  }


  /* =======================================================
     ENABLE
     ======================================================= */

  async function enableRainRadar() {
    if (
      rainRadarLoading
    ) {
      return;
    }


    const map =
      getMap();

    if (!map) {
      showMessage(
        "Карта ещё не готова"
      );

      return;
    }


    rainRadarLoading =
      true;


    try {
      showMessage(
        "Загрузка RainRadar…"
      );


      await loadManifest(
        false
      );


      const latest =
        getLatestFrame();


      if (!latest) {
        throw new Error(
          "В RainRadar нет доступных кадров"
        );
      }


      createRainRadarLayer(
        latest.timestamp
      );


      rainRadarEnabled =
        true;


      if (
        rainRadarButton
      ) {
        rainRadarButton.classList.add(
          "on"
        );
      }


      showMessage(
        "RainRadar: " +
        formatRainRadarTime(
          latest.timestamp
        )
      );


    } catch (error) {
      rainRadarEnabled =
        false;


      if (
        rainRadarButton
      ) {
        rainRadarButton.classList.remove(
          "on"
        );
      }


      removeRainRadarLayer();


      console.error(
        "[CLOrad RainRadar]",
        error
      );


      showMessage(
        error?.message ||
        "RainRadar не загрузился"
      );


    } finally {
      rainRadarLoading =
        false;
    }
  }


  /* =======================================================
     DISABLE
     ======================================================= */

  function disableRainRadar() {
    rainRadarEnabled =
      false;

    removeRainRadarLayer();

    if (
      rainRadarButton
    ) {
      rainRadarButton.classList.remove(
        "on"
      );
    }

    showMessage(
      "RainRadar выключен"
    );
  }


  /* =======================================================
     TOGGLE
     ======================================================= */

  function toggleRainRadar() {
    if (
      rainRadarEnabled
    ) {
      disableRainRadar();
    } else {
      enableRainRadar();
    }
  }


  /* =======================================================
     REFRESH CURRENT FRAME
     ======================================================= */

  async function refreshRainRadar(
    force = true
  ) {
    if (
      !rainRadarEnabled
    ) {
      return;
    }


    try {
      await loadManifest(
        force
      );


      const latest =
        getLatestFrame();


      if (!latest) {
        return;
      }


      if (
        latest.timestamp !==
        rainRadarActiveTimestamp
      ) {
        createRainRadarLayer(
          latest.timestamp
        );
      }

    } catch (error) {
      console.error(
        "[CLOrad RainRadar refresh]",
        error
      );
    }
  }


  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRainRadar = {
    enable:
      enableRainRadar,

    disable:
      disableRainRadar,

    toggle:
      toggleRainRadar,

    refresh:
      refreshRainRadar,

    getLayer:
      () =>
        rainRadarLayer,

    getFrames:
      () =>
        rainRadarFrames.slice(),

    getLatest:
      getLatestFrame
  };


  /* =======================================================
     OBSERVER
     ======================================================= */

  function startLayerObserver() {
    const layers =
      get("layers");

    if (!layers) {
      return;
    }


    if (
      rainRadarObserver
    ) {
      return;
    }


    rainRadarObserver =
      new MutationObserver(
        () => {
          if (
            !get(
              "rainradarSwitch"
            )
          ) {
            createRainRadarButton();
          }

          placeButtonCorrectly();
        }
      );


    rainRadarObserver.observe(
      layers,
      {
        childList: true,
        subtree: true
      }
    );
  }


  /* =======================================================
     INITIALIZE
     ======================================================= */

  function initRainRadar() {
    if (
      !getMap()
    ) {
      setTimeout(
        initRainRadar,
        100
      );

      return;
    }


    ensureRainRadarButton();

    placeButtonCorrectly();

    startLayerObserver();


    /*
       Обновляем manifest периодически,
       но сам слой не трогаем, пока RainRadar
       выключен.
    */

    setInterval(
      () => {
        refreshRainRadar(
          true
        );
      },
      60000
    );
  }


  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initRainRadar,
      {
        once: true
      }
    );
  } else {
    initRainRadar();
  }

})();
