/* =========================================================
   CLOrad — Lightning
   Источник: LightningMaps / Blitzortung live2
   ========================================================= */

(() => {
  "use strict";

  const WS_URL = "wss://live2.lightningmaps.org/";

  const RECONNECT_MIN = 3000;
  const RECONNECT_MAX = 15000;

  const MAX_STRIKE_AGE = 15 * 60 * 1000;
  const UPDATE_INTERVAL = 1000;

  const map = window.map;
  const switchElement = document.getElementById("lightningSwitch");

  if (!map) {
    console.error("[CLOrad Lightning] Leaflet map не найден.");
    return;
  }

  if (!switchElement) {
    console.error("[CLOrad Lightning] lightningSwitch не найден.");
    return;
  }

  /* ---------------------------------------------------------
     Состояние
     --------------------------------------------------------- */

  let socket = null;
  let enabled = false;

  let reconnectTimer = null;
  let reconnectAttempts = 0;

  // Номер текущей сессии.
  // Благодаря ему старые WebSocket-события не смогут
  // случайно воскресить старое соединение.
  let connectionGeneration = 0;

  const strikes = new Map();

  const layer = L.layerGroup();

  /* ---------------------------------------------------------
     Цвет молнии по возрасту
     --------------------------------------------------------- */

  function strikeColor(age) {
    if (age < 3000) return "#ffffff";
    if (age < 10000) return "#fff700";
    if (age < 30000) return "#ffb300";
    if (age < 60000) return "#ff6d00";
    if (age < 180000) return "#ff1744";
    if (age < 300000) return "#ff00aa";

    return "#a855f7";
  }

  /* ---------------------------------------------------------
     Проверка координат
     --------------------------------------------------------- */

  function validCoordinates(lat, lon) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    );
  }

  /* ---------------------------------------------------------
     Проверка времени
     --------------------------------------------------------- */

  function getStrikeTime(strike) {
    if (!strike || !Number.isFinite(Number(strike.time))) {
      return null;
    }

    let time = Number(strike.time);

    // Иногда время приходит в секундах Unix,
    // иногда в миллисекундах.
    if (time < 100000000000) {
      time *= 1000;
    }

    return time;
  }

  /* ---------------------------------------------------------
     Добавление молнии
     --------------------------------------------------------- */

  function addStrike(strike) {
    if (!strike) return;

    const lat = Number(strike.lat);
    const lon = Number(strike.lon);

    if (!validCoordinates(lat, lon)) {
      return;
    }

    const time = getStrikeTime(strike);

    if (!time) {
      return;
    }

    const age = Date.now() - time;

    // Не показываем слишком старые события.
    if (age > MAX_STRIKE_AGE || age < -60000) {
      return;
    }

    /*
       ID нужен для защиты от повторных пакетов.
    */

    const id =
      strike.id !== undefined
        ? String(strike.id)
        : `${lat.toFixed(5)}_${lon.toFixed(5)}_${time}`;

    if (strikes.has(id)) {
      return;
    }

    /*
       Не ограничиваем молнии текущими bounds карты.

       Это специально:
       если сервер прислал молнию, мы её показываем.
       Так мы не потеряем данные из-за небольшого
       рассинхрона viewport/подписки.
    */

    const marker = L.circleMarker([lat, lon], {
      radius: 5,
      color: "#ffffff",
      weight: 1,
      opacity: 1,
      fillColor: strikeColor(age),
      fillOpacity: 1,
      interactive: false
    });

    marker.addTo(layer);

    strikes.set(id, {
      marker,
      lat,
      lon,
      time,
      id
    });
  }

  /* ---------------------------------------------------------
     Обработка входящего сообщения
     --------------------------------------------------------- */

  function processMessage(raw) {
    if (!enabled) return;

    let data;

    try {
      if (typeof raw === "string") {
        data = JSON.parse(raw);
      } else {
        return;
      }
    } catch (error) {
      console.warn(
        "[CLOrad Lightning] Ошибка JSON:",
        error
      );
      return;
    }

    if (!data) return;

    /*
       Основной формат LightningMaps:

       {
         "time": ...,
         "strokes": [...]
       }
    */

    if (Array.isArray(data.strokes)) {
      for (const strike of data.strokes) {
        addStrike(strike);
      }

      return;
    }

    /*
       На случай одиночного события.
    */

    if (
      Number.isFinite(Number(data.lat)) &&
      Number.isFinite(Number(data.lon))
    ) {
      addStrike(data);
    }
  }

  /* ---------------------------------------------------------
     Формирование подписки
     --------------------------------------------------------- */

  function createSubscription() {
    const bounds = map.getBounds();

    const north = bounds.getNorth();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const west = bounds.getWest();

    let zoom = map.getZoom();

    if (!Number.isFinite(zoom)) {
      zoom = 5;
    }

    zoom = Math.max(2, Math.min(18, Math.round(zoom)));

    return {
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
  }

  /* ---------------------------------------------------------
     Отправка подписки
     --------------------------------------------------------- */

  function subscribe(ws) {
    if (!ws) return;

    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const subscription = createSubscription();

    try {
      ws.send(JSON.stringify(subscription));

      console.log(
        "[CLOrad Lightning] Подписка отправлена.",
        subscription.p
      );
    } catch (error) {
      console.warn(
        "[CLOrad Lightning] Не удалось отправить подписку:",
        error
      );
    }
  }

  /* ---------------------------------------------------------
     Полное уничтожение WebSocket
     --------------------------------------------------------- */

  function destroySocket() {
    const oldSocket = socket;

    socket = null;

    if (!oldSocket) {
      return;
    }

    try {
      oldSocket.onopen = null;
      oldSocket.onmessage = null;
      oldSocket.onerror = null;
      oldSocket.onclose = null;

      if (
        oldSocket.readyState === WebSocket.OPEN ||
        oldSocket.readyState === WebSocket.CONNECTING
      ) {
        oldSocket.close();
      }
    } catch (error) {
      console.warn(
        "[CLOrad Lightning] Ошибка закрытия WebSocket:",
        error
      );
    }
  }

  /* ---------------------------------------------------------
     Таймер переподключения
     --------------------------------------------------------- */

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(generation) {
    if (!enabled) {
      return;
    }

    if (generation !== connectionGeneration) {
      return;
    }

    clearReconnectTimer();

    const delay = Math.min(
      RECONNECT_MIN *
        Math.pow(1.5, reconnectAttempts),
      RECONNECT_MAX
    );

    reconnectAttempts++;

    console.log(
      `[CLOrad Lightning] Повторное подключение через ${Math.round(
        delay / 1000
      )} сек.`
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;

      if (!enabled) {
        return;
      }

      if (generation !== connectionGeneration) {
        return;
      }

      connect();
    }, delay);
  }

  /* ---------------------------------------------------------
     Создание нового WebSocket
     --------------------------------------------------------- */

  function connect() {
    if (!enabled) {
      return;
    }

    /*
       Каждое подключение получает новый generation.
       Старые callbacks больше не имеют права что-либо менять.
    */

    const generation = ++connectionGeneration;

    clearReconnectTimer();

    destroySocket();

    let ws;

    try {
      console.log(
        "[CLOrad Lightning] Подключение:",
        WS_URL
      );

      ws = new WebSocket(WS_URL);
    } catch (error) {
      console.error(
        "[CLOrad Lightning] WebSocket не создан:",
        error
      );

      scheduleReconnect(generation);
      return;
    }

    socket = ws;

    ws.onopen = () => {
      if (!enabled || generation !== connectionGeneration) {
        try {
          ws.close();
        } catch (_) {}

        return;
      }

      console.log(
        "[CLOrad Lightning] WebSocket подключён."
      );

      reconnectAttempts = 0;

      subscribe(ws);
    };

    ws.onmessage = event => {
      if (!enabled) return;

      if (generation !== connectionGeneration) {
        return;
      }

      processMessage(event.data);
    };

    ws.onerror = error => {
      if (generation !== connectionGeneration) {
        return;
      }

      console.warn(
        "[CLOrad Lightning] WebSocket ошибка:",
        error
      );
    };

    ws.onclose = event => {
      if (generation !== connectionGeneration) {
        return;
      }

      console.log(
        "[CLOrad Lightning] WebSocket закрыт:",
        event.code,
        event.reason || ""
      );

      if (socket === ws) {
        socket = null;
      }

      scheduleReconnect(generation);
    };
  }

  /* ---------------------------------------------------------
     Очистка молний
     --------------------------------------------------------- */

  function clearStrikes() {
    for (const item of strikes.values()) {
      try {
        layer.removeLayer(item.marker);
      } catch (_) {}
    }

    strikes.clear();
  }

  /* ---------------------------------------------------------
     Обновление отображения
     --------------------------------------------------------- */

  function updateStrikes() {
    const now = Date.now();

    for (const [id, item] of strikes) {
      const age = now - item.time;

      if (age > MAX_STRIKE_AGE) {
        try {
          layer.removeLayer(item.marker);
        } catch (_) {}

        strikes.delete(id);
        continue;
      }

      if (age < 0) {
        continue;
      }

      const marker = item.marker;

      const color = strikeColor(age);

      /*
         Свежая молния — большая и яркая.
         Со временем становится меньше.
      */

      let radius = 5;

      if (age < 3000) {
        radius = 7;
      } else if (age < 10000) {
        radius = 6;
      } else if (age < 30000) {
        radius = 5;
      } else if (age < 60000) {
        radius = 4;
      } else {
        radius = 3;
      }

      let opacity = 1;

      if (age > 180000) {
        opacity = 0.75;
      }

      if (age > 300000) {
        opacity = 0.55;
      }

      marker.setStyle({
        radius,
        color,
        fillColor: color,
        opacity,
        fillOpacity: opacity
      });
    }
  }

  /* ---------------------------------------------------------
     Включение
     --------------------------------------------------------- */

  function enable() {
    if (enabled) {
      /*
         Если уже включено, всё равно проверяем соединение.
      */

      if (
        !socket ||
        socket.readyState === WebSocket.CLOSED
      ) {
        connect();
      }

      return;
    }

    enabled = true;

    clearReconnectTimer();

    /*
       Полностью новая сессия.
    */

    connectionGeneration++;

    clearStrikes();

    layer.addTo(map);

    reconnectAttempts = 0;

    console.log(
      "[CLOrad Lightning] Молнии включены."
    );

    connect();
  }

  /* ---------------------------------------------------------
     Выключение
     --------------------------------------------------------- */

  function disable() {
    if (!enabled) {
      /*
         Всё равно уничтожаем потенциальный старый socket.
      */

      clearReconnectTimer();
      destroySocket();

      return;
    }

    enabled = false;

    /*
       Инвалидируем все старые WebSocket callbacks.
    */

    connectionGeneration++;

    clearReconnectTimer();

    destroySocket();

    clearStrikes();

    try {
      map.removeLayer(layer);
    } catch (_) {}

    reconnectAttempts = 0;

    console.log(
      "[CLOrad Lightning] Молнии выключены."
    );
  }

  /* ---------------------------------------------------------
     Переподписка после движения карты
     --------------------------------------------------------- */

  function refreshSubscription() {
    if (!enabled) {
      return;
    }

    if (!socket) {
      connect();
      return;
    }

    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    subscribe(socket);
  }

  map.on(
    "moveend zoomend",
    refreshSubscription
  );

  /* ---------------------------------------------------------
     Переключатель
     --------------------------------------------------------- */

  switchElement.onclick = event => {
    event.preventDefault();
    event.stopPropagation();

    if (enabled) {
      disable();
    } else {
      enable();
    }
  };

  /* ---------------------------------------------------------
     Обновление молний каждую секунду
     --------------------------------------------------------- */

  setInterval(
    updateStrikes,
    UPDATE_INTERVAL
  );

  /* ---------------------------------------------------------
     API для index.html
     --------------------------------------------------------- */

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
      if (!enabled) {
        return;
      }

      console.log(
        "[CLOrad Lightning] Принудительное переподключение."
      );

      connectionGeneration++;

      clearReconnectTimer();

      destroySocket();

      reconnectAttempts = 0;

      connect();
    },

    isEnabled() {
      return enabled;
    },

    isConnected() {
      return (
        !!socket &&
        socket.readyState === WebSocket.OPEN
      );
    }

  };

  /* ---------------------------------------------------------
     Автоматически включаем при загрузке.
     Переключатель в index.html изначально ON.
     --------------------------------------------------------- */

  enable();

})();
