/* =========================================================
   CLOrad — Lightning
   Источник: Blitzortung.org
   ========================================================= */

(() => {

  "use strict";

  const SERVERS = [1, 5, 6, 7].map(
    n => `wss://ws${n}.blitzortung.org:3000/`
  );

  const LIFETIME = 15 * 60 * 1000;
  const UPDATE_INTERVAL = 3000;
  const RECONNECT_DELAY = 5000;

  let layer = null;
  let socket = null;
  let reconnectTimer = null;

  let enabled = false;

  const strikes = [];


  /* =======================================================
     Получение карты
     ======================================================= */

  function getMap(){

    if(
      typeof window.map !== "undefined" &&
      window.map
    ){
      return window.map;
    }

    console.error(
      "[CLOrad Lightning] map не найден."
    );

    return null;
  }


  /* =======================================================
     Создание слоя
     ======================================================= */

  function createLayer(){

    if(layer){
      return;
    }

    const map = getMap();

    if(!map){
      return;
    }

    layer = L.layerGroup();

  }


  /* =======================================================
     Цвет удара
     ======================================================= */

  function strikeColor(age){

    if(age < 10_000){
      return "#ffffff";
    }

    if(age < 60_000){
      return "#ffff00";
    }

    if(age < 180_000){
      return "#ffa500";
    }

    if(age < 300_000){
      return "#ff4500";
    }

    if(age < 600_000){
      return "#ff0000";
    }

    return "#8b0000";

  }


  /* =======================================================
     Добавление удара
     ======================================================= */

  function addStrike(data){

    if(!enabled){
      return;
    }

    const map = getMap();

    if(!map){
      return;
    }

    if(
      typeof data.lat !== "number" ||
      typeof data.lon !== "number" ||
      typeof data.time !== "number"
    ){
      return;
    }

    const timeMs =
      Math.floor(data.time / 1e6);

    if(!Number.isFinite(timeMs)){
      return;
    }

    const lat =
      data.lat;

    const lon =
      data.lon;

    const latlng =
      [lat,lon];


    /*
       Не рисуем мировые удары,
       которые далеко за пределами
       текущего экрана.
    */

    if(
      !map
        .getBounds()
        .pad(0.5)
        .contains(latlng)
    ){
      return;
    }


    /*
       Защита от дублей.
    */

    const duplicate =
      strikes.some(
        strike =>
          Math.abs(strike.lat - lat) < 0.0001 &&
          Math.abs(strike.lon - lon) < 0.0001 &&
          Math.abs(strike.time - timeMs) < 1000
      );

    if(duplicate){
      return;
    }


    const marker =
      L.circleMarker(
        latlng,
        {
          radius:5.5,
          color:"#ffffff",
          weight:1,
          opacity:1,
          fillColor:strikeColor(0),
          fillOpacity:0.95
        }
      );


    marker.bindPopup(() => {

      const ageSec =
        Math.max(
          0,
          Math.round(
            (Date.now() - timeMs) / 1000
          )
        );

      const ageText =
        ageSec < 60
          ? `${ageSec} сек назад`
          : `${Math.round(ageSec / 60)} мин назад`;


      return `
        <div style="min-width:180px">
          <b>⚡ Удар молнии</b><br>
          Время: ${new Date(timeMs).toLocaleTimeString()}<br>
          (${ageText})<br>
          Координаты: ${lat.toFixed(3)}, ${lon.toFixed(3)}
        </div>
      `;

    });


    marker.addTo(layer);


    strikes.push({
      marker,
      time:timeMs,
      lat,
      lon
    });

  }


  /* =======================================================
     Очистка старых ударов
     ======================================================= */

  function updateStrikes(){

    const now =
      Date.now();


    for(
      let i = strikes.length - 1;
      i >= 0;
      i--
    ){

      const strike =
        strikes[i];

      const age =
        now - strike.time;


      if(
        age > LIFETIME
      ){

        layer.removeLayer(
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
          strikeColor(age),

        fillOpacity:
          Math.max(
            0.12,
            0.95 - age / LIFETIME
          )

      });

    }

  }


  /* =======================================================
     Очистить все удары
     ======================================================= */

  function clearStrikes(){

    if(layer){
      layer.clearLayers();
    }

    strikes.length = 0;

  }


  /* =======================================================
     Подключение
     ======================================================= */

  function connect(){

    if(!enabled){
      return;
    }


    if(
      socket &&
      (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      )
    ){
      return;
    }


    const url =
      SERVERS[
        Math.floor(
          Math.random() * SERVERS.length
        )
      ];


    console.log(
      "[CLOrad Lightning] Подключение:",
      url
    );


    try{

      socket =
        new WebSocket(url);

    }catch(error){

      console.error(
        "[CLOrad Lightning] WebSocket:",
        error
      );

      scheduleReconnect();

      return;

    }


    socket.onopen = () => {

      console.log(
        "[CLOrad Lightning] Подключено."
      );


      try{

        socket.send(
          JSON.stringify({
            time:0
          })
        );

      }catch(error){

        console.error(
          "[CLOrad Lightning] Handshake:",
          error
        );

      }

    };


    socket.onmessage =
      event => {

        if(!enabled){
          return;
        }


        try{

          const data =
            JSON.parse(
              event.data
            );


          if(
            data &&
            typeof data.lat === "number" &&
            typeof data.lon === "number"
          ){

            addStrike(data);

          }

        }catch{

          // Битый пакет игнорируем.

        }

      };


    socket.onerror =
      error => {

        console.warn(
          "[CLOrad Lightning] Ошибка WebSocket.",
          error
        );


        try{
          socket.close();
        }catch{}

      };


    socket.onclose =
      () => {

        console.log(
          "[CLOrad Lightning] Соединение закрыто."
        );


        socket = null;


        if(enabled){
          scheduleReconnect();
        }

      };

  }


  /* =======================================================
     Переподключение
     ======================================================= */

  function scheduleReconnect(){

    if(!enabled){
      return;
    }


    clearTimeout(
      reconnectTimer
    );


    reconnectTimer =
      setTimeout(
        () => {

          reconnectTimer = null;

          if(enabled){
            connect();
          }

        },
        RECONNECT_DELAY
      );

  }


  /* =======================================================
     Отключение
     ======================================================= */

  function disconnect(){

    clearTimeout(
      reconnectTimer
    );

    reconnectTimer = null;


    if(socket){

      try{

        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;

        socket.close();

      }catch{}

      socket = null;

    }

  }


  /* =======================================================
     Включение
     ======================================================= */

  function enable(){

    const map =
      getMap();

    if(!map){
      return;
    }


    createLayer();

    if(!layer){
      return;
    }


    enabled = true;


    if(
      !map.hasLayer(layer)
    ){

      layer.addTo(map);

    }


    connect();


    console.log(
      "[CLOrad Lightning] Включено."
    );

  }


  /* =======================================================
     Выключение
     ======================================================= */

  function disable(){

    enabled = false;


    disconnect();


    clearStrikes();


    const map =
      getMap();


    if(
      map &&
      layer &&
      map.hasLayer(layer)
    ){

      map.removeLayer(
        layer
      );

    }


    console.log(
      "[CLOrad Lightning] Выключено."
    );

  }


  /* =======================================================
     Управление
     ======================================================= */

  function setEnabled(state){

    if(state){
      enable();
    }else{
      disable();
    }

  }


  /* =======================================================
     Обновление каждые 3 секунды
     ======================================================= */

  setInterval(
    updateStrikes,
    UPDATE_INTERVAL
  );


  /* =======================================================
     API для index.html
     ======================================================= */

  window.CLOradLightning = {

    enable,

    disable,

    setEnabled,

    toggle(){

      setEnabled(
        !enabled
      );

    },

    isEnabled(){

      return enabled;

    },

    clear(){

      clearStrikes();

    }

  };


  console.log(
    "[CLOrad Lightning] Модуль загружен."
  );

})();
