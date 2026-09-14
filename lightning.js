/* =========================================================
   CLOrad — LIGHTNING
   LightningMaps / Blitzortung live2
   ========================================================= */

(() => {
  "use strict";

  const WS_URL = "wss://live2.lightningmaps.org/";

  const RECONNECT_MIN = 3000;
  const RECONNECT_MAX = 15000;

  // Максимальный возраст отображаемой молнии
  const MAX_STRIKE_AGE = 15 * 60 * 1000;

  const map = window.map;
  const switchElement = document.getElementById("lightningSwitch");

  if (!map) {
    console.error("[CLOrad Lightning] map не найден.");
    return;
  }

  if (!switchElement) {
    console.error("[CLOrad Lightning] lightningSwitch не найден.");
    return;
  }

  /* =======================================================
     STATE
     ======================================================= */

  let enabled = false;
  let socket = null;

  let reconnectTimer = null;
  let reconnectAttempts = 0;

  /*
     Каждое новое соединение получает собственный номер.
     Старое соединение после выключения уже не сможет
     изменить состояние нового.
  */
  let connectionId = 0;

  const strikes = new Map();

  const layer = L.layerGroup();

  /* =======================================================
     COLORS
     Плавный переход:
     жёлтый → оранжевый → красный
     ======================================================= */

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function colorMix(c1, c2, t) {
    const r = Math.round(
      lerp(c1[0], c2[0], t)
    );

    const g = Math.round(
      lerp(c1[1], c2[1], t)
    );

    const b = Math.round(
      lerp(c1[2], c2[2], t)
    );

    return `rgb(${r},${g},${b})`;
  }

  function strikeColor(age) {

    /*
       0–2 мин:
       ярко-жёлтый → жёлто-оранжевый
    */

    if (age <= 2 * 60 * 1000) {

      const t =
        age /
        (2 * 60 * 1000);

      return colorMix(
        [255, 242, 0],
        [255, 190, 35],
        t
      );
    }

    /*
       2–5 мин:
       жёлто-оранжевый → оранжево-красный
    */

    if (age <= 5 * 60 * 1000) {

      const t =
        (age - 2 * 60 * 1000) /
        (3 * 60 * 1000);

      return colorMix(
        [255, 190, 35],
        [255, 70, 25],
        t
      );
    }

    /*
       5–10 мин:
       оранжево-красный → красный
    */

    if (age <= 10 * 60 * 1000) {

      const t =
        (age - 5 * 60 * 1000) /
        (5 * 60 * 1000);

      return colorMix(
        [255, 70, 25],
        [210, 20, 20],
        t
      );
    }

    /*
       10–15 мин:
       красный → тёмно-красный
    */

    const t =
      Math.min(
        1,
        (age - 10 * 60 * 1000) /
        (5 * 60 * 1000)
      );

    return colorMix(
      [210, 20, 20],
      [115, 8, 8],
      t
    );
  }

  /* =======================================================
     SIZE
     ======================================================= */

  function strikeRadius(age) {

    if (age <= 1 * 60 * 1000) {
      return 8;
    }

    if (age <= 2 * 60 * 1000) {
      return 7;
    }

    if (age <= 3 * 60 * 1000) {
      return 6;
    }

    if (age <= 4 * 60 * 1000) {
      return 5;
    }

    if (age <= 5 * 60 * 1000) {
      return 4.5;
    }

    if (age <= 6 * 60 * 1000) {
      return 4;
    }

    if (age <= 8 * 60 * 1000) {
      return 3.5;
    }

    if (age <= 10 * 60 * 1000) {
      return 3;
    }

    return 2;
  }

  /* =======================================================
     OPACITY
     ======================================================= */

  function strikeOpacity(age) {

    if (age <= 5 * 60 * 1000) {
      return 1;
    }

    if (age <= 10 * 60 * 1000) {
      return 0.9;
    }

    return 0.75;
  }

  /* =======================================================
     TIME
     ======================================================= */

  function getStrikeTime(strike) {

    if (
      !strike ||
      !Number.isFinite(
        Number(strike.time)
      )
    ) {
      return null;
    }

    let time =
      Number(strike.time);

    /*
       Unix seconds → milliseconds
    */

    if (
      time < 100000000000
    ) {
      time *= 1000;
    }

    return time;
  }

  /* =======================================================
     COORDINATES
     ======================================================= */

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

  /* =======================================================
     ADD STRIKE
     ======================================================= */

  function addStrike(strike) {

    if (!enabled) {
      return;
    }

    if (!strike) {
      return;
    }

    const lat =
      Number(strike.lat);

    const lon =
      Number(strike.lon);

    if (
      !validCoordinates(
        lat,
        lon
      )
    ) {
      return;
    }

    const time =
      getStrikeTime(strike);

    if (!time) {
      return;
    }

    const age =
      Date.now() - time;

    /*
       Не принимаем сильно будущие события
       и слишком старые события.
    */

    if (
      age > MAX_STRIKE_AGE ||
      age < -60000
    ) {
      return;
    }

    /*
       Защита от дублей.
    */

    const id =
      strike.id !== undefined
        ? String(strike.id)
        : `${lat.toFixed(5)}_${lon.toFixed(5)}_${time}`;

    if (
      strikes.has(id)
    ) {
      return;
    }

    const color =
      strikeColor(
        Math.max(0, age)
      );

    const radius =
      strikeRadius(
        Math.max(0, age)
      );

    const marker =
      L.circleMarker(
        [lat, lon],
        {
          radius,

          color,

          weight:1,

          opacity:
            strikeOpacity(
              Math.max(0, age)
            ),

          fillColor:color,

          fillOpacity:
            strikeOpacity(
              Math.max(0, age)
            ),

          interactive:false
        }
      );

    marker.addTo(layer);

    strikes.set(
      id,
      {
        marker,
        lat,
        lon,
        time,
        id
      }
    );
  }

  /* =======================================================
     MESSAGE
     ======================================================= */

  function processMessage(raw) {

    if (!enabled) {
      return;
    }

    if (
      typeof raw !== "string"
    ) {
      return;
    }

    let data;

    try {

      data =
        JSON.parse(raw);

    } catch (error) {

      console.warn(
        "[CLOrad Lightning] Ошибка JSON:",
        error
      );

      return;
    }

    if (!data) {
      return;
    }

    /*
       Основной формат LightningMaps:
       data.strokes[]
    */

    if (
      Array.isArray(
        data.strokes
      )
    ) {

      for (
        const strike of data.strokes
      ) {

        addStrike(
          strike
        );
      }

      return;
    }

    /*
       На случай одиночного события.
    */

    if (
      Number.isFinite(
        Number(data.lat)
      ) &&
      Number.isFinite(
        Number(data.lon)
      )
    ) {

      addStrike(
        data
      );
    }
  }

  /* =======================================================
     SUBSCRIPTION
     ======================================================= */

  function createSubscription() {

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

    let zoom =
      map.getZoom();

    if (
      !Number.isFinite(zoom)
    ) {
      zoom = 5;
    }

    zoom =
      Math.max(
        2,
        Math.min(
          18,
          Math.round(zoom)
        )
      );

    return {

      v:24,

      i:{},

      s:false,

      x:0,

      w:0,

      tx:0,

      tw:1,

      a:4,

      z:zoom,

      b:true,

      h:"",

      l:1,

      t:1,

      from_lightningmaps_org:true,

      p:[
        north,
        east,
        south,
        west
      ],

      r:"A"
    };
  }

  function subscribe(ws) {

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    try {

      const subscription =
        createSubscription();

      ws.send(
        JSON.stringify(
          subscription
        )
      );

      console.log(
        "[CLOrad Lightning] Подписка отправлена."
      );

    } catch (error) {

      console.warn(
        "[CLOrad Lightning] Не удалось отправить подписку:",
        error
      );
    }
  }

  /* =======================================================
     SOCKET DESTROY
     ======================================================= */

  function destroySocket() {

    const oldSocket =
      socket;

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
        oldSocket.readyState ===
          WebSocket.OPEN ||
        oldSocket.readyState ===
          WebSocket.CONNECTING
      ) {

        oldSocket.close();
      }

    } catch (error) {

      console.warn(
        "[CLOrad Lightning] Ошибка закрытия:",
        error
      );
    }
  }

  /* =======================================================
     RECONNECT
     ======================================================= */

  function clearReconnectTimer() {

    if (
      reconnectTimer
    ) {

      clearTimeout(
        reconnectTimer
      );

      reconnectTimer = null;
    }
  }

  function scheduleReconnect(id) {

    if (!enabled) {
      return;
    }

    if (
      id !== connectionId
    ) {
      return;
    }

    clearReconnectTimer();

    const delay =
      Math.min(
        RECONNECT_MIN *
          Math.pow(
            1.5,
            reconnectAttempts
          ),
        RECONNECT_MAX
      );

    reconnectAttempts++;

    console.log(
      `[CLOrad Lightning] Переподключение через ${Math.round(
        delay / 1000
      )} сек.`
    );

    reconnectTimer =
      setTimeout(
        () => {

          reconnectTimer =
            null;

          if (!enabled) {
            return;
          }

          if (
            id !== connectionId
          ) {
            return;
          }

          connect();

        },
        delay
      );
  }

  /* =======================================================
     CONNECT
     ======================================================= */

  function connect() {

    if (!enabled) {
      return;
    }

    /*
       Новый ID соединения.
    */

    const id =
      ++connectionId;

    clearReconnectTimer();

    destroySocket();

    let ws;

    try {

      console.log(
        "[CLOrad Lightning] Подключение..."
      );

      ws =
        new WebSocket(
          WS_URL
        );

    } catch (error) {

      console.error(
        "[CLOrad Lightning] Не удалось создать WebSocket:",
        error
      );

      scheduleReconnect(
        id
      );

      return;
    }

    socket = ws;

    ws.onopen = () => {

      if (
        !enabled ||
        id !== connectionId
      ) {

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

      if (!enabled) {
        return;
      }

      if (
        id !== connectionId
      ) {
        return;
      }

      processMessage(
        event.data
      );
    };

    ws.onerror = error => {

      if (
        id !== connectionId
      ) {
        return;
      }

      console.warn(
        "[CLOrad Lightning] WebSocket ошибка.",
        error
      );
    };

    ws.onclose = event => {

      if (
        id !== connectionId
      ) {
        return;
      }

      console.log(
        "[CLOrad Lightning] WebSocket закрыт:",
        event.code
      );

      if (
        socket === ws
      ) {
        socket = null;
      }

      scheduleReconnect(
        id
      );
    };
  }

  /* =======================================================
     CLEAR
     ======================================================= */

  function clearStrikes() {

    for (
      const item of strikes.values()
    ) {

      try {
        layer.removeLayer(
          item.marker
        );
      } catch (_) {}
    }

    strikes.clear();
  }

  /* =======================================================
     UPDATE AGE
     ======================================================= */

  function updateStrikes() {

    if (!enabled) {
      return;
    }

    const now =
      Date.now();

    for (
      const [id, item]
      of strikes
    ) {

      const age =
        now - item.time;

      /*
         Старше 15 минут —
         удаляем.
      */

      if (
        age > MAX_STRIKE_AGE
      ) {

        try {

          layer.removeLayer(
            item.marker
          );

        } catch (_) {}

        strikes.delete(
          id
        );

        continue;
      }

      if (
        age < 0
      ) {
        continue;
      }

      const color =
        strikeColor(
          age
        );

      const radius =
        strikeRadius(
          age
        );

      const opacity =
        strikeOpacity(
          age
        );

      item.marker.setStyle({

        radius,

        color,

        fillColor:color,

        opacity,

        fillOpacity:opacity

      });
    }
  }

  /* =======================================================
     SWITCH VISUAL STATE
     ======================================================= */

  function updateSwitch() {

    switchElement.classList.toggle(
      "on",
      enabled
    );

    /*
       Для доступности.
    */

    switchElement.setAttribute(
      "aria-checked",
      enabled
        ? "true"
        : "false"
    );
  }

  /* =======================================================
     ENABLE
     ======================================================= */

  function enable() {

    /*
       Если уже включено, проверяем
       состояние соединения.
    */

    if (enabled) {

      updateSwitch();

      if (
        !socket ||
        socket.readyState ===
          WebSocket.CLOSED
      ) {

        reconnectAttempts = 0;

        connect();
      }

      return;
    }

    enabled = true;

    updateSwitch();

    clearReconnectTimer();

    /*
       Полностью новая сессия.
    */

    connectionId++;

    clearStrikes();

    layer.addTo(map);

    reconnectAttempts = 0;

    console.log(
      "[CLOrad Lightning] ВКЛ."
    );

    connect();
  }

  /* =======================================================
     DISABLE
     ======================================================= */

  function disable() {

    /*
       Очень важно:
       сначала выключаем enabled,
       затем инвалидируем старый socket.
    */

    enabled = false;

    updateSwitch();

    /*
       Старые callbacks теперь недействительны.
    */

    connectionId++;

    clearReconnectTimer();

    destroySocket();

    clearStrikes();

    try {

      map.removeLayer(
        layer
      );

    } catch (_) {}

    reconnectAttempts = 0;

    console.log(
      "[CLOrad Lightning] ВЫКЛ."
    );
  }

  /* =======================================================
     MAP MOVEMENT
     ======================================================= */

  function refreshSubscription() {

    if (!enabled) {
      return;
    }

    if (
      !socket
    ) {

      connect();

      return;
    }

    if (
      socket.readyState !==
        WebSocket.OPEN
    ) {

      return;
    }

    subscribe(
      socket
    );
  }

  map.on(
    "moveend zoomend",
    refreshSubscription
  );

  /* =======================================================
     SWITCH CLICK
     ======================================================= */

  /*
     Единственный обработчик переключателя.
     index.html больше ничего сюда не назначает.
  */

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
     LEGEND
     ======================================================= */

  const legend =
    document.getElementById(
      "legend"
    );

  if (legend) {

    const legendTitle =
      legend.querySelector(
        ".legendTitle"
      );

    const legendItems =
      Array.from(
        legend.querySelectorAll(
          ".li"
        )
      );

    /*
       Запоминаем существующую
       легенду ОЯ.
    */

    const oyaContent =
      legendItems.map(
        item =>
          item.cloneNode(true)
      );

    /*
       Создаём переключатель.
    */

    const legendSwitch =
      document.createElement(
        "div"
      );

    legendSwitch.className =
      "cloradLegendSwitch";

    legendSwitch.innerHTML = `

      <button
        type="button"
        class="cloradLegendButton active"
        data-legend="oya"
        aria-label="Легенда ОЯ"
      >
        ОЯ
      </button>

      <button
        type="button"
        class="cloradLegendButton"
        data-legend="lightning"
        aria-label="Легенда молний"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M13 2L4 14h7l-1 8 10-13h-7z"/>
        </svg>
      </button>

    `;

    /*
       CSS добавляем из JS,
       поэтому index.html трогать
       не требуется.
    */

    const style =
      document.createElement(
        "style"
      );

    style.textContent = `

      .cloradLegendSwitch{
        display:flex;
        align-items:center;
        gap:4px;
        height:32px;
        margin:0 0 8px 0;
        padding:3px;
        background:#10171d;
        border:1px solid #35414a;
        border-radius:7px;
      }

      .cloradLegendButton{
        flex:1;
        height:25px;
        min-width:0;
        padding:0 8px;
        border:0;
        border-radius:5px;
        background:transparent;
        color:#8f999f;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:12px;
        font-weight:600;
      }

      .cloradLegendButton.active{
        background:#2a353e;
        color:#f0f3f4;
      }

      .cloradLegendButton svg{
        width:17px;
        height:17px;
        fill:none;
        stroke:currentColor;
        stroke-width:2;
        stroke-linecap:round;
        stroke-linejoin:round;
      }

      .cloradLightningLegend{
        display:none;
      }

      .cloradLightningRow{
        height:27px;
        display:flex;
        align-items:center;
        gap:8px;
        font-size:12px;
        color:#e4e7e9;
      }

      .cloradLightningDot{
        width:16px;
        height:16px;
        border-radius:50%;
        flex:none;
      }

      .cloradLightningGradient{
        width:100%;
        height:13px;
        border-radius:3px;
        margin:4px 0 7px;
        background:linear-gradient(
          90deg,
          #fff200 0%,
          #ffbe23 20%,
          #ff4619 48%,
          #d41414 75%,
          #730808 100%
        );
      }

      .cloradLightningScale{
        display:flex;
        justify-content:space-between;
        color:#9da5aa;
        font-size:10px;
        margin-bottom:8px;
      }

      body.light .cloradLegendSwitch{
        background:#e4e9ec;
        border-color:#c7cfd4;
      }

      body.light .cloradLegendButton{
        color:#687177;
      }

      body.light .cloradLegendButton.active{
        background:#d5dce0;
        color:#20272b;
      }

      body.light .cloradLightningRow{
        color:#30373b;
      }

      body.light .cloradLightningScale{
        color:#70797f;
      }

    `;

    document.head.appendChild(
      style
    );

    /*
       Вставляем переключатель
       перед заголовком.
    */

    if (legendTitle) {

      legend.insertBefore(
        legendSwitch,
        legendTitle
      );
    }

    /*
       Создаём отдельный контейнер
       для легенды молний.
    */

    const lightningContent =
      document.createElement(
        "div"
      );

    lightningContent.className =
      "cloradLightningLegend";

    lightningContent.innerHTML = `

      <div class="cloradLightningRow">
        <span
          class="cloradLightningDot"
          style="background:#fff200"
        ></span>
        <span>0–1 мин</span>
      </div>

      <div class="cloradLightningRow">
        <span
          class="cloradLightningDot"
          style="background:#ffcf33"
        ></span>
        <span>1–2 мин</span>
      </div>

      <div class="cloradLightningRow">
        <span
          class="cloradLightningDot"
          style="background:#ff9a1f"
        ></span>
        <span>2–3 мин</span>
      </div>

      <div class="cloradLightningRow">
        <span
          class="cloradLightningDot"
          style="background:#ff6d00"
        ></span>
        <span>3–4 мин</span>
      </div>

      <div class="cloradLightningRow">
        <span
          class="cloradLightningDot"
          style="background:#ff4a2b"
        ></span>
        <span>4–5 мин</span>
      </div>

      <div class="cloradLightningRow">
        <span
          class="cloradLightningDot"
          style="background:#ff2d2d"
        ></span>
        <span>5–6 мин</span>
      </div>

      <div class="cloradLightningRow">
        <span
          class="cloradLightningDot"
          style="background:#d91f1f"
        ></span>
        <span>6–8 мин</span>
      </div>

      <div class="cloradLightningRow">
        <span
          class="cloradLightningDot"
          style="background:#b51515"
        ></span>
        <span>8–10 мин</span>
      </div>

      <div class="cloradLightningRow">
        <span
          class="cloradLightningDot"
          style="background:#7a1010"
        ></span>
        <span>10–15 мин</span>
      </div>

      <div class="cloradLightningGradient"></div>

      <div class="cloradLightningScale">
        <span>свежее</span>
        <span>старее</span>
      </div>

      <div
        style="
          font-size:10px;
          color:#89939a;
          line-height:14px;
          margin-top:3px;
        "
      >
        Размер точки также уменьшается
        с возрастом разряда.
      </div>

    `;

    legend.appendChild(
      lightningContent
    );

    const oyaButton =
      legendSwitch.querySelector(
        '[data-legend="oya"]'
      );

    const lightningButton =
      legendSwitch.querySelector(
        '[data-legend="lightning"]'
      );

    function showLegend(
      type
    ) {

      const lightning =
        type === "lightning";

      /*
         ОЯ
         */

      legendTitle.style.display =
        lightning
          ? "none"
          : "";

      legendItems.forEach(
        item => {

          item.style.display =
            lightning
              ? "none"
              : "";
        }
      );

      /*
         Молнии
         */

      lightningContent.style.display =
        lightning
          ? "block"
          : "none";

      oyaButton.classList.toggle(
        "active",
        !lightning
      );

      lightningButton.classList.toggle(
        "active",
        lightning
      );
    }

    oyaButton.onclick =
      event => {

        event.preventDefault();

        event.stopPropagation();

        showLegend(
          "oya"
        );
      };

    lightningButton.onclick =
      event => {

        event.preventDefault();

        event.stopPropagation();

        showLegend(
          "lightning"
        );
      };

    /*
       По умолчанию открывается
       легенда ОЯ.
    */

    showLegend(
      "oya"
    );
  }

  /* =======================================================
     UPDATE TIMER
     ======================================================= */

  setInterval(
    updateStrikes,
    1000
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

      if (!enabled) {
        return;
      }

      console.log(
        "[CLOrad Lightning] Принудительное переподключение."
      );

      connectionId++;

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
        socket.readyState ===
          WebSocket.OPEN
      );
    }
  };

  /* =======================================================
     INITIAL STATE
     ======================================================= */

  /*
     В твоём index.html переключатель
     изначально имеет class="switch on",
     поэтому сразу включаем молнии.
  */

  enable();

})();
