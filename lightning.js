/* =========================================================
   CLOrad — Lightning layer
   Источник: Blitzortung.org
   ========================================================= */

(() => {
  "use strict";

  // -------------------------------------------------------
  // Настройки
  // -------------------------------------------------------

  const LIGHTNING_SERVERS = [1, 5, 6, 7].map(
    n => `wss://ws${n}.blitzortung.org:3000/`
  );

  // Сколько времени удар находится на карте
  const STRIKE_LIFETIME_MS = 15 * 60 * 1000;

  // Как часто обновлять цвет/прозрачность ударов
  const UPDATE_INTERVAL_MS = 3000;

  // Через сколько пытаться подключиться снова
  const RECONNECT_DELAY_MS = 5000;

  // -------------------------------------------------------
  // Состояние
  // -------------------------------------------------------

  let lightningLayer = null;
  let lightningSocket = null;
  let lightningReconnectTimer = null;
  let cleanupTimer = null;

  let enabled = false;

  // { marker, time, lat, lon }
  const strikes = [];

  // -------------------------------------------------------
  // Проверка Leaflet / карты
  // -------------------------------------------------------

  function getMap() {
    if (typeof window.map !== "undefined" && window.map) {
      return window.map;
    }

    console.error("[CLOrad Lightning] Карта Leaflet не найдена.");
    return null;
  }

  // -------------------------------------------------------
  // Цвет молнии в зависимости от возраста
  // -------------------------------------------------------

  function strikeColor(ageMs) {
    if (ageMs < 10_000)  return "#ffffff"; // 0–10 сек
    if (ageMs < 60_000)  return "#ffff00"; // 10–60 сек
    if (ageMs < 180_000) return "#ffa500"; // 1–3 мин
    if (ageMs < 300_000) return "#ff4500"; // 3–5 мин
    if (ageMs < 600_000) return "#ff0000"; // 5–10 мин

    return "#8b0000"; // 10–15 мин
  }

  // -------------------------------------------------------
  // Создание слоя
  // -------------------------------------------------------

  function createLayer() {
    if (lightningLayer) return;

    const map = getMap();
    if (!map) return;

    lightningLayer = L.layerGroup();
  }

  // -------------------------------------------------------
  // Добавление удара
  // -------------------------------------------------------

  function addStrike(data) {
    if (!enabled) return;

    const map = getMap();
    if (!map) return;

    if (
      typeof data.lat !== "number" ||
      typeof data.lon !== "number"
    ) {
      return;
    }

    // Blitzortung передаёт время в наносекундах.
    const timeMs = Math.floor(data.time / 1e6);

    if (!Number.isFinite(timeMs)) return;

    const lat = data.lat;
    const lon = data.lon;

    // Не показываем точки слишком далеко от текущего экрана.
    const latlng = [lat, lon];

    if (!map.getBounds().pad(0.5).contains(latlng)) {
      return;
    }

    // Защита от случайных дублей.
    const duplicate = strikes.some(
      s =>
        Math.abs(s.lat - lat) < 0.0001 &&
        Math.abs(s.lon - lon) < 0.0001 &&
        Math.abs(s.time - timeMs) < 1000
    );

    if (duplicate) return;

    const marker = L.circleMarker(latlng, {
      radius: 5.5,
      color: "#ffffff",
      weight: 1,
      opacity: 1,
      fillColor: strikeColor(0),
      fillOpacity: 0.95,
      interactive: true
    });

    marker.bindPopup(() => {
      const ageSec = Math.max(
        0,
        Math.round((Date.now() - timeMs) / 1000)
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

    lightningLayer.addLayer(marker);

    strikes.push({
      marker,
      time: timeMs,
      lat,
      lon
    });
  }

  // -------------------------------------------------------
  // Обновление существующих ударов
  // -------------------------------------------------------

  function updateStrikes() {
    const now = Date.now();

    for (let i = strikes.length - 1; i >= 0; i--) {
      const strike = strikes[i];

      const age = now - strike.time;

      // Старше 15 минут — удаляем.
      if (age > STRIKE_LIFETIME_MS) {
        if (lightningLayer) {
          lightningLayer.removeLayer(strike.marker);
        }

        strikes.splice(i, 1);
        continue;
      }

      // Плавно меняем цвет и прозрачность.
      strike.marker.setStyle({
        fillColor: strikeColor(age),
        fillOpacity: Math.max(
          0.12,
          0.95 - age / STRIKE_LIFETIME_MS
        )
      });
    }
  }

  // -------------------------------------------------------
  // Очистка всех ударов
  // -------------------------------------------------------

  function clearStrikes() {
    if (lightningLayer) {
      lightningLayer.clearLayers();
    }

    strikes.length = 0;
  }

  // -------------------------------------------------------
  // Подключение WebSocket
  // -------------------------------------------------------

  function connectLightning() {
    if (!enabled) return;

    // Если уже подключены — ничего не делаем.
    if (
      lightningSocket &&
      (
        lightningSocket.readyState === WebSocket.OPEN ||
        lightningSocket.readyState === WebSocket.CONNECTING
      )
    ) {
      return;
    }

    const url =
      LIGHTNING_SERVERS[
        Math.floor(Math.random() * LIGHTNING_SERVERS.length)
      ];

    console.log(
      "[CLOrad Lightning] Подключение:",
      url
    );

    try {
      lightningSocket = new WebSocket(url);
    } catch (error) {
      console.error(
        "[CLOrad Lightning] Ошибка создания WebSocket:",
        error
      );

      scheduleReconnect();
      return;
    }

    lightningSocket.onopen = () => {
      console.log(
        "[CLOrad Lightning] WebSocket подключён."
      );

      // Handshake Blitzortung.
      try {
        lightningSocket.send(
          JSON.stringify({ time: 0 })
        );
      } catch (error) {
        console.error(
          "[CLOrad Lightning] Ошибка handshake:",
          error
        );
      }
    };

    lightningSocket.onmessage = event => {
      if (!enabled) return;

      try {
        const data = JSON.parse(event.data);

        if (
          data &&
          typeof data.lat === "number" &&
          typeof data.lon === "number"
        ) {
          addStrike(data);
        }
      } catch {
        // Игнорируем некорректные пакеты.
      }
    };

    lightningSocket.onerror = error => {
      console.warn(
        "[CLOrad Lightning] Ошибка WebSocket.",
        error
      );

      try {
        lightningSocket.close();
      } catch {}
    };

    lightningSocket.onclose = () => {
      console.log(
        "[CLOrad Lightning] WebSocket отключён."
      );

      lightningSocket = null;

      if (enabled) {
        scheduleReconnect();
      }
    };
  }

  // -------------------------------------------------------
  // Повторное подключение
  // -------------------------------------------------------

  function scheduleReconnect() {
    if (!enabled) return;

    clearTimeout(lightningReconnectTimer);

    lightningReconnectTimer = setTimeout(() => {
      lightningReconnectTimer = null;

      if (enabled) {
        connectLightning();
      }
    }, RECONNECT_DELAY_MS);
  }

  // -------------------------------------------------------
  // Отключение WebSocket
  // -------------------------------------------------------

  function disconnectLightning() {
    clearTimeout(lightningReconnectTimer);
    lightningReconnectTimer = null;

    if (lightningSocket) {
      try {
        lightningSocket.onopen = null;
        lightningSocket.onmessage = null;
        lightningSocket.onerror = null;
        lightningSocket.onclose = null;

        lightningSocket.close();
      } catch {}

      lightningSocket = null;
    }
  }

  // -------------------------------------------------------
  // Включение слоя
  // -------------------------------------------------------

  function enableLightning() {
    const map = getMap();
    if (!map) return;

    createLayer();

    if (!lightningLayer) return;

    enabled = true;

    if (!map.hasLayer(lightningLayer)) {
      lightningLayer.addTo(map);
    }

    connectLightning();

    console.log("[CLOrad Lightning] Слой включён.");
  }

  // -------------------------------------------------------
  // Выключение слоя
  // -------------------------------------------------------

  function disableLightning() {
    enabled = false;

    disconnectLightning();
    clearStrikes();

    const map = getMap();

    if (
      map &&
      lightningLayer &&
      map.hasLayer(lightningLayer)
    ) {
      map.removeLayer(lightningLayer);
    }

    console.log("[CLOrad Lightning] Слой выключен.");
  }

  // -------------------------------------------------------
  // Переключатель
  // -------------------------------------------------------

  function setLightningEnabled(state) {
    if (state) {
      enableLightning();
    } else {
      disableLightning();
    }
  }

  // -------------------------------------------------------
  // Автоматическое обновление ударов
  // -------------------------------------------------------

  cleanupTimer = setInterval(
    updateStrikes,
    UPDATE_INTERVAL_MS
  );

  // -------------------------------------------------------
  // Экспорт API
  // -------------------------------------------------------

  window.CLOradLightning = {
    enable: enableLightning,
    disable: disableLightning,
    toggle: () => {
      setLightningEnabled(!enabled);
    },
    setEnabled: setLightningEnabled,
    isEnabled: () => enabled,
    clear: clearStrikes
  };

  console.log(
    "[CLOrad Lightning] Модуль загружен."
  );

})();
