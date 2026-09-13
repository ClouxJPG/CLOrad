/* =========================================================
   CLOrad — Lightning
   Blitzortung.org
   Актуальный WebSocket-протокол
   ========================================================= */

(() => {

  "use strict";


  /* =======================================================
     НАСТРОЙКИ
     ======================================================= */

  const SERVERS = [
    "wss://ws7.blitzortung.org/",
    "wss://ws1.blitzortung.org/",
    "wss://ws5.blitzortung.org/",
    "wss://ws6.blitzortung.org/"
  ];

  const STRIKE_LIFETIME = 15 * 60 * 1000;

  const UPDATE_INTERVAL = 3000;

  const RECONNECT_DELAY = 5000;


  /* =======================================================
     СОСТОЯНИЕ
     ======================================================= */

  let socket = null;

  let lightningLayer = null;

  let reconnectTimer = null;

  let enabled = false;

  let currentServer = 0;

  const strikes = [];


  /* =======================================================
     MAP
     ======================================================= */

  const map = window.map;


  if (!map) {

    console.error(
      "[CLOrad Lightning] window.map не найден."
    );

    return;

  }


  /* =======================================================
     SWITCH
     ======================================================= */

  const switchElement =
    document.getElementById(
      "lightningSwitch"
    );


  if (!switchElement) {

    console.error(
      "[CLOrad Lightning] lightningSwitch не найден."
    );

    return;

  }


  /* =======================================================
     LAYER
     ======================================================= */

  lightningLayer =
    L.layerGroup();


  /* =======================================================
     ЦВЕТ МОЛНИИ ПО ВОЗРАСТУ
     ======================================================= */

  function strikeColor(age) {

    if (age < 10_000)
      return "#ffffff";

    if (age < 60_000)
      return "#ffff00";

    if (age < 180_000)
      return "#ffa500";

    if (age < 300_000)
      return "#ff4500";

    if (age < 600_000)
      return "#ff0000";

    return "#8b0000";

  }


  /* =======================================================
     LZW DECODER
     
     Blitzortung сейчас передаёт
     сжатые сообщения.
     ======================================================= */

  function decodeLZW(input) {

    if (
      typeof input !== "string" ||
      !input.length
    ) {

      return "";

    }


    let dictionary = {};

    let data =
      input.split("");


    let current =
      data[0];

    let result =
      [current];


    let code =
      256;


    let previous =
      current;


    for (
      let i = 1;
      i < data.length;
      i++
    ) {

      const charCode =
        data[i].charCodeAt(0);


      let entry;


      if (
        charCode < 256
      ) {

        entry =
          data[i];

      } else {

        entry =
          dictionary[charCode];

        if (!entry) {

          entry =
            previous +
            current.charAt(0);

        }

      }


      result.push(entry);


      current =
        entry.charAt(0);


      dictionary[code++] =
        previous + current;


      previous =
        entry;

    }


    return result.join("");

  }


  /* =======================================================
     ДОБАВЛЕНИЕ УДАРА
     ======================================================= */

  function addStrike(data) {

    if (!enabled)
      return;


    if (
      !data ||
      typeof data.lat !== "number" ||
      typeof data.lon !== "number" ||
      typeof data.time !== "number"
    ) {

      return;

    }


    const timeMs =
      Math.floor(
        data.time / 1e6
      );


    const lat =
      data.lat;

    const lon =
      data.lon;


    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(timeMs)
    ) {

      return;

    }


    /* =====================================================
       НЕ РИСУЕМ МОЛНИИ, КОТОРЫЕ СИЛЬНО ДАЛЬШЕ ЭКРАНА
       ===================================================== */

    const bounds =
      map
        .getBounds()
        .pad(0.5);


    if (
      !bounds.contains(
        [lat, lon]
      )
    ) {

      return;

    }


    /* =====================================================
       ЗАЩИТА ОТ ДУБЛИКАТОВ
       ===================================================== */

    const duplicate =
      strikes.some(
        strike =>

          Math.abs(
            strike.lat - lat
          ) < 0.0001 &&

          Math.abs(
            strike.lon - lon
          ) < 0.0001 &&

          Math.abs(
            strike.time - timeMs
          ) < 1000
      );


    if (duplicate)
      return;


    /* =====================================================
       MARKER
       ===================================================== */

    const marker =
      L.circleMarker(
        [lat, lon],
        {

          radius: 6,

          color: "#ffffff",

          weight: 1,

          opacity: 1,

          fillColor:
            strikeColor(0),

          fillOpacity: 1

        }
      );


    /* =====================================================
       POPUP
       ===================================================== */

    marker.bindPopup(
      () => {

        const ageSec =
          Math.max(
            0,
            Math.round(
              (
                Date.now() -
                timeMs
              ) / 1000
            )
          );


        const ageText =
          ageSec < 60

            ? `${ageSec} сек назад`

            : `${Math.round(
                ageSec / 60
              )} мин назад`;


        return `

          <div
            style="
              min-width:190px;
              line-height:1.5;
            "
          >

            <b>
              ⚡ Удар молнии
            </b>

            <br>

            Время:
            ${new Date(
              timeMs
            ).toLocaleTimeString()}

            <br>

            ${ageText}

            <br>

            Координаты:

            <br>

            ${lat.toFixed(3)},
            ${lon.toFixed(3)}

          </div>

        `;

      }
    );


    lightningLayer.addLayer(
      marker
    );


    strikes.push({

      marker,

      time: timeMs,

      lat,

      lon

    });

  }


  /* =======================================================
     ОБРАБОТКА ВХОДЯЩЕГО ПАКЕТА
     ======================================================= */

  function processMessage(raw) {

    if (!enabled)
      return;


    try {

      /*
       * Иногда сообщение может
       * уже быть обычным JSON.
       */

      if (
        typeof raw === "string" &&
        raw.trim().startsWith("{")
      ) {

        const data =
          JSON.parse(raw);

        addStrike(data);

        return;

      }


      /*
       * Основной современный формат:
       * LZW-сжатая строка.
       */

      const decoded =
        decodeLZW(raw);


      if (
        !decoded ||
        !decoded.trim().startsWith("{")
      ) {

        return;

      }


      const data =
        JSON.parse(
          decoded
        );


      addStrike(data);


    } catch (error) {

      console.warn(
        "[CLOrad Lightning] Не удалось обработать пакет:",
        error
      );

    }

  }


  /* =======================================================
     ОЧИСТКА СТАРЫХ МОЛНИЙ
     ======================================================= */

  function updateStrikes() {

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


      if (
        age >
        STRIKE_LIFETIME
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


      strike.marker.setStyle({

        fillColor:
          strikeColor(
            age
          ),

        fillOpacity:
          Math.max(
            0.12,
            1 -
            age /
            STRIKE_LIFETIME
          )

      });

    }

  }


  /* =======================================================
     ОЧИСТИТЬ СЛОЙ
     ======================================================= */

  function clearStrikes() {

    lightningLayer.clearLayers();

    strikes.length = 0;

  }


  /* =======================================================
     ПЕРЕПОДКЛЮЧЕНИЕ
     ======================================================= */

  function scheduleReconnect() {

    if (!enabled)
      return;


    clearTimeout(
      reconnectTimer
    );


    reconnectTimer =
      setTimeout(
        () => {

          if (enabled)
            connect();

        },

        RECONNECT_DELAY
      );

  }


  /* =======================================================
     CONNECT
     ======================================================= */

  function connect() {

    if (!enabled)
      return;


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


    const url =
      SERVERS[
        currentServer %
        SERVERS.length
      ];


    currentServer++;


    console.log(
      "[CLOrad Lightning] Подключение:",
      url
    );


    try {

      socket =
        new WebSocket(
          url
        );

    } catch (error) {

      console.error(
        "[CLOrad Lightning] Ошибка WebSocket:",
        error
      );


      scheduleReconnect();

      return;

    }


    /* =====================================================
       OPEN
       ===================================================== */

    socket.onopen =
      () => {

        console.log(
          "[CLOrad Lightning] WebSocket подключён."
        );


        /*
         * Современный Blitzortung feed:
         * worldwide lightning stream.
         */

        try {

          socket.send(
            JSON.stringify({
              a: 111
            })
          );


          console.log(
            "[CLOrad Lightning] Подписка на поток отправлена."
          );


        } catch (error) {

          console.error(
            "[CLOrad Lightning] Ошибка подписки:",
            error
          );

        }

      };


    /* =====================================================
       MESSAGE
       ===================================================== */

    socket.onmessage =
      event => {

        if (!enabled)
          return;


        if (
          typeof event.data !== "string"
        ) {

          return;

        }


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
          "[CLOrad Lightning] WebSocket ошибка.",
          error
        );


        try {

          socket.close();

        } catch {}

      };


    /* =====================================================
       CLOSE
       ===================================================== */

    socket.onclose =
      () => {

        console.log(
          "[CLOrad Lightning] WebSocket закрыт."
        );


        socket =
          null;


        if (enabled) {

          scheduleReconnect();

        }

      };

  }


  /* =======================================================
     DISCONNECT
     ======================================================= */

  function disconnect() {

    clearTimeout(
      reconnectTimer
    );


    reconnectTimer =
      null;


    if (!socket)
      return;


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


  /* =======================================================
     ENABLE
     ======================================================= */

  function enable() {

    enabled =
      true;


    if (
      !map.hasLayer(
        lightningLayer
      )
    ) {

      lightningLayer.addTo(
        map
      );

    }


    switchElement.classList.add(
      "on"
    );


    connect();


    console.log(
      "[CLOrad Lightning] Слой включён."
    );

  }


  /* =======================================================
     DISABLE
     ======================================================= */

  function disable() {

    enabled =
      false;


    disconnect();


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
      "[CLOrad Lightning] Слой выключен."
    );

  }


  /* =======================================================
     SWITCH
     ======================================================= */

  switchElement.onclick =
    event => {

      event.stopPropagation();


      if (enabled) {

        disable();

      } else {

        enable();

      }

    };


  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradLightning = {

    enable,

    disable,

    toggle() {

      if (enabled)
        disable();
      else
        enable();

    },

    setEnabled(state) {

      if (state)
        enable();
      else
        disable();

    },

    isEnabled() {

      return enabled;

    },

    clear() {

      clearStrikes();

    }

  };


  /* =======================================================
     ОБНОВЛЕНИЕ
     ======================================================= */

  setInterval(
    updateStrikes,
    UPDATE_INTERVAL
  );


  /* =======================================================
     АВТОЗАПУСК
     
     Теперь молнии начинают поступать
     сразу после загрузки страницы.
     ======================================================= */

  enable();


  console.log(
    "[CLOrad Lightning] Модуль загружен и запущен."
  );


})();
