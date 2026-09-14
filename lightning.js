(() => {
  "use strict";

  /*
  ============================================================
  CLOrad — LIGHTNING
  ============================================================

  Источник:
    LightningMaps / Blitzortung live2

  Цвет:
    свежая молния  → жёлтая
    старше         → оранжевая
    старая         → красная

  Размер:
    0–1 мин    8 px
    1–2 мин    7 px
    2–3 мин    6 px
    3–4 мин    5 px
    4–5 мин    4.5 px
    5–6 мин    4 px
    6–8 мин    3.5 px
    8–10 мин   3 px
    10–15 мин  2 px
    >15 мин    удаляется

  ============================================================
  */

  const WS_URL = "wss://live2.lightningmaps.org/";

  const MAX_AGE = 15 * 60 * 1000;

  const strikes = new Map();

  let socket = null;
  let enabled = true;
  let generation = 0;
  let reconnectTimer = null;

  let layer = null;

  let animationFrame = null;


  /*
  ============================================================
  LAYER
  ============================================================
  */

  function createLayer() {

    if (layer) return layer;

    layer = L.layerGroup();

    return layer;
  }


  /*
  ============================================================
  ЦВЕТ МОЛНИИ
  ============================================================
  */

  function getLightningColor(age) {

    const minute = age / 60000;

    /*
    0 мин:
      #fff700

    1 мин:
      #ffe600

    3 мин:
      #ffbd00

    5 мин:
      #ff8a00

    8 мин:
      #ff5a00

    10 мин:
      #ff3200

    15 мин:
      #ff0000
    */

    const stops = [
      { t: 0,  r: 255, g: 247, b: 0   },
      { t: 1,  r: 255, g: 225, b: 0   },
      { t: 3,  r: 255, g: 190, b: 0   },
      { t: 5,  r: 255, g: 135, b: 0   },
      { t: 8,  r: 255, g: 85,  b: 0   },
      { t: 10, r: 255, g: 45,  b: 0   },
      { t: 15, r: 255, g: 0,   b: 0   }
    ];

    if (minute <= stops[0].t) {
      return "rgb(255,247,0)";
    }

    if (minute >= stops[stops.length - 1].t) {
      return "rgb(255,0,0)";
    }

    for (let i = 0; i < stops.length - 1; i++) {

      const a = stops[i];
      const b = stops[i + 1];

      if (
        minute >= a.t &&
        minute <= b.t
      ) {

        const p =
          (minute - a.t) /
          (b.t - a.t);

        const r =
          Math.round(
            a.r + (b.r - a.r) * p
          );

        const g =
          Math.round(
            a.g + (b.g - a.g) * p
          );

        const bl =
          Math.round(
            a.b + (b.b - a.b) * p
          );

        return `rgb(${r},${g},${bl})`;
      }
    }

    return "rgb(255,0,0)";
  }


  /*
  ============================================================
  РАЗМЕР МОЛНИИ
  ============================================================
  */

  function getLightningSize(age) {

    const minute = age / 60000;

    if (minute < 1)  return 8;
    if (minute < 2)  return 7;
    if (minute < 3)  return 6;
    if (minute < 4)  return 5;
    if (minute < 5)  return 4.5;
    if (minute < 6)  return 4;
    if (minute < 8)  return 3.5;
    if (minute < 10) return 3;
    if (minute < 15) return 2;

    return 0;
  }


  /*
  ============================================================
  СОЗДАНИЕ ТОЧКИ
  ============================================================
  */

  function createStrikeMarker(strike) {

    const color =
      getLightningColor(
        Date.now() - strike.time
      );

    const size =
      getLightningSize(
        Date.now() - strike.time
      );

    if (!size) return null;


    /*
    Круглая молния.

    Самая свежая:
      жёлтый центр
      тонкий светлый контур
      дополнительное внешнее кольцо
    */

    const marker =
      L.circleMarker(
        [strike.lat, strike.lon],
        {
          radius:size,

          stroke:true,

          color:color,

          weight:
            size >= 6
              ? 2
              : 1.2,

          opacity:1,

          fillColor:color,

          fillOpacity:1,

          interactive:false
        }
      );


    /*
    Внешний ореол только для свежих.
    */

    if (
      Date.now() - strike.time <
      60000
    ) {

      const halo =
        L.circleMarker(
          [strike.lat, strike.lon],
          {
            radius:
              size + 4,

            stroke:true,

            color:"#ffffff",

            weight:2,

            opacity:.75,

            fill:false,

            interactive:false
          }
        );

      const group =
        L.layerGroup([
          halo,
          marker
        ]);

      group._cloradStrikeId =
        strike.id;

      return group;
    }


    marker._cloradStrikeId =
      strike.id;

    return marker;
  }


  /*
  ============================================================
  ДОБАВЛЕНИЕ МОЛНИИ
  ============================================================
  */

  function addStrike(data) {

    if (
      !data ||
      typeof data.lat !== "number" ||
      typeof data.lon !== "number"
    ) {
      return;
    }


    const time =
      typeof data.time === "number"
        ? data.time
        : Date.now();


    const id =
      String(
        data.id ??
        `${data.lat}_${data.lon}_${time}`
      );


    strikes.set(
      id,
      {
        id:id,
        lat:data.lat,
        lon:data.lon,
        time:time
      }
    );


    redrawStrike(id);
  }


  /*
  ============================================================
  ОБНОВЛЕНИЕ ОДНОЙ МОЛНИИ
  ============================================================
  */

  function redrawStrike(id) {

    if (!layer) return;

    const strike =
      strikes.get(id);

    if (!strike) return;


    /*
    Старый объект карты.
    */

    layer.eachLayer(item => {

      if (
        item._cloradStrikeId === id
      ) {

        layer.removeLayer(item);

      }

    });


    const age =
      Date.now() - strike.time;


    /*
    Удаляем после 15 минут.
    */

    if (age >= MAX_AGE) {

      strikes.delete(id);

      return;
    }


    const marker =
      createStrikeMarker(strike);


    if (marker) {

      marker._cloradStrikeId =
        id;

      layer.addLayer(marker);

    }
  }


  /*
  ============================================================
  ОБНОВЛЕНИЕ ВСЕХ МОЛНИЙ
  ============================================================
  */

  function updateAllStrikes() {

    if (!enabled) return;


    const now =
      Date.now();


    strikes.forEach(
      (strike, id) => {

        if (
          now - strike.time >=
          MAX_AGE
        ) {

          strikes.delete(id);

          return;
        }


        redrawStrike(id);

      }
    );


    animationFrame =
      requestAnimationFrame(
        updateAllStrikes
      );
  }


  function stopAnimation() {

    if (animationFrame) {

      cancelAnimationFrame(
        animationFrame
      );

      animationFrame = null;

    }

  }


  function startAnimation() {

    stopAnimation();

    animationFrame =
      requestAnimationFrame(
        updateAllStrikes
      );

  }


  /*
  ============================================================
  LIVE2
  ============================================================
  */

  function connect(myGeneration) {

    if (!enabled) return;

    if (
      myGeneration !== generation
    ) {
      return;
    }


    try {

      socket =
        new WebSocket(
          WS_URL
        );

    } catch (error) {

      scheduleReconnect(
        myGeneration
      );

      return;
    }


    socket.onopen = () => {

      if (
        myGeneration !== generation ||
        !enabled
      ) {

        try {
          socket.close();
        } catch {}

        return;
      }


      /*
      Запрашиваем молнии
      в пределах текущего
      окна карты.

      live2 использует:
        [latN, lonE, latS, lonW]
      */

      sendViewport();
    };


    socket.onmessage =
      event => {

        if (
          myGeneration !== generation ||
          !enabled
        ) {
          return;
        }


        handleMessage(
          event.data
        );

      };


    socket.onerror = () => {

      /*
      onclose также будет вызван.
      */

    };


    socket.onclose = () => {

      if (
        myGeneration !== generation ||
        !enabled
      ) {
        return;
      }


      scheduleReconnect(
        myGeneration
      );

    };

  }


  /*
  ============================================================
  ОТПРАВКА VIEWPORT
  ============================================================
  */

  function sendViewport() {

    if (
      !socket ||
      socket.readyState !==
      WebSocket.OPEN ||
      !window.map
    ) {
      return;
    }


    const bounds =
      window.map.getBounds();


    const north =
      bounds.getNorth();

    const south =
      bounds.getSouth();

    const east =
      bounds.getEast();

    const west =
      bounds.getWest();


    const message = {

      v:24,

      i:{},

      s:false,

      x:0,

      w:0,

      tx:0,

      tw:1,

      a:4,

      z:5,

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


    try {

      socket.send(
        JSON.stringify(message)
      );

    } catch {}

  }


  /*
  ============================================================
  ОБРАБОТКА СООБЩЕНИЙ
  ============================================================
  */

  function handleMessage(raw) {

    if (
      typeof raw !== "string"
    ) {
      return;
    }


    let data;

    try {

      data =
        JSON.parse(raw);

    } catch {

      return;

    }


    /*
    Возможные форматы
    live2:

      {
        strokes:[...]
      }

    либо массивы strokes
    */

    if (
      Array.isArray(
        data.strokes
      )
    ) {

      data.strokes.forEach(
        stroke => {

          parseStroke(
            stroke
          );

        }
      );

    }


    if (
      Array.isArray(data)
    ) {

      data.forEach(item => {

        if (
          item &&
          Array.isArray(
            item.strokes
          )
        ) {

          item.strokes.forEach(
            stroke => {

              parseStroke(
                stroke
              );

            }
          );

        }

      });

    }


    /*
    Иногда strike может прийти
    напрямую.
    */

    if (
      typeof data.lat === "number" &&
      typeof data.lon === "number"
    ) {

      parseStroke(data);

    }

  }


  /*
  ============================================================
  STROKE
  ============================================================
  */

  function parseStroke(stroke) {

    if (!stroke) return;


    const lat =
      Number(
        stroke.lat ??
        stroke.latitude
      );

    const lon =
      Number(
        stroke.lon ??
        stroke.lng ??
        stroke.longitude
      );


    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return;
    }


    let time =
      Number(
        stroke.time ??
        stroke.timestamp
      );


    /*
    live2 обычно отдаёт
    время в миллисекундах.
    */

    if (
      Number.isFinite(time)
    ) {

      if (time < 100000000000) {

        time *= 1000;

      }

    } else {

      time =
        Date.now();

    }


    addStrike({

      id:
        stroke.id ??
        stroke.ID ??
        `${lat}_${lon}_${time}`,

      lat:lat,

      lon:lon,

      time:time

    });

  }


  /*
  ============================================================
  RECONNECT
  ============================================================
  */

  function scheduleReconnect(myGeneration) {

    if (
      !enabled ||
      myGeneration !== generation
    ) {
      return;
    }


    clearTimeout(
      reconnectTimer
    );


    reconnectTimer =
      setTimeout(() => {

        if (
          enabled &&
          myGeneration === generation
        ) {

          connect(
            myGeneration
          );

        }

      },3000);

  }


  /*
  ============================================================
  КАРТА
  ============================================================
  */

  function attachLayer() {

    createLayer();


    if (
      enabled &&
      window.map &&
      !window.map.hasLayer(layer)
    ) {

      layer.addTo(
        window.map
      );

    }

  }


  /*
  ============================================================
  LEGEND
  ============================================================
  */

  function createLightningLegend() {

    if (
      document.getElementById(
        "cloradLightningLegend"
      )
    ) {
      return;
    }


    const legend =
      document.createElement(
        "div"
      );


    legend.id =
      "cloradLightningLegend";


    legend.innerHTML = `

      <div class="cloradLightningLegendTitle">

        <span class="cloradLightningIcon">

          <svg
            viewBox="0 0 32 48"
            aria-hidden="true"
          >
            <path
              d="
                M18 1
                L4 27
                H14
                L11 47
                L29 19
                H19
                Z
              "
              fill="currentColor"
            />
          </svg>

        </span>

        <span>Молнии</span>

      </div>


      <div class="cloradLightningScale">

        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ff0000;
              --ls:6px;
            "
          ></span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ff4500;
              --ls:7px;
            "
          ></span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ff8500;
              --ls:8px;
            "
          ></span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ffb000;
              --ls:9px;
            "
          ></span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ffd000;
              --ls:10px;
            "
          ></span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#fff000;
              --ls:11px;
            "
          ></span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot latest"
            style="
              --lc:#fff900;
              --ls:13px;
            "
          ></span>

        </div>

      </div>


      <div class="cloradLightningLegendBottom">

        <span>СТАРЫЕ</span>

        <span>СВЕЖИЕ</span>

      </div>

    `;


    document.body.appendChild(
      legend
    );


    const style =
      document.createElement(
        "style"
      );


    style.textContent = `

      #cloradLightningLegend{

        position:fixed;

        left:50%;

        bottom:18px;

        transform:
          translateX(-50%);

        z-index:20;

        width:360px;

        padding:
          10px 18px 9px;

        box-sizing:border-box;

        border-radius:10px;

        background:
          rgba(24,32,40,.95);

        border:
          1px solid #3d4851;

        box-shadow:
          0 5px 16px rgba(0,0,0,.25);

        color:#fff;

        pointer-events:none;

        user-select:none;

      }


      #cloradLightningLegend
      .cloradLightningLegendTitle{

        display:flex;

        align-items:center;

        justify-content:center;

        gap:9px;

        font-size:16px;

        font-weight:700;

        margin-bottom:8px;

      }


      .cloradLightningIcon{

        width:16px;

        height:22px;

        display:flex;

        align-items:center;

        justify-content:center;

        color:#fff;

      }


      .cloradLightningIcon svg{

        width:15px;

        height:22px;

        display:block;

      }


      .cloradLightningScale{

        height:28px;

        display:flex;

        align-items:center;

        justify-content:space-between;

        padding:0 5px;

      }


      .cloradLightningScaleItem{

        width:26px;

        height:26px;

        display:flex;

        align-items:center;

        justify-content:center;

      }


      .cloradLightningDot{

        display:block;

        width:var(--ls);

        height:var(--ls);

        border-radius:50%;

        background:
          var(--lc);

        border:
          1px solid
          rgba(255,255,255,.15);

        box-shadow:
          0 0 5px
          color-mix(
            in srgb,
            var(--lc) 65%,
            transparent
          );

      }


      .cloradLightningDot.latest{

        border:
          2px solid
          rgba(255,255,255,.8);

        box-shadow:
          0 0 0 2px
          rgba(255,255,255,.22),
          0 0 8px
          rgba(255,230,0,.8);

      }


      .cloradLightningLegendBottom{

        display:flex;

        justify-content:space-between;

        padding:
          2px 3px 0;

        color:#dce2e6;

        font-size:9px;

        font-weight:700;

        letter-spacing:.4px;

      }


      body.light
      #cloradLightningLegend{

        background:
          rgba(246,248,249,.95);

        border-color:#c9d0d5;

        color:#20272c;

      }


      body.light
      .cloradLightningIcon{

        color:#20272c;

      }


      body.light
      .cloradLightningLegendBottom{

        color:#59636a;

      }


      @media(max-width:600px){

        #cloradLightningLegend{

          width:300px;

          bottom:12px;

          padding:
            8px 12px 7px;

        }


        #cloradLightningLegend
        .cloradLightningLegendTitle{

          font-size:14px;

          margin-bottom:6px;

        }


        .cloradLightningScale{

          padding:0 1px;

        }


        .cloradLightningScaleItem{

          width:24px;

        }

      }

    `;


    document.head.appendChild(
      style
    );

  }


  /*
  ============================================================
  НАСТРОЙКА VIEWPORT
  ============================================================
  */

  function setupMapEvents() {

    if (!window.map) return;


    const send =
      () => {

        if (
          enabled &&
          socket &&
          socket.readyState ===
          WebSocket.OPEN
        ) {

          sendViewport();

        }

      };


    window.map.on(
      "moveend",
      send
    );


    window.map.on(
      "zoomend",
      send
    );

  }


  /*
  ============================================================
  ENABLE
  ============================================================
  */

  function setEnabled(value) {

    enabled =
      !!value;


    generation++;


    const myGeneration =
      generation;


    clearTimeout(
      reconnectTimer
    );


    if (!enabled) {

      stopAnimation();


      if (
        socket
      ) {

        try {
          socket.close();
        } catch {}

      }


      socket = null;


      if (
        layer &&
        window.map &&
        window.map.hasLayer(layer)
      ) {

        window.map.removeLayer(
          layer
        );

      }


      return;

    }


    attachLayer();

    startAnimation();

    connect(
      myGeneration
    );

  }


  /*
  ============================================================
  PUBLIC API
  ============================================================
  */

  window.CLOradLightning = {

    enable() {

      setEnabled(
        true
      );

    },


    disable() {

      setEnabled(
        false
      );

    },


    setEnabled(value) {

      setEnabled(
        value
      );

    },


    getEnabled() {

      return enabled;

    },


    clear() {

      strikes.clear();


      if (layer) {

        layer.clearLayers();

      }

    }

  };


  /*
  ============================================================
  EXPORT LAYER
  ============================================================
  */

  createLayer();


  window.CLOradLightningLayer =
    layer;


  /*
  ============================================================
  ЗАПУСК
  ============================================================
  */

  function init() {

    if (!window.map) {

      setTimeout(
        init,
        100
      );

      return;

    }


    attachLayer();

    createLightningLegend();

    setupMapEvents();

    startAnimation();


    const myGeneration =
      ++generation;


    connect(
      myGeneration
    );


    console.log(
      "[CLOrad Lightning] Загружен"
    );

  }


  init();

})();
