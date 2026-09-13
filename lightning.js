/* =========================================================
   CLOrad — Lightning
   Live lightning feed
   lightningmaps.org / Blitzortung
========================================================= */
(() => {
  "use strict";
  const WS_URL = "wss://live2.lightningmaps.org/";
  const RECONNECT_DELAY = 4000;
  const MAX_STRIKE_AGE = 15 * 60 * 1000;
  const UPDATE_INTERVAL = 1000;
  const map = window.map;
  const switchElement =
    document.getElementById("lightningSwitch");
  if (!map) {
    console.error(
      "[CLOrad Lightning] window.map не найден"
    );
    return;
  }
  if (!switchElement) {
    console.error(
      "[CLOrad Lightning] lightningSwitch не найден"
    );
    return;
  }
  /* =======================================================
     STATE
  ======================================================= */
  let socket = null;
  let enabled = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const strikes = new Map();
  const layer =
    L.layerGroup().addTo(map);
  /* =======================================================
     COLORS
  ======================================================= */
  function strikeColor(age) {
    if (age < 3000)
      return "#ffffff";
    if (age < 10000)
      return "#fff36b";
    if (age < 30000)
      return "#ffd23f";
    if (age < 60000)
      return "#ff9d32";
    if (age < 180000)
      return "#ff5c45";
    if (age < 300000)
      return "#ff3c73";
    return "#b96cff";
  }
  /* =======================================================
     VALIDATION
  ======================================================= */
  function validCoordinates(
    lat,
    lon
  ) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    );
  }
  /* =======================================================
     MAP BOUNDS
  ======================================================= */
  function strikeInsideMap(
    lat,
    lon
  ) {
    const bounds =
      map.getBounds();
    const north =
      bounds.getNorth();
    const south =
      bounds.getSouth();
    const east =
      bounds.getEast();
    const west =
      bounds.getWest();
    /*
      Небольшой запас за пределами
      видимой области.
    */
    const latPadding =
      Math.max(
        1,
        (north - south) * 0.15
      );
    const lonPadding =
      Math.max(
        1,
        (east - west) * 0.15
      );
    return (
      lat >= south - latPadding &&
      lat <= north + latPadding &&
      lon >= west - lonPadding &&
      lon <= east + lonPadding
    );
  }
  /* =======================================================
     ADD STRIKE
  ======================================================= */
  function addStrike(
    strike
  ) {
    if (!strike)
      return;
    const lat =
      Number(strike.lat);
    const lon =
      Number(strike.lon);
    const time =
      Number(strike.time);
    const id =
      String(
        strike.id ??
        `${lat}_${lon}_${time}`
      );
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
    if (
      strikes.has(id)
    ) {
      return;
    }
    const age =
      Date.now() - time;
    /*
      Не добавляем слишком старые
      события.
    */
    if (
      age > MAX_STRIKE_AGE
    ) {
      return;
    }
    /*
      Дополнительная защита
      от мусора за пределами карты.
    */
    if (
      !strikeInsideMap(
        lat,
        lon
      )
    ) {
      return;
    }
    const marker =
      L.circleMarker(
        [lat, lon],
        {
          radius: 6,
          color:
            strikeColor(age),
          fillColor:
            strikeColor(age),
          fillOpacity: 1,
          opacity: 1,
          weight: 2,
          interactive: true
        }
      );
    marker.bindPopup(() => {
      const currentAge =
        Math.max(
          0,
          Date.now() - time
        );
      const seconds =
        Math.round(
          currentAge / 1000
        );
      const date =
        new Date(time);
      return `
        <div style="
          min-width:160px;
          font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;
        ">
          <b>⚡ Молния</b>
          <br><br>
          Время:
          ${date.toLocaleTimeString("ru-RU")}
          <br>
          Возраст:
          ${seconds} с
          <br>
          Координаты:
          ${lat.toFixed(4)},
          ${lon.toFixed(4)}
        </div>
      `;
    });
    marker.addTo(layer);
    strikes.set(
      id,
      {
        marker,
        time
      }
    );
  }
  /* =======================================================
     PROCESS SERVER MESSAGE
  ======================================================= */
  function processMessage(
    raw
  ) {
    let data;
    try {
      data =
        JSON.parse(raw);
    } catch (error) {
      console.warn(
        "[CLOrad Lightning] Не удалось разобрать сообщение:",
        raw
      );
      return;
    }
    /*
      Сервер присылает пачку:
      
      {
        time: ...,
        flags: ...,
        strokes: [...]
      }
    */
    if (
      Array.isArray(
        data.strokes
      )
    ) {
      data.strokes.forEach(
        addStrike
      );
      return;
    }
    /*
      На всякий случай поддерживаем
      одиночную молнию.
    */
    if (
      Number.isFinite(
        Number(data.lat)
      ) &&
      Number.isFinite(
        Number(data.lon)
      )
    ) {
      addStrike(data);
    }
  }
  /* =======================================================
     SUBSCRIBE
  ======================================================= */
  function subscribe() {
    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN
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
    const zoom =
      Math.round(
        map.getZoom()
      );
    const request = {
      v: 24,
      i: {},
      s: false,
      x: 0,
      w: 0,
      tx: 0,
      tw: 1,
      a: 4,
      z: zoom,
      b: true,
      h: "",
      l: 1,
      t: 1,
      from_lightningmaps_org: true,
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
          request
        )
      );
      console.log(
        "[CLOrad Lightning] Подписка обновлена",
        request.p
      );
    } catch (error) {
      console.warn(
        "[CLOrad Lightning] Ошибка подписки",
        error
      );
    }
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
    clearTimeout(
      reconnectTimer
    );
    console.log(
      "[CLOrad Lightning] Подключение..."
    );
    try {
      socket =
        new WebSocket(
          WS_URL
        );
    } catch (error) {
      console.error(
        "[CLOrad Lightning] WebSocket error",
        error
      );
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      console.log(
        "[CLOrad Lightning] WebSocket подключён"
      );
      reconnectAttempts = 0;
      subscribe();
    };
    socket.onmessage = event => {
      processMessage(
        event.data
      );
    };
    socket.onerror = error => {
      console.warn(
        "[CLOrad Lightning] WebSocket ошибка",
        error
      );
    };
    socket.onclose = () => {
      console.warn(
        "[CLOrad Lightning] WebSocket закрыт"
      );
      socket = null;
      if (enabled) {
        scheduleReconnect();
      }
    };
  }
  /* =======================================================
     RECONNECT
  ======================================================= */
  function scheduleReconnect() {
    if (!enabled)
      return;
    clearTimeout(
      reconnectTimer
    );
    reconnectAttempts++;
    const delay =
      Math.min(
        RECONNECT_DELAY *
          Math.min(
            reconnectAttempts,
            5
          ),
        15000
      );
    console.log(
      `[CLOrad Lightning] Повтор через ${delay} мс`
    );
    reconnectTimer =
      setTimeout(
        connect,
        delay
      );
  }
  /* =======================================================
     CLEAR
  ======================================================= */
  function clearStrikes() {
    strikes.forEach(
      item => {
        layer.removeLayer(
          item.marker
        );
      }
    );
    strikes.clear();
  }
  /* =======================================================
     UPDATE STRIKES
  ======================================================= */
  function updateStrikes() {
    const now =
      Date.now();
    strikes.forEach(
      (
        item,
        id
      ) => {
        const age =
          now - item.time;
        /*
          Удаляем старые события.
        */
        if (
          age > MAX_STRIKE_AGE
        ) {
          layer.removeLayer(
            item.marker
          );
          strikes.delete(
            id
          );
          return;
        }
        const color =
          strikeColor(age);
        item.marker.setStyle({
          color,
          fillColor:
            color,
          /*
            Постепенно уменьшаем
            размер старых молний.
          */
          radius:
            age < 10000
              ? 7
              : age < 60000
                ? 5
                : 4,
          opacity:
            age < 60000
              ? 1
              : 0.8,
          fillOpacity:
            age < 60000
              ? 1
              : 0.65
        });
      }
    );
  }
  /* =======================================================
     ENABLE
  ======================================================= */
  function enable() {
    if (enabled)
      return;
    enabled = true;
    switchElement.classList.add(
      "on"
    );
    console.log(
      "[CLOrad Lightning] Включено"
    );
    connect();
  }
  /* =======================================================
     DISABLE
  ======================================================= */
  function disable() {
    enabled = false;
    switchElement.classList.remove(
      "on"
    );
    clearTimeout(
      reconnectTimer
    );
    reconnectTimer =
      null;
    if (socket) {
      try {
        socket.close();
      } catch (error) {}
    }
    socket = null;
    clearStrikes();
    console.log(
      "[CLOrad Lightning] Выключено"
    );
  }
  /* =======================================================
     SWITCH
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
     MAP MOVEMENT
  ======================================================= */
  map.on(
    "moveend zoomend",
    () => {
      if (
        !enabled
      ) {
        return;
      }
      /*
        Переподписываемся на новое
        окно карты.
      */
      if (
        socket &&
        socket.readyState ===
          WebSocket.OPEN
      ) {
        subscribe();
      }
    }
  );
  /* =======================================================
     CLEANUP / TIMER
  ======================================================= */
  setInterval(
    updateStrikes,
    UPDATE_INTERVAL
  );
  /* =======================================================
     PUBLIC API
  ======================================================= */
  window.CLOradLightning = {
    enable,
    disable,
    setEnabled(value) {
      if (value) {
        enable();
      } else {
        disable();
      }
    },
    clear() {
      clearStrikes();
    },
    reconnect() {
      if (!enabled)
        return;
      if (socket) {
        try {
          socket.close();
        } catch (error) {}
      }
      socket = null;
      connect();
    }
  };
  /* =======================================================
     START
  ======================================================= */
  enable();
})();
