(() => {
  "use strict";

  const WS_URL = "wss://live2.lightningmaps.org/";
  const MAX_AGE = 15 * 60 * 1000;

  const map = window.map;
  const switchEl = document.getElementById("lightningSwitch");

  if (!map || !switchEl) {
    console.error("[CLOrad Lightning] map или переключатель не найден");
    return;
  }

  // =========================================================
  // STATE
  // =========================================================

  let enabled = false;
  let socket = null;
  let reconnectTimer = null;
  let generation = 0;

  const strikes = new Map();
  const layer = L.layerGroup();

  // =========================================================
  // COLORS
  // =========================================================

  function lerp(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  function mix(c1, c2, t) {
    return [
      lerp(c1[0], c2[0], t),
      lerp(c1[1], c2[1], t),
      lerp(c1[2], c2[2], t)
    ];
  }

  function strikeColor(age) {
    const min = age / 60000;

    const yellow = [255, 245, 0];
    const orange = [255, 150, 0];
    const red = [235, 35, 20];
    const darkRed = [115, 5, 8];

    let c;

    if (min <= 2) {
      c = mix(yellow, orange, min / 2);
    } else if (min <= 5) {
      c = mix(orange, red, (min - 2) / 3);
    } else {
      c = mix(red, darkRed, Math.min(1, (min - 5) / 10));
    }

    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // =========================================================
  // SIZE
  // =========================================================

  function strikeRadius(age) {
    const min = age / 60000;

    if (min < 1) return 8;
    if (min < 2) return 7;
    if (min < 3) return 6;
    if (min < 4) return 5;
    if (min < 5) return 4.5;
    if (min < 6) return 4;
    if (min < 8) return 3.5;
    if (min < 10) return 3;
    return 2;
  }

  // =========================================================
  // TIME
  // =========================================================

  function getStrikeTime(stroke) {
    if (typeof stroke.time !== "number") {
      return Date.now();
    }

    // milliseconds
    if (stroke.time > 100000000000) {
      return stroke.time;
    }

    // seconds
    return stroke.time * 1000;
  }

  // =========================================================
  // ADD STRIKE
  // =========================================================

  function addStrike(stroke) {
    if (!enabled) return;

    if (!stroke) return;

    const lat = Number(stroke.lat);
    const lon = Number(stroke.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return;
    }

    const time = getStrikeTime(stroke);
    const now = Date.now();
    const age = now - time;

    // ignore clearly future data
    if (age < -60000) return;

    // ignore old data
    if (age > MAX_AGE) return;

    const id =
      stroke.id != null
        ? String(stroke.id)
        : `${lat}_${lon}_${time}`;

    // already exists
    if (strikes.has(id)) {
      return;
    }

    const marker = L.circleMarker([lat, lon], {
      radius: strikeRadius(Math.max(0, age)),
      color: strikeColor(Math.max(0, age)),
      weight: 0,
      fillColor: strikeColor(Math.max(0, age)),
      fillOpacity: 1,
      opacity: 1,
      interactive: false
    });

    marker.addTo(layer);

    strikes.set(id, {
      marker,
      time
    });
  }

  // =========================================================
  // PROCESS MESSAGE
  // =========================================================

  function processMessage(raw) {
    if (!enabled) return;

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (Array.isArray(data.strokes)) {
      for (const stroke of data.strokes) {
        addStrike(stroke);
      }
      return;
    }

    if (data.lat != null && data.lon != null) {
      addStrike(data);
    }
  }

  // =========================================================
  // SUBSCRIPTION
  // =========================================================

  function sendSubscription(ws) {
    if (!enabled) return;
    if (ws !== socket) return;
    if (ws.readyState !== WebSocket.OPEN) return;

    const bounds = map.getBounds();

    const north = bounds.getNorth();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const west = bounds.getWest();

    const message = {
      v: 24,
      i: {},
      s: false,
      x: 0,
      w: 0,
      tx: 0,
      tw: 1,
      a: 4,
      z: map.getZoom(),
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
      ws.send(JSON.stringify(message));
      console.log("[CLOrad Lightning] subscription sent");
    } catch (e) {
      console.error("[CLOrad Lightning] subscription error", e);
    }
  }

  // =========================================================
  // DESTROY SOCKET
  // =========================================================

  function destroySocket() {
    const old = socket;

    socket = null;

    if (!old) return;

    old.onopen = null;
    old.onmessage = null;
    old.onerror = null;
    old.onclose = null;

    try {
      old.close();
    } catch {}
  }

  // =========================================================
  // RECONNECT
  // =========================================================

  function scheduleReconnect(myGeneration) {
    if (!enabled) return;
    if (myGeneration !== generation) return;

    clearTimeout(reconnectTimer);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;

      if (!enabled) return;
      if (myGeneration !== generation) return;

      connect(myGeneration);
    }, 4000);
  }

  // =========================================================
  // CONNECT
  // =========================================================

  function connect(myGeneration) {
    if (!enabled) return;
    if (myGeneration !== generation) return;

    // destroy only the socket belonging to this generation
    if (socket) {
      destroySocket();
    }

    console.log("[CLOrad Lightning] connecting...");

    let ws;

    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      console.error("[CLOrad Lightning] WebSocket creation failed", e);
      scheduleReconnect(myGeneration);
      return;
    }

    socket = ws;

    ws.onopen = () => {
      // This socket is no longer relevant
      if (
        !enabled ||
        myGeneration !== generation ||
        socket !== ws
      ) {
        try {
          ws.close();
        } catch {}
        return;
      }

      console.log("[CLOrad Lightning] connected");

      sendSubscription(ws);
    };

    ws.onmessage = event => {
      if (
        !enabled ||
        myGeneration !== generation ||
        socket !== ws
      ) {
        return;
      }

      processMessage(event.data);
    };

    ws.onerror = error => {
      if (
        !enabled ||
        myGeneration !== generation ||
        socket !== ws
      ) {
        return;
      }

      console.warn("[CLOrad Lightning] WebSocket error", error);
    };

    ws.onclose = event => {
      console.log(
        "[CLOrad Lightning] disconnected",
        event.code,
        event.reason || ""
      );

      if (
        !enabled ||
        myGeneration !== generation ||
        socket !== ws
      ) {
        return;
      }

      socket = null;

      scheduleReconnect(myGeneration);
    };
  }

  // =========================================================
  // CLEAR
  // =========================================================

  function clearStrikes() {
    strikes.forEach(item => {
      try {
        item.marker.remove();
      } catch {}
    });

    strikes.clear();
    layer.clearLayers();
  }

  // =========================================================
  // UPDATE AGE
  // =========================================================

  function updateStrikes() {
    const now = Date.now();

    strikes.forEach((item, id) => {
      const age = now - item.time;

      if (age > MAX_AGE) {
        try {
          item.marker.remove();
        } catch {}

        strikes.delete(id);
        return;
      }

      const safeAge = Math.max(0, age);
      const color = strikeColor(safeAge);

      item.marker.setStyle({
        radius: strikeRadius(safeAge),
        color,
        fillColor: color,
        fillOpacity: 1,
        opacity: 1
      });
    });
  }

  setInterval(updateStrikes, 1000);

  // =========================================================
  // ENABLE
  // =========================================================

  function enable() {
    if (enabled) {
      // Even if the state somehow stayed enabled,
      // force a fresh connection.
      generation++;

      clearTimeout(reconnectTimer);
      reconnectTimer = null;

      destroySocket();

      clearStrikes();

      connect(generation);
      return;
    }

    enabled = true;

    generation++;

    clearTimeout(reconnectTimer);
    reconnectTimer = null;

    clearStrikes();

    layer.addTo(map);

    switchEl.classList.add("on");
    switchEl.setAttribute("aria-checked", "true");

    connect(generation);

    console.log("[CLOrad Lightning] ENABLED");
  }

  // =========================================================
  // DISABLE
  // =========================================================

  function disable() {
    enabled = false;

    // Invalidate EVERYTHING belonging to the old connection.
    generation++;

    clearTimeout(reconnectTimer);
    reconnectTimer = null;

    destroySocket();

    clearStrikes();

    layer.remove();

    switchEl.classList.remove("on");
    switchEl.setAttribute("aria-checked", "false");

    console.log("[CLOrad Lightning] DISABLED");
  }

  // =========================================================
  // SWITCH
  // =========================================================

  function setEnabled(value) {
    if (value) {
      enable();
    } else {
      disable();
    }
  }

  switchEl.onclick = function (event) {
    event.preventDefault();
    event.stopPropagation();

    setEnabled(!enabled);
  };

  // =========================================================
  // MAP MOVEMENT
  // =========================================================

  let refreshTimer = null;

  function refreshSubscription() {
    if (!enabled) return;

    clearTimeout(refreshTimer);

    refreshTimer = setTimeout(() => {
      if (!enabled) return;

      const current = socket;

      if (!current || current.readyState !== WebSocket.OPEN) {
        return;
      }

      sendSubscription(current);
    }, 300);
  }

  map.on("moveend zoomend", refreshSubscription);

  // =========================================================
  // LEGEND
  // =========================================================

  function createLegendControls() {
    const legend = document.getElementById("legend");

    if (!legend) return;
    if (legend.querySelector(".cloradLegendSwitch")) return;

    const title = legend.querySelector(".legendTitle");
    const items = [...legend.querySelectorAll(".li")];

    const switcher = document.createElement("div");

    switcher.className = "cloradLegendSwitch";

    switcher.innerHTML = `
      <button type="button"
              class="cloradLegendBtn active"
              data-legend="oya">
        ОЯ
      </button>

      <button type="button"
              class="cloradLegendBtn"
              data-legend="lightning"
              aria-label="Молнии">

        <svg viewBox="0 0 24 24"
             width="17"
             height="17"
             aria-hidden="true">
          <path
            d="M13 2L4 14h7l-1 8 10-13h-7z"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"/>
        </svg>

      </button>
    `;

    legend.insertBefore(switcher, legend.firstChild);

    const lightningLegend = document.createElement("div");

    lightningLegend.className = "cloradLightningLegend";
    lightningLegend.style.display = "none";

    lightningLegend.innerHTML = `
      <div class="cloradLightningGradient"></div>

      <div class="cloradLightningScale">
        <span>0 мин</span>
        <span>15 мин</span>
      </div>

      <div class="cloradLightningNote">
        Свежие разряды ярко-жёлтые.
        Старые постепенно становятся красными
        и исчезают через 15 минут.
      </div>
    `;

    legend.appendChild(lightningLegend);

    const oyaBtn = switcher.querySelector('[data-legend="oya"]');
    const lightningBtn =
      switcher.querySelector('[data-legend="lightning"]');

    function showOya() {
      oyaBtn.classList.add("active");
      lightningBtn.classList.remove("active");

      if (title) title.style.display = "";
      items.forEach(x => {
        x.style.display = "";
      });

      lightningLegend.style.display = "none";
    }

    function showLightning() {
      lightningBtn.classList.add("active");
      oyaBtn.classList.remove("active");

      if (title) title.style.display = "none";

      items.forEach(x => {
        x.style.display = "none";
      });

      lightningLegend.style.display = "";
    }

    oyaBtn.onclick = showOya;
    lightningBtn.onclick = showLightning;

    const style = document.createElement("style");

    style.textContent = `
      .cloradLegendSwitch {
        display:flex;
        align-items:center;
        gap:5px;
        margin-bottom:10px;
      }

      .cloradLegendBtn {
        width:34px;
        height:30px;
        padding:0;
        border:0;
        border-radius:7px;
        background:rgba(120,120,120,.16);
        color:inherit;
        display:flex;
        align-items:center;
        justify-content:center;
        cursor:pointer;
        font-weight:600;
      }

      .cloradLegendBtn.active {
        background:rgba(255,255,255,.18);
      }

      .cloradLightningLegend {
        padding:4px 2px 2px;
      }

      .cloradLightningGradient {
        width:100%;
        height:12px;
        border-radius:8px;
        background:
          linear-gradient(
            to right,
            rgb(255,245,0),
            rgb(255,150,0),
            rgb(235,35,20),
            rgb(115,5,8)
          );
      }

      .cloradLightningScale {
        display:flex;
        justify-content:space-between;
        font-size:11px;
        opacity:.75;
        margin-top:5px;
      }

      .cloradLightningNote {
        font-size:11px;
        line-height:1.35;
        opacity:.7;
        margin-top:10px;
      }
    `;

    document.head.appendChild(style);
  }

  // =========================================================
  // PUBLIC API
  // =========================================================

  window.CLOradLightning = {
    enable,
    disable,
    setEnabled,
    clear: clearStrikes,

    reconnect() {
      if (!enabled) return;

      generation++;

      clearTimeout(reconnectTimer);
      reconnectTimer = null;

      destroySocket();
      connect(generation);
    },

    isEnabled() {
      return enabled;
    },

    isConnected() {
      return !!(
        socket &&
        socket.readyState === WebSocket.OPEN
      );
    }
  };

  // =========================================================
  // START
  // =========================================================

  createLegendControls();

  enable();

})();
