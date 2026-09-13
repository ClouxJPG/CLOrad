/* =========================================================
   CLOrad — Lightning
   Live feed: lightningmaps.org / Blitzortung
   ========================================================= */

(() => {

  "use strict";


  /* =======================================================
     НАСТРОЙКИ
     ======================================================= */

  const WS_URL =
    "wss://live2.lightningmaps.org/";

  const RECONNECT_DELAY =
    5000;

  const MAX_AGE =
    15 * 60 * 1000;

  const UPDATE_INTERVAL =
    1000;


  /* =======================================================
     ОБЪЕКТЫ
     ======================================================= */

  const map =
    window.map;

  const switchElement =
    document.getElementById(
      "lightningSwitch"
    );


  if (!map) {

    console.error(
      "[CLOrad Lightning] window.map отсутствует."
    );

    return;

  }


  if (!switchElement) {

    console.error(
      "[CLOrad Lightning] #lightningSwitch отсутствует."
    );

    return;

  }


  /* =======================================================
     СЛОЙ
     ======================================================= */

  const lightningLayer =
    L.layerGroup();


  /* =======================================================
     СОСТОЯНИЕ
     ======================================================= */

  let socket =
    null;

  let reconnectTimer =
    null;

  let enabled =
    false;

  let strikes =
    [];


  /* =======================================================
     ЦВЕТ МОЛНИИ
     ======================================================= */

  function getStrikeColor(age) {

    if (age < 10_000)
      return "#ffffff";

    if (age < 30_000)
      return "#ffff00";

    if (age < 60_000)
      return "#ffd000";

    if (age < 120_000)
      return "#ff9d00";

    if (age < 180_000)
      return "#ff6500";

    if (age < 300_000)
      return "#ff2d00";

    if (age < 600_000)
      return "#ff0000";

    return "#8b0000";

  }


  /* =======================================================
     ПРОВЕРКА КООРДИНАТ
     ======================================================= */

  function validCoordinates(
    lat,
    lon
  ) {

    return (

      typeof lat === "number" &&
      typeof lon === "number" &&

      Number.isFinite(lat) &&
      Number.isFinite(lon) &&

      lat >= -90 &&
      lat <= 90 &&

      lon >= -180 &&
      lon <= 180

    );

  }


  /* =======================================================
     ДОБАВЛЕНИЕ ОДНОЙ МОЛНИИ
     ======================================================= */

  function addStrike(
    strike
  ) {

    if (!enabled)
      return;


    if (!strike)
      return;


    const lat =
      Number(strike.lat);

    const lon =
      Number(strike.lon);

    const time =
      Number(strike.time);


    if (
      !validCoordinates(
        lat,
        lon
      )
    ) {

      return;

    }


    if (
      !Number.isFinite(time)
    ) {

      return;

    }


    /*
     * live2 использует
     * Unix milliseconds.
     */

    const timeMs =
      time;


    /*
     * Отбрасываем совсем старые данные.
     */

    const age =
      Date.now() -
      timeMs;


    if (
      age < -60_000 ||
      age > MAX_AGE
    ) {

      return;

    }


    /*
     * ID, если сервер его дал.
     */

    const id =
      strike.id != null
        ? String(strike.id)
        : `${timeMs}_${lat}_${lon}`;


    /*
     * Дубликат.
     */

    if (
      strikes.some(
        s => s.id === id
      )
    ) {

      return;

    }


    /*
     * Дополнительная проверка
     * по текущей карте.
     *
     * Делаем большой buffer,
     * чтобы при небольшом движении
     * карты молнии не пропадали.
     */

    const bounds =
      map
        .getBounds()
        .pad(1.5);


    if (
      !bounds.contains(
        [lat, lon]
      )
    ) {

      return;

    }


    /* =====================================================
       MARKER
       ===================================================== */

    const marker =
      L.circleMarker(
        [lat, lon],
        {

          radius:
            age < 15_000
              ? 7
              : 5,

          color:
            "#ffffff",

          weight:
            1,

          opacity:
            1,

          fillColor:
            getStrikeColor(
              Math.max(
                0,
                age
              )
            ),

          fillOpacity:
            Math.max(
              0.2,
              1 -
              Math.max(
                0,
                age
              ) /
              MAX_AGE
            )

        }
      );


    /* =====================================================
       POPUP
       ===================================================== */

    marker.bindPopup(
      () => {

        const currentAge =
          Math.max(
            0,
            Date.now() -
            timeMs
          );


        const ageSeconds =
          Math.round(
            currentAge / 1000
          );


        let ageText;


        if (
          ageSeconds < 60
        ) {

          ageText =
            `${ageSeconds} сек назад`;

        } else {

          ageText =
            `${Math.round(
              ageSeconds / 60
            )} мин назад`;

        }


        return `

          <div
            style="
              min-width:190px;
              font-family:
                -apple-system,
                BlinkMacSystemFont,
                Segoe UI,
                sans-serif;
              line-height:1.5;
            "
          >

            <div
              style="
                font-size:16px;
                font-weight:700;
                margin-bottom:5px;
              "
            >
              ⚡ Удар молнии
            </div>

            <div>
              Время:
              ${new Date(
                timeMs
              ).toLocaleTimeString()}
            </div>

            <div>
              ${ageText}
            </div>

            <div>
              Координаты:
              ${lat.toFixed(3)},
              ${lon.toFixed(3)}
            </div>

          </div>

        `;

      }
    );


    /*
     * Добавляем в слой.
     */

    lightningLayer.addLayer(
      marker
    );


    /*
     * Сохраняем.
     */

    strikes.push({

      id,

      marker,

      time:
        timeMs,

      lat,

      lon

    });

  }


  /* =======================================================
     ОБРАБОТКА ПАКЕТА
     ======================================================= */

  function processMessage(
    raw
  ) {

    if (!enabled)
      return;


    if (
      typeof raw !== "string"
    ) {

      return;

    }


    let data;


    try {

      data =
        JSON.parse(
          raw
        );

    } catch {

      console.warn(
        "[CLOrad Lightning] Получен не JSON:",
        raw.slice(
          0,
          100
        )
      );

      return;

    }


    if (!data)
      return;


    /* =====================================================
       SERVER HELLO
       ===================================================== */

    if (
      data.cid !== undefined
    ) {

      console.log(
        "[CLOrad Lightning] Сервер:",
        data
      );

      return;

    }


    /* =====================================================
       ОСНОВНОЙ ФОРМАТ
       
       {
         time: ...,
         flags: ...,
         strokes: [...]
       }
       ===================================================== */

    if (
      Array.isArray(
        data.strokes
      )
    ) {

      for (
        const strike
        of data.strokes
      ) {

        addStrike(
          strike
        );

      }

      return;

    }


    /*
     * На всякий случай поддерживаем
     * одиночный strike.
     */

    if (
      validCoordinates(
        Number(data.lat),
        Number(data.lon)
      )
    ) {

      addStrike(
        data
      );

    }

  }


  /* =======================================================
     ПОДПИСКА
     ======================================================= */

  function subscribe() {

    if (
      !socket ||
      socket.readyState !==
        WebSocket.OPEN
    ) {

      return;

    }


    const bounds =
      map.getBounds();


    const north =
      bounds.getNorth();

    const east =
      bounds.getEast();

    const south =
      bounds.getSouth();

    const west =
      bounds.getWest();


    /*
     * Формат live2:
     *
     * p = [
     *   latN,
     *   lonE,
     *   latS,
     *   lonW
     * ]
     */

    const message = {

      v: 24,

      i: {},

      s: false,

      x: 0,

      w: 0,

      tx: 0,

      tw: 1,

      a: 4,

      z:
        Math.round(
          map.getZoom()
        ),

      b: true,

      h: "",

      l: 1,

      t: 1,

      p: [
        north,
        east,
        south,
        west
      ],

      r: "A"

    };


    try {

      socket.send(
        JSON.stringify(
          message
        )
      );


      console.log(
        "[CLOrad Lightning] Подписка:",
        message
      );

    } catch (
      error
    ) {

      console.error(
        "[CLOrad Lightning] Ошибка подписки:",
        error
      );

    }

  }


  /* =======================================================
     ПОДКЛЮЧЕНИЕ
     ======================================================= */

  function connect() {

    if (!enabled)
      return;


    /*
     * Уже подключено.
     */

    if (
      socket &&
      (
        socket.readyState ===
          WebSocket.OPEN ||

        socket.readyState ===
          WebSocket.CONNECTING
      )
    ) {

      return;

    }


    console.log(
      "[CLOrad Lightning] Подключение к live2..."
    );


    try {

      socket =
        new WebSocket(
          WS_URL
        );

    } catch (
      error
    ) {

      console.error(
        "[CLOrad Lightning] WebSocket:",
        error
      );

      reconnect();

      return;

    }


    /* =====================================================
       OPEN
       ===================================================== */

    socket.onopen =
      () => {

        console.log(
          "[CLOrad Lightning] ✓ Соединение установлено"
        );


        subscribe();

      };


    /* =====================================================
       MESSAGE
       ===================================================== */

    socket.onmessage =
      event => {

        processMessage(
          event.data
        );

      };


    /* =====================================================
       ERROR
       ===================================================== */

    socket.onerror =
      error => {

        console.warn(
          "[CLOrad Lightning] WebSocket ошибка",
          error
        );

      };


    /* =====================================================
       CLOSE
       ===================================================== */

    socket.onclose =
      event => {

        console.warn(
          "[CLOrad Lightning] Соединение закрыто:",
          event.code,
          event.reason
        );


        socket =
          null;


        if (enabled) {

          reconnect();

        }

      };

  }


  /* =======================================================
     RECONNECT
     ======================================================= */

  function reconnect() {

    if (!enabled)
      return;


    clearTimeout(
      reconnectTimer
    );


    reconnectTimer =
      setTimeout(
        () => {

          reconnectTimer =
            null;

          if (enabled) {

            connect();

          }

        },
        RECONNECT_DELAY
      );

  }


  /* =======================================================
     ОЧИСТКА
     ======================================================= */

  function clearStrikes() {

    lightningLayer.clearLayers();

    strikes =
      [];

  }


  /* =======================================================
     ОБНОВЛЕНИЕ
     ======================================================= */

  function updateStrikes() {

    if (!strikes.length)
      return;


    const now =
      Date.now();


    for (
      let i =
        strikes.length - 1;

      i >= 0;

      i--
    ) {

      const strike =
        strikes[i];


      const age =
        now -
        strike.time;


      /*
       * Старше 15 минут —
       * удалить.
       */

      if (
        age > MAX_AGE
      ) {

        lightningLayer.removeLayer(
          strike.marker
        );


        strikes.splice(
          i,
          1
        );


        continue;

      }


      /*
       * Молния должна
       * постепенно исчезать.
       */

      strike.marker.setStyle({

        fillColor:
          getStrikeColor(
            Math.max(
              0,
              age
            )
          ),

        fillOpacity:
          Math.max(
            0.15,
            1 -
            Math.max(
              0,
              age
            ) /
            MAX_AGE
          ),

        radius:
          age < 15_000
            ? 7
            : 5

      });

    }

  }


  /* =======================================================
     ENABLE
     ======================================================= */

  function enable() {

    if (enabled)
      return;


    enabled =
      true;


    switchElement.classList.add(
      "on"
    );


    if (
      !map.hasLayer(
        lightningLayer
      )
    ) {

      lightningLayer.addTo(
        map
      );

    }


    connect();


    console.log(
      "[CLOrad Lightning] ⚡ ВКЛЮЧЕНО"
    );

  }


  /* =======================================================
     DISABLE
     ======================================================= */

  function disable() {

    enabled =
      false;


    clearTimeout(
      reconnectTimer
    );


    reconnectTimer =
      null;


    if (socket) {

      try {

        socket.onopen =
          null;

        socket.onmessage =
          null;

        socket.onerror =
          null;

        socket.onclose =
          null;

        socket.close();

      } catch {}

      socket =
        null;

    }


    clearStrikes();


    if (
      map.hasLayer(
        lightningLayer
      )
    ) {

      map.removeLayer(
        lightningLayer
      );

    }


    switchElement.classList.remove(
      "on"
    );


    console.log(
      "[CLOrad Lightning] ⚡ ВЫКЛЮЧЕНО"
    );

  }


  /* =======================================================
     ПЕРЕКЛЮЧАТЕЛЬ
     
     ВАЖНО:
     Здесь полностью заменяем старый onclick
     из index.html.
     ======================================================= */

  switchElement.onclick =
    event => {

      event.preventDefault();

      event.stopPropagation();


      if (enabled) {

        disable();

      } else {

        enable();

      }

    };


  /* =======================================================
     ПРИ ДВИЖЕНИИ КАРТЫ
     
     Отправляем новый viewport серверу,
     чтобы он отдавал молнии вокруг
     текущего экрана.
     ======================================================= */

  map.on(
    "moveend zoomend",
    () => {

      if (
        enabled &&
        socket &&
        socket.readyState ===
          WebSocket.OPEN
      ) {

        subscribe();

      }

    }
  );


  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradLightning = {

    enable,

    disable,

    toggle() {

      if (enabled) {

        disable();

      } else {

        enable();

      }

    },

    setEnabled(
      state
    ) {

      if (state) {

        enable();

      } else {

        disable();

      }

    },

    isEnabled() {

      return enabled;

    },

    clear() {

      clearStrikes();

    }

  };


  /* =======================================================
     TIMER
     ======================================================= */

  setInterval(
    updateStrikes,
    UPDATE_INTERVAL
  );


  /* =======================================================
     АВТОЗАПУСК
     ======================================================= */

  enable();


  console.log(
    "[CLOrad Lightning] ⚡ Модуль запущен автоматически."
  );

})();
