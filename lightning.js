(() => {
  "use strict";

  /*
  ============================================================
  CLOrad — LIGHTNING
  ============================================================

  Источник:
    LightningMaps / Blitzortung live2

  Особенности:
    • реальные молнии в реальном времени
    • цвет меняется с возрастом
    • размер уменьшается с возрастом
    • красная обводка у недавних молний
    • волна только у абсолютно свежего удара
    • волна живёт около 1 секунды
    • старые молнии удаляются
    • минимальная нагрузка на карту
    • карта визуально не изменяется
  ============================================================
  */


  const WS_URL =
    "wss://live2.lightningmaps.org/";

  const MAX_AGE =
    15 * 60 * 1000;

  /*
  Как часто обновляем внешний вид
  существующих молний.

  250 мс достаточно плавно,
  но намного легче для карты,
  чем обновление 60 раз/сек.
  */

  const UPDATE_INTERVAL = 250;


  /*
  ============================================================
  СОСТОЯНИЕ
  ============================================================
  */

  const strikes =
    new Map();

  let layer = null;

  let socket = null;

  let enabled = true;

  let generation = 0;

  let reconnectTimer = null;

  let updateTimer = null;

  let viewportTimer = null;


  /*
  ============================================================
  СОЗДАЁМ СЛОЙ
  ============================================================
  */

  function createLayer() {

    if (layer) {
      return layer;
    }

    layer =
      L.layerGroup();

    return layer;
  }


  /*
  ============================================================
  ЦВЕТ ПО ВОЗРАСТУ
  ============================================================
  */

  function getLightningColor(age) {

    const minute =
      age / 60000;


    /*
    Плавный переход:

      0 мин  — жёлтый
      1 мин  — жёлтый
      3 мин  — жёлто-оранжевый
      5 мин  — оранжевый
      8 мин  — оранжево-красный
      10 мин — красный
      15 мин — красный
    */

    const stops = [

      {
        t:0,
        r:255,
        g:247,
        b:0
      },

      {
        t:1,
        r:255,
        g:230,
        b:0
      },

      {
        t:3,
        r:255,
        g:190,
        b:0
      },

      {
        t:5,
        r:255,
        g:135,
        b:0
      },

      {
        t:8,
        r:255,
        g:80,
        b:0
      },

      {
        t:10,
        r:255,
        g:35,
        b:0
      },

      {
        t:15,
        r:255,
        g:0,
        b:0
      }

    ];


    if (
      minute <= 0
    ) {

      return "rgb(255,247,0)";

    }


    if (
      minute >= 15
    ) {

      return "rgb(255,0,0)";

    }


    for (
      let i = 0;
      i < stops.length - 1;
      i++
    ) {

      const a =
        stops[i];

      const b =
        stops[i + 1];


      if (
        minute >= a.t &&
        minute <= b.t
      ) {

        const p =
          (minute - a.t) /
          (b.t - a.t);


        const r =
          Math.round(
            a.r +
            (b.r - a.r) * p
          );


        const g =
          Math.round(
            a.g +
            (b.g - a.g) * p
          );


        const blue =
          Math.round(
            a.b +
            (b.b - a.b) * p
          );


        return `
          rgb(
            ${r},
            ${g},
            ${blue}
          )
        `.replace(/\s+/g, " ");

      }

    }


    return "rgb(255,0,0)";
  }


  /*
  ============================================================
  РАЗМЕР
  ============================================================
  */

  function getLightningSize(age) {

    const minute =
      age / 60000;


    if (minute < 1) {
      return 8;
    }

    if (minute < 2) {
      return 7;
    }

    if (minute < 3) {
      return 6;
    }

    if (minute < 4) {
      return 5;
    }

    if (minute < 5) {
      return 4.5;
    }

    if (minute < 6) {
      return 4;
    }

    if (minute < 8) {
      return 3.5;
    }

    if (minute < 10) {
      return 3;
    }

    if (minute < 15) {
      return 2;
    }

    return 0;
  }


  /*
  ============================================================
  КРАСНАЯ ОБВОДКА
  ============================================================

  Красная обводка только у недавних молний.
  */

  function getLightningStroke(age) {

    const minute =
      age / 60000;


    /*
    Первые 3 минуты —
    заметная красная обводка.
    */

    if (minute < 3) {

      return {
        color:"#ff2020",
        weight:2,
        opacity:.95
      };

    }


    /*
    3–5 минут —
    тоньше и менее заметно.
    */

    if (minute < 5) {

      return {
        color:"#ff3b24",
        weight:1.4,
        opacity:.8
      };

    }


    /*
    После 5 минут
    обычная обводка.
    */

    return {
      color:getLightningColor(age),
      weight:1,
      opacity:.9
    };

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

          color:
            stroke.color,

          weight:
            stroke.weight,

          opacity:
            stroke.opacity,

          fillColor:
            getLightningColor(age),

          fillOpacity:1,

          interactive:false

        }
      );


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
      Number.isFinite(data.time)
        ? data.time
        : Date.now();


    const id =
      String(
        data.id ??
        `${data.lat}_${data.lon}_${time}`
      );


    /*
    Не добавляем один и тот же удар
    повторно.
    */

    if (
      strikes.has(id)
    ) {
      return;
    }


    const strike = {

      id:id,

      lat:data.lat,

      lon:data.lon,

      time:time,

      marker:null,

      lastSize:null,

      lastColor:null,

      lastStroke:null,

      wave:null

    };


    strikes.set(
      id,
      strike
    );


    /*
    Создаём основную точку.
    */

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
    Волна запускается
    только один раз —
    непосредственно при
    получении нового удара.
    */

    createStrikeWave(
      strike
    );

  }


  /*
  ============================================================
  ВОЛНА
  ============================================================
  */

  function createStrikeWave(strike) {

    if (
      !enabled ||
      !layer
    ) {
      return;
    }


    /*
    Отдельный круг.
    Он не заменяет основную
    молнию.
    */

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


    /*
    Анимация ровно около 1 секунды.
    */

    const start =
      performance.now();


    const duration =
      1000;


    function animateWave(now) {

      /*
      Если слой выключили —
      сразу прекращаем.
      */

      if (
        !enabled ||
        !layer
      ) {

        if (
          layer &&
          layer.hasLayer(wave)
        ) {

          layer.removeLayer(
            wave
          );

        }

        return;

      }


      const progress =
        Math.min(
          1,
          (now - start) /
          duration
        );


      /*
      Плавное расширение.
      */

      const eased =
        1 -
        Math.pow(
          1 - progress,
          3
        );


      /*
      Круг идёт от точки
      наружу.
      */

      const radius =
        2 +
        eased * 24;


      /*
      Постепенно исчезает.
      */

      const opacity =
        1 -
        eased;


      wave.setRadius(
        radius
      );


      wave.setStyle({

        opacity:opacity,

        weight:
          progress < .45
            ? 2
            : 1.5

      });


      if (
        progress < 1
      ) {

        requestAnimationFrame(
          animateWave
        );

      } else {

        if (
          layer.hasLayer(
            wave
          )
        ) {

          layer.removeLayer(
            wave
          );

        }

        strike.wave =
          null;

      }

    }


    requestAnimationFrame(
      animateWave
    );

  }


  /*
  ============================================================
  ОБНОВЛЕНИЕ МОЛНИЙ
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


        /*
        Удаляем старые.
        */

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


        /*
        Не трогаем маркер,
        если его визуальные
        параметры ещё не изменились.
        */

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


        const sizeChanged =
          strike.lastSize !== size;


        const colorChanged =
          strike.lastColor !== color;


        const strokeChanged =
          !strike.lastStroke ||
          strike.lastStroke.color !==
            stroke.color ||
          strike.lastStroke.weight !==
            stroke.weight ||
          strike.lastStroke.opacity !==
            stroke.opacity;


        if (
          sizeChanged ||
          colorChanged ||
          strokeChanged
        ) {

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

      }
    );

  }


  /*
  ============================================================
  ЗАПУСК ОБНОВЛЕНИЯ
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
  LIVE2 — CONNECT
  ============================================================
  */

  function connect(
    myGeneration
  ) {

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
      () => {

        /*
        onclose сам выполнит
        переподключение.
        */

      };


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
        JSON.stringify(
          message
        )
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


    /*
    Формат:

      {
        strokes:[...]
      }
    */

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


    /*
    Иногда приходит массив
    сообщений.
    */

    if (
      Array.isArray(data)
    ) {

      for (
        const item of data
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


    /*
    Прямой strike.
    */

    if (
      typeof data.lat ===
        "number" &&
      typeof data.lon ===
        "number"
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

  function parseStroke(
    stroke
  ) {

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


    /*
    live2 может отдавать
    timestamp в секундах
    или миллисекундах.
    */

    if (
      Number.isFinite(time)
    ) {

      if (
        time <
        100000000000
      ) {

        time *= 1000;

      }

    } else {

      time =
        Date.now();

    }


    /*
    Если сервер прислал
    слишком старое время,
    не даём отрицательный возраст.
    */

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


    /*
    В легенде каждый цвет
    имеет собственный возраст.
    */

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
              --ls:7px;
            "
          ></span>

          <span class="cloradLightningTime">
            10–15 мин
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ff3500;
              --ls:7.5px;
            "
          ></span>

          <span class="cloradLightningTime">
            8–10 мин
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ff6500;
              --ls:8px;
            "
          ></span>

          <span class="cloradLightningTime">
            6–8 мин
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ff9200;
              --ls:8.5px;
            "
          ></span>

          <span class="cloradLightningTime">
            5–6 мин
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ffb000;
              --ls:9px;
            "
          ></span>

          <span class="cloradLightningTime">
            4–5 мин
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ffd000;
              --ls:10px;
            "
          ></span>

          <span class="cloradLightningTime">
            3–4 мин
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#ffe300;
              --ls:11px;
            "
          ></span>

          <span class="cloradLightningTime">
            2–3 мин
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot"
            style="
              --lc:#fff000;
              --ls:12px;
            "
          ></span>

          <span class="cloradLightningTime">
            1–2 мин
          </span>

        </div>


        <div class="cloradLightningScaleItem">

          <span
            class="cloradLightningDot latest"
            style="
              --lc:#fff900;
              --ls:13px;
            "
          ></span>

          <span class="cloradLightningTime">
            0–1 мин
          </span>

        </div>


      </div>

    `;


    document.body.appendChild(
      legend
    );


    /*
    ============================================================
    СТИЛИ ЛЕГЕНДЫ
    ============================================================
    */

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

        width:470px;

        padding:
          9px 13px 8px;

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


      /*
      Заголовок
      */

      #cloradLightningLegend
      .cloradLightningLegendTitle{

        display:flex;

        align-items:center;

        justify-content:center;

        gap:8px;

        height:24px;

        font-size:16px;

        font-weight:700;

        margin-bottom:6px;

      }


      /*
      SVG-молния
      */

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


      /*
      Шкала
      */

      .cloradLightningScale{

        width:100%;

        display:flex;

        align-items:flex-start;

        justify-content:space-between;

        gap:2px;

      }


      /*
      Один цвет + его время
      */

      .cloradLightningScaleItem{

        flex:1;

        min-width:0;

        height:39px;

        display:flex;

        flex-direction:column;

        align-items:center;

        justify-content:flex-start;

      }


      /*
      Цветная точка
      */

      .cloradLightningDot{

        display:block;

        flex:none;

        width:var(--ls);

        height:var(--ls);

        margin-top:2px;

        border-radius:50%;

        background:
          var(--lc);

        border:
          1px solid
          rgba(255,255,255,.18);

        box-sizing:border-box;

        box-shadow:
          0 0 5px
          var(--lc);

      }


      /*
      Самая свежая точка
      */

      .cloradLightningDot.latest{

        border:
          2px solid
          rgba(255,255,255,.9);

        box-shadow:

          0 0 0 2px
          rgba(255,255,255,.18),

          0 0 8px
          rgba(255,235,0,.9);

      }


      /*
      Время под каждым цветом
      */

      .cloradLightningTime{

        margin-top:6px;

        white-space:nowrap;

        color:#dce2e6;

        font-size:8px;

        line-height:10px;

        font-weight:600;

        letter-spacing:.05px;

      }


      /*
      Светлая тема
      */

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
      .cloradLightningTime{

        color:#59636a;

      }


      /*
      Телефон
      */

      @media(max-width:600px){

        #cloradLightningLegend{

          width:
            calc(100vw - 18px);

          bottom:12px;

          padding:
            8px 7px 7px;

        }


        #cloradLightningLegend
        .cloradLightningLegendTitle{

          font-size:14px;

          height:22px;

          margin-bottom:5px;

        }


        .cloradLightningScale{

          gap:0;

        }


        .cloradLightningScaleItem{

          height:36px;

        }


        .cloradLightningTime{

          font-size:7px;

          margin-top:5px;

        }

      }

    `;


    document.head.appendChild(
      style
    );

  }


  /*
  ============================================================
  VIEWPORT EVENTS
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

      /*
      Закрываем WebSocket.
      */

      if (socket) {

        try {
          socket.close();
        } catch {}

      }


      socket =
        null;


      /*
      Убираем слой.
      */

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


    /*
    Возвращаем слой.
    */

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


    /*
    Запускаем обновление.
    */

    startUpdateLoop();


    /*
    Новое соединение.
    */

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


    /*
    Слой.
    */

    layer.addTo(
      window.map
    );


    /*
    Легенда.
    */

    createLightningLegend();


    /*
    Карта.
    */

    setupMapEvents();


    /*
    Обновление.
    */

    startUpdateLoop();


    /*
    WebSocket.
    */

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
