(() => {
  "use strict";

  /*
  ============================================================
  CLOrad — LIGHTNING
  ============================================================
  */

  const WS_URL = "wss://live2.lightningmaps.org/";

  const MAX_AGE = 15 * 60 * 1000;
  const UPDATE_INTERVAL = 250;

  // Волна появляется только у действительно нового удара
  const WAVE_NEW_AGE = 2500;
  const WAVE_DURATION = 1000;

  const strikes = new Map();

  let layer = null;
  let socket = null;

  let enabled = true;
  let generation = 0;

  let reconnectTimer = null;
  let updateTimer = null;
  let viewportTimer = null;

  let waveFrame = null;
  const activeWaves = new Set();


  /*
  ============================================================
  LAYER
  ============================================================
  */

  function createLayer() {

    if (layer) {
      return layer;
    }

    layer = L.layerGroup();

    return layer;
  }


  /*
  ============================================================
  ЦВЕТ
  ============================================================
  */

  function getLightningColor(age) {

    const minute = age / 60000;

    const stops = [
      { t: 0,  r:255, g:247, b:0 },
      { t: 1,  r:255, g:230, b:0 },
      { t: 3,  r:255, g:190, b:0 },
      { t: 5,  r:255, g:135, b:0 },
      { t: 8,  r:255, g:80,  b:0 },
      { t:10,  r:255, g:35,  b:0 },
      { t:15,  r:255, g:0,   b:0 }
    ];

    if (minute <= 0) {
      return "rgb(255,247,0)";
    }

    if (minute >= 15) {
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

        const blue =
          Math.round(
            a.b + (b.b - a.b) * p
          );

        return `rgb(${r},${g},${blue})`;
      }
    }

    return "rgb(255,0,0)";
  }


  /*
  ============================================================
  ОБВОДКА МОЛНИЙ
  ============================================================
  */

  function getLightningStroke(age) {

    const minute = age / 60000;

    if (minute < 1) {

      return {
        color:"#ff3b00",
        weight:2.2,
        opacity:1
      };

    }

    if (minute < 2) {

      return {
        color:"#ff4a00",
        weight:2,
        opacity:.98
      };

    }

    if (minute < 3) {

      return {
        color:"#ff6500",
        weight:1.8,
        opacity:.96
      };

    }

    if (minute < 4) {

      return {
        color:"#ff8500",
        weight:1.6,
        opacity:.94
      };

    }

    if (minute < 5) {

      return {
        color:"#ff9d00",
        weight:1.5,
        opacity:.92
      };

    }

    return {

      color:getLightningColor(age),

      weight:1.2,

      opacity:.9

    };
  }


  /*
  ============================================================
  РАЗМЕР
  ============================================================
  */

  function getLightningSize(age) {

    const minute = age / 60000;

    if (minute < 1) return 8;
    if (minute < 2) return 7;
    if (minute < 3) return 6;
    if (minute < 4) return 5;
    if (minute < 5) return 4.5;
    if (minute < 6) return 4;
    if (minute < 8) return 3.5;
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

    const age =
      Date.now() -
      strike.time;

    const size =
      getLightningSize(age);

    if (!size) {
      return null;
    }

    const color =
      getLightningColor(age);

    const stroke =
      getLightningStroke(age);

    const marker =
      L.circleMarker(
        [
          strike.lat,
          strike.lon
        ],
        {

          radius:size,

          color:stroke.color,

          weight:stroke.weight,

          opacity:stroke.opacity,

          fillColor:color,

          fillOpacity:1,

          interactive:false

        }
      );

    strike.lastSize =
      size;

    strike.lastColor =
      color;

    strike.lastStroke =
      stroke;

    return marker;
  }


  /*
  ============================================================
  ДОБАВЛЕНИЕ STRIKE
  ============================================================
  */

  function addStrike(data) {

    if (
      !data ||
      !Number.isFinite(data.lat) ||
      !Number.isFinite(data.lon)
    ) {
      return;
    }

    const time =
      Number.isFinite(data.time)
        ? data.time
        : Date.now();

    const id =
      String(
        data.id ??
        `${data.lat}_${data.lon}_${time}`
      );

    if (strikes.has(id)) {
      return;
    }

    const strike = {

      id,

      lat:data.lat,

      lon:data.lon,

      time,

      marker:null,

      wave:null,

      lastSize:null,

      lastColor:null,

      lastStroke:null

    };

    strikes.set(
      id,
      strike
    );


    const marker =
      createStrikeMarker(
        strike
      );

    if (marker) {

      strike.marker =
        marker;

      layer.addLayer(
        marker
      );

    }


    /*
    Волна только для свежего удара.
    История при подключении волн не получает.
    */

    const strikeAge =
      Date.now() -
      time;

    if (
      strikeAge >= 0 &&
      strikeAge <= WAVE_NEW_AGE
    ) {

      createStrikeWave(
        strike
      );

    }
  }


  /*
  ============================================================
  АНИМАЦИЯ ВОЛНЫ
  ============================================================
  */

  function startWaveLoop() {

    if (waveFrame) {
      return;
    }

    function frame(now) {

      waveFrame = null;

      if (
        !enabled ||
        activeWaves.size === 0
      ) {
        return;
      }

      for (
        const waveData of activeWaves
      ) {

        const progress =
          Math.min(
            1,
            (now - waveData.start) /
            WAVE_DURATION
          );

        const eased =
          1 -
          Math.pow(
            1 - progress,
            3
          );

        const radius =
          2 +
          eased * 24;

        const opacity =
          1 - eased;

        if (
          waveData.marker
        ) {

          waveData.marker.setRadius(
            radius
          );

          waveData.marker.setStyle({

            opacity,

            weight:
              progress < .45
                ? 2
                : 1.5

          });

        }

        if (
          progress >= 1
        ) {

          if (
            layer &&
            layer.hasLayer(
              waveData.marker
            )
          ) {

            layer.removeLayer(
              waveData.marker
            );

          }

          activeWaves.delete(
            waveData
          );

          if (
            waveData.strike
          ) {

            waveData.strike.wave =
              null;

          }
        }
      }

      if (
        activeWaves.size > 0
      ) {

        waveFrame =
          requestAnimationFrame(
            frame
          );

      }
    }

    waveFrame =
      requestAnimationFrame(
        frame
      );
  }


  function createStrikeWave(strike) {

    if (
      !enabled ||
      !layer
    ) {
      return;
    }

    const wave =
      L.circleMarker(
        [
          strike.lat,
          strike.lon
        ],
        {

          radius:2,

          color:"#ffffff",

          weight:2,

          opacity:1,

          fill:false,

          interactive:false

        }
      );

    strike.wave =
      wave;

    layer.addLayer(
      wave
    );

    const waveData = {

      marker:wave,

      strike,

      start:
        performance.now()

    };

    activeWaves.add(
      waveData
    );

    startWaveLoop();
  }


  /*
  ============================================================
  ОБНОВЛЕНИЕ
  ============================================================
  */

  function updateStrikes() {

    if (!enabled) {
      return;
    }

    const now =
      Date.now();

    strikes.forEach(
      (strike, id) => {

        const age =
          now -
          strike.time;


        if (
          age >= MAX_AGE
        ) {

          if (
            strike.marker &&
            layer.hasLayer(
              strike.marker
            )
          ) {

            layer.removeLayer(
              strike.marker
            );

          }

          if (
            strike.wave &&
            layer.hasLayer(
              strike.wave
            )
          ) {

            layer.removeLayer(
              strike.wave
            );

          }

          strikes.delete(
            id
          );

          return;
        }


        if (
          !strike.marker
        ) {
          return;
        }


        const size =
          getLightningSize(
            age
          );

        const color =
          getLightningColor(
            age
          );

        const stroke =
          getLightningStroke(
            age
          );


        const changed =

          strike.lastSize !==
            size ||

          strike.lastColor !==
            color ||

          !strike.lastStroke ||

          strike.lastStroke.color !==
            stroke.color ||

          strike.lastStroke.weight !==
            stroke.weight ||

          strike.lastStroke.opacity !==
            stroke.opacity;


        if (!changed) {
          return;
        }


        strike.marker.setStyle({

          radius:size,

          color:
            stroke.color,

          weight:
            stroke.weight,

          opacity:
            stroke.opacity,

          fillColor:
            color,

          fillOpacity:1

        });


        strike.lastSize =
          size;

        strike.lastColor =
          color;

        strike.lastStroke =
          stroke;

      }
    );
  }


  /*
  ============================================================
  UPDATE LOOP
  ============================================================
  */

  function startUpdateLoop() {

    stopUpdateLoop();

    updateTimer =
      setInterval(
        updateStrikes,
        UPDATE_INTERVAL
      );
  }


  function stopUpdateLoop() {

    if (
      updateTimer
    ) {

      clearInterval(
        updateTimer
      );

      updateTimer =
        null;
    }
  }


  /*
  ============================================================
  VIEWPORT
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
        bounds.getNorth(),
        bounds.getEast(),
        bounds.getSouth(),
        bounds.getWest()
      ],

      r:"A"

    };

    try {

      socket.send(
        JSON.stringify(
          message
        )
      );

    } catch {}
  }


  /*
  ============================================================
  WEBSOCKET
  ============================================================
  */

  function connect(myGeneration) {

    if (
      !enabled ||
      myGeneration !==
        generation
    ) {
      return;
    }

    try {

      socket =
        new WebSocket(
          WS_URL
        );

    } catch {

      scheduleReconnect(
        myGeneration
      );

      return;
    }


    socket.onopen =
      () => {

        if (
          !enabled ||
          myGeneration !==
            generation
        ) {

          try {
            socket.close();
          } catch {}

          return;
        }

        sendViewport();
      };


    socket.onmessage =
      event => {

        if (
          !enabled ||
          myGeneration !==
            generation
        ) {
          return;
        }

        handleMessage(
          event.data
        );
      };


    socket.onerror =
      () => {};


    socket.onclose =
      () => {

        if (
          !enabled ||
          myGeneration !==
            generation
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
  MESSAGE
  ============================================================
  */

  function handleMessage(raw) {

    if (
      typeof raw !==
        "string"
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

      return;
    }


    if (
      Array.isArray(
        data.strokes
      )
    ) {

      for (
        const stroke of
        data.strokes
      ) {

        parseStroke(
          stroke
        );

      }
    }


    if (
      Array.isArray(data)
    ) {

      for (
        const item of
        data
      ) {

        if (
          item &&
          Array.isArray(
            item.strokes
          )
        ) {

          for (
            const stroke of
            item.strokes
          ) {

            parseStroke(
              stroke
            );

          }
        }
      }
    }


    if (
      Number.isFinite(
        data.lat
      ) &&
      Number.isFinite(
        data.lon
      )
    ) {

      parseStroke(
        data
      );
    }
  }


  /*
  ============================================================
  PARSE STROKE
  ============================================================
  */

  function parseStroke(stroke) {

    if (!stroke) {
      return;
    }

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


    if (
      Number.isFinite(time)
    ) {

      if (
        time < 100000000000
      ) {

        time *= 1000;

      }

    } else {

      time =
        Date.now();

    }


    if (
      time >
      Date.now() + 5000
    ) {

      time =
        Date.now();

    }


    addStrike({

      id:
        stroke.id ??
        stroke.ID ??
        `${lat}_${lon}_${time}`,

      lat,

      lon,

      time

    });
  }


  /*
  ============================================================
  RECONNECT
  ============================================================
  */

  function scheduleReconnect(
    myGeneration
  ) {

    if (
      !enabled ||
      myGeneration !==
        generation
    ) {
      return;
    }

    clearTimeout(
      reconnectTimer
    );

    reconnectTimer =
      setTimeout(
        () => {

          if (
            enabled &&
            myGeneration ===
              generation
          ) {

            connect(
              myGeneration
            );

          }

        },
        3000
      );
  }


  /*
  ============================================================
  ЛЕГЕНДА
  ============================================================
  ВАЖНО:
  НИГДЕ НИЖЕ НЕ МЕНЯЕТСЯ POSITION ЛЕГЕНДЫ.
  Мы используем уже существующий .legend.
  ============================================================
  */

  function setupLegend() {

    const legend =
      document.querySelector(
        ".legend"
      );

    if (!legend) {
      return;
    }


    /*
    Если новая версия уже была создана,
    повторно ничего не добавляем.
    */

    if (
      document.getElementById(
        "cloradLegendControls"
      )
    ) {
      return;
    }


    legend.classList.add(
      "cloradLegendReady"
    );


    /*
    ==========================================================
    КНОПКИ ОЯ / МОЛНИЯ
    ==========================================================
    */

    const controls =
      document.createElement(
        "div"
      );

    controls.id =
      "cloradLegendControls";


    controls.innerHTML = `

      <button
        type="button"
        id="cloradOyaButton"
        class="cloradLegendSwitch active"
        aria-label="ОЯ"
      >
        ОЯ
      </button>

      <button
        type="button"
        id="cloradLightningButton"
        class="cloradLegendSwitch"
        aria-label="Молнии"
      >

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

      </button>

    `;


    /*
    Вставляем кнопки в существующую
    легенду.

    НИКАКОГО position/fixed/left/bottom.
    */

    const closeButton =
      legend.querySelector(
        ".legendClose"
      );


    if (
      closeButton &&
      closeButton.nextSibling
    ) {

      legend.insertBefore(
        controls,
        closeButton.nextSibling
      );

    } else {

      legend.insertBefore(
        controls,
        legend.firstChild
      );

    }


    /*
    ==========================================================
    ЛЕГЕНДА МОЛНИЙ
    ==========================================================
    */

    const lightningView =
      document.createElement(
        "div"
      );

    lightningView.id =
      "cloradLightningLegendView";


    lightningView.innerHTML = `

      <div class="cloradLightningScale">

        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ff0000;
              --lb:#8f0000;
              --ls:6px;
            "
          ></span>

          <span class="cloradLightningTime">
            10–15
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ff3500;
              --lb:#b51d00;
              --ls:6.5px;
            "
          ></span>

          <span class="cloradLightningTime">
            8–10
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ff6500;
              --lb:#c84300;
              --ls:7px;
            "
          ></span>

          <span class="cloradLightningTime">
            6–8
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ff9200;
              --lb:#d66300;
              --ls:7.5px;
            "
          ></span>

          <span class="cloradLightningTime">
            5–6
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ffb000;
              --lb:#df7d00;
              --ls:8px;
            "
          ></span>

          <span class="cloradLightningTime">
            4–5
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ffd000;
              --lb:#e0a500;
              --ls:8.5px;
            "
          ></span>

          <span class="cloradLightningTime">
            3–4
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ffe300;
              --lb:#ddca00;
              --ls:9px;
            "
          ></span>

          <span class="cloradLightningTime">
            2–3
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#fff000;
              --lb:#e2d500;
              --ls:10px;
            "
          ></span>

          <span class="cloradLightningTime">
            1–2
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="
              cloradLightningDot
              latest
            "
            style="
              --lc:#fff900;
              --lb:#ffffff;
              --ls:11px;
            "
          ></span>

          <span class="cloradLightningTime">
            0–1
          </span>

        </div>

      </div>


      <div class="cloradLightningUnits">
        минуты
      </div>

    `;


    legend.appendChild(
      lightningView
    );


    /*
    ==========================================================
    CSS ТОЛЬКО ДЛЯ ДОБАВЛЕННЫХ ЭЛЕМЕНТОВ
    ==========================================================
    */

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "cloradLegendLightningStyle";


    style.textContent = `

      /*
      ========================================================
      КНОПКИ
      ========================================================
      */

      #cloradLegendControls{

        display:flex;

        align-items:center;

        justify-content:center;

        gap:5px;

        width:100%;

        box-sizing:border-box;

        padding-right:38px;

        margin:
          0 0 8px 0;

        min-height:29px;

      }


      .cloradLegendSwitch{

        appearance:none;

        -webkit-appearance:none;

        border:
          1px solid
          rgba(255,255,255,.12);

        background:
          rgba(255,255,255,.035);

        color:#aeb7bd;

        width:38px;

        height:27px;

        padding:0;

        border-radius:7px;

        display:flex;

        align-items:center;

        justify-content:center;

        font-family:inherit;

        font-size:12px;

        font-weight:700;

        line-height:1;

        cursor:pointer;

        box-sizing:border-box;

        transition:
          background .15s ease,
          border-color .15s ease,
          color .15s ease;

      }


      .cloradLegendSwitch.active{

        background:
          rgba(83,227,155,.10);

        border-color:
          rgba(83,227,155,.35);

        color:#53e39b;

      }


      .cloradLegendSwitch svg{

        display:block;

        width:11px;

        height:18px;

      }


      /*
      ========================================================
      ЛЕГЕНДА МОЛНИЙ
      ========================================================
      */

      #cloradLightningLegendView{

        display:none;

        width:100%;

        box-sizing:border-box;

      }


      .legend.cloradLightningMode
      #cloradLightningLegendView{

        display:block;

      }


      .legend.cloradLightningMode
      .legendTitle,

      .legend.cloradLightningMode
      .li{

        display:none !important;

      }


      /*
      ========================================================
      ШКАЛА
      ========================================================
      */

      .cloradLightningScale{

        width:100%;

        display:flex;

        align-items:flex-start;

        justify-content:space-between;

        gap:1px;

        box-sizing:border-box;

      }


      .cloradLightningScaleItem{

        flex:1;

        min-width:0;

        display:flex;

        flex-direction:column;

        align-items:center;

        justify-content:flex-start;

      }


      .cloradLightningDot{

        display:block;

        width:var(--ls);

        height:var(--ls);

        flex:none;

        border-radius:50%;

        box-sizing:border-box;

        background:
          var(--lc);

        border:
          1.5px solid
          var(--lb);

        box-shadow:
          0 0 4px
          rgba(255,180,0,.35);

      }


      /*
      Самая свежая молния.
      */

      .cloradLightningDot.latest{

        border:
          1.5px solid
          #ffffff;

        box-shadow:

          0 0 0 1.5px
          rgba(255,255,255,.20),

          0 0 7px
          rgba(255,235,0,.85);

      }


      .cloradLightningTime{

        display:block;

        margin-top:5px;

        white-space:nowrap;

        color:#cbd3d8;

        font-size:7px;

        line-height:8px;

        font-weight:600;

      }


      .cloradLightningUnits{

        text-align:center;

        margin-top:6px;

        color:#8f9aa1;

        font-size:7px;

        line-height:8px;

      }


      /*
      ========================================================
      LIGHT THEME
      ========================================================
      */

      body.light
      .cloradLegendSwitch{

        color:#69747b;

        border-color:
          rgba(0,0,0,.10);

        background:
          rgba(0,0,0,.025);

      }


      body.light
      .cloradLegendSwitch.active{

        color:#168453;

        background:
          rgba(22,132,83,.08);

        border-color:
          rgba(22,132,83,.25);

      }


      body.light
      .cloradLightningTime{

        color:#59636a;

      }


      body.light
      .cloradLightningUnits{

        color:#7b858b;

      }


      /*
      ========================================================
      MOBILE
      ========================================================
      */

      @media(max-width:600px){

        #cloradLegendControls{

          padding-right:36px;

          margin-bottom:7px;

        }


        .cloradLegendSwitch{

          width:35px;

          height:26px;

        }


        .cloradLightningTime{

          font-size:6.5px;

        }

      }

    `;


    document.head.appendChild(
      style
    );


    /*
    ==========================================================
    ПЕРЕКЛЮЧЕНИЕ
    ==========================================================
    */

    const oyaButton =
      document.getElementById(
        "cloradOyaButton"
      );

    const lightningButton =
      document.getElementById(
        "cloradLightningButton"
      );


    function showOya() {

      legend.classList.remove(
        "cloradLightningMode"
      );

      oyaButton.classList.add(
        "active"
      );

      lightningButton.classList.remove(
        "active"
      );

    }


    function showLightning() {

      legend.classList.add(
        "cloradLightningMode"
      );

      lightningButton.classList.add(
        "active"
      );

      oyaButton.classList.remove(
        "active"
      );

    }


    oyaButton.onclick =
      showOya;


    lightningButton.onclick =
      showLightning;


    showOya();

  }


  /*
  ============================================================
  MAP EVENTS
  ============================================================
  */

  function setupMapEvents() {

    if (!window.map) {
      return;
    }


    const updateViewport =
      () => {

        clearTimeout(
          viewportTimer
        );

        viewportTimer =
          setTimeout(
            () => {

              if (
                enabled &&
                socket &&
                socket.readyState ===
                  WebSocket.OPEN
              ) {

                sendViewport();

              }

            },
            150
          );
      };


    window.map.on(
      "moveend",
      updateViewport
    );


    window.map.on(
      "zoomend",
      updateViewport
    );

  }


  /*
  ============================================================
  ENABLE / DISABLE
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

      stopUpdateLoop();


      if (socket) {

        try {
          socket.close();
        } catch {}

      }


      socket =
        null;


      if (
        layer &&
        window.map &&
        window.map.hasLayer(
          layer
        )
      ) {

        window.map.removeLayer(
          layer
        );

      }


      return;
    }


    createLayer();


    if (
      window.map &&
      !window.map.hasLayer(
        layer
      )
    ) {

      layer.addTo(
        window.map
      );

    }


    startUpdateLoop();


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

      activeWaves.clear();

      if (layer) {

        layer.clearLayers();

      }

    }

  };


  /*
  ============================================================
  EXPORT
  ============================================================
  */

  createLayer();

  window.CLOradLightningLayer =
    layer;


  /*
  ============================================================
  INIT
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


    layer.addTo(
      window.map
    );


    setupLegend();


    setupMapEvents();


    startUpdateLoop();


    const myGeneration =
      ++generation;


    connect(
      myGeneration
    );


    console.log(
      "[CLOrad Lightning] loaded"
    );

  }


  init();

})();
