/* =========================================================
   CLOrad — RainRadar
   Реальный радарный композит RainRadar.ru

   Источник:
   https://rainradar.ru/composite/

   Структура:
   /composite/{timestamp}/{z}/{x}_{y}.png

   Manifest:
   /composite/manifest.json

   Кнопка RainRadar создаётся этим файлом самостоятельно.
   index.html менять не требуется.
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const ROOT =
    "https://rainradar.ru/composite/";

  const MANIFEST_URL =
    ROOT + "manifest.json";

  /*
   * Резервный путь через Vercel API.
   * Если API существует — он будет использован,
   * если прямой manifest недоступен из браузера.
   */
  const PROXY_MANIFEST =
    "/api/rainradar?path=manifest.json";

  /*
   * RainRadar использует тайлы с именами:
   *
   *   1_1.png
   *   3_1.png
   *   10_4.png
   *
   * Группы manifest соответствуют zoom 3, 4 и 5.
   */
  const MIN_ZOOM =
    3;

  const MAX_ZOOM =
    5;

  /*
   * Не даём RainRadar занимать весь мир.
   * Россия + Беларусь + соседние области.
   */
  const RAINRADAR_BOUNDS =
    [
      [35, 15],
      [72, 180]
    ];

  /* =======================================================
     STATE
     ======================================================= */

  let rainRadarLayer =
    null;

  let rainRadarActive =
    false;

  let rainRadarLoading =
    false;

  let rainRadarManifest =
    null;

  let rainRadarTimestamp =
    null;

  let rainRadarTiles =
    new Map();

  let rainRadarButton =
    null;

  let rainRadarSwitch =
    null;

  let rainRadarLabel =
    null;

  /* =======================================================
     HELPERS
     ======================================================= */

  function $(id) {
    return document.getElementById(id);
  }

  function showMessage(text) {
    if (
      typeof window.msg ===
      "function"
    ) {
      window.msg(text);
      return;
    }

    console.log(
      "CLOrad RainRadar:",
      text
    );
  }

  function getLayersPanel() {
    return (
      $("layers") ||
      document.querySelector(
        ".layers"
      )
    );
  }

  /* =======================================================
     CREATE BUTTON
     ======================================================= */

  function createRainRadarButton() {
    if (
      rainRadarButton &&
      document.body.contains(
        rainRadarButton
      )
    ) {
      return;
    }

    const layers =
      getLayersPanel();

    if (!layers) {
      /*
       * index.html может ещё не успеть
       * создать панель слоёв.
       */
      setTimeout(
        createRainRadarButton,
        100
      );

      return;
    }

    /*
     * Если кнопка уже каким-либо образом
     * присутствует в HTML — используем её.
     */
    const existingSwitch =
      $("rainradarSwitch");

    if (existingSwitch) {
      rainRadarSwitch =
        existingSwitch;

      rainRadarButton =
        existingSwitch.closest(
          ".layer"
        );

      if (rainRadarButton) {
        const span =
          rainRadarButton.querySelector(
            "span"
          );

        if (span) {
          rainRadarLabel =
            span;
        }
      }

      bindRainRadarSwitch();

      return;
    }

    /*
     * Создаём полностью самостоятельный
     * элемент слоя.
     */
    const layer =
      document.createElement(
        "div"
      );

    layer.className =
      "layer";

    layer.id =
      "rainradarLayer";

    layer.innerHTML = `
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="8"
        />
        <path
          d="M4 12h16"
        />
        <path
          d="M12 4v16"
        />
      </svg>

      <span>
        RainRadar
      </span>

      <button
        class="switch"
        id="rainradarSwitch"
        type="button"
        aria-label="RainRadar"
        aria-pressed="false"
      >
        <i></i>
      </button>
    `;

    /*
     * Ставим RainRadar перед последним
     * существующим слоем.
     *
     * Обычно последним является "Молнии".
     */
    const lightning =
      $("lightningSwitch");

    if (
      lightning &&
      lightning.closest(
        ".layer"
      )
    ) {
      layers.insertBefore(
        layer,
        lightning.closest(
          ".layer"
        )
      );
    } else {
      layers.appendChild(
        layer
      );
    }

    rainRadarButton =
      layer;

    rainRadarSwitch =
      $("rainradarSwitch");

    rainRadarLabel =
      layer.querySelector(
        "span"
      );

    bindRainRadarSwitch();

    /*
     * Чтобы layers-fix.js и другие
     * обработчики не скрывали новый элемент.
     */
    layer.style.pointerEvents =
      "auto";

    rainRadarSwitch.style.pointerEvents =
      "auto";
  }

  /* =======================================================
     SWITCH
     ======================================================= */

  function bindRainRadarSwitch() {
    if (
      !rainRadarSwitch ||
      rainRadarSwitch.dataset.bound ===
      "1"
    ) {
      return;
    }

    rainRadarSwitch.dataset.bound =
      "1";

    rainRadarSwitch.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        toggleRainRadar();
      },
      {
        passive:false
      }
    );

    updateButton();
  }

  function updateButton() {
    if (!rainRadarSwitch) {
      return;
    }

    rainRadarSwitch.classList.toggle(
      "on",
      rainRadarActive
    );

    rainRadarSwitch.setAttribute(
      "aria-pressed",
      rainRadarActive
        ? "true"
        : "false"
    );

    if (
      rainRadarLabel
    ) {
      rainRadarLabel.textContent =
        rainRadarLoading
          ? "RainRadar…"
          : "RainRadar";
    }
  }

  /* =======================================================
     MANIFEST
     ======================================================= */

  async function fetchManifest(url) {
    const response =
      await fetch(
        url,
        {
          method:"GET",
          cache:"no-store",
          mode:"cors",
          headers:{
            Accept:
              "application/json"
          }
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        "HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    if (
      !Array.isArray(data)
    ) {
      throw new Error(
        "Manifest имеет неверный формат"
      );
    }

    return data;
  }

  async function loadManifest() {
    /*
     * Сначала пытаемся получить manifest
     * непосредственно с RainRadar.
     */
    try {
      return await fetchManifest(
        MANIFEST_URL
      );
    } catch (
      directError
    ) {
      console.warn(
        "RainRadar direct manifest:",
        directError
      );
    }

    /*
     * Затем пробуем Vercel API.
     */
    try {
      return await fetchManifest(
        PROXY_MANIFEST
      );
    } catch (
      proxyError
    ) {
      console.warn(
        "RainRadar proxy manifest:",
        proxyError
      );
    }

    throw new Error(
      "Не удалось загрузить manifest RainRadar"
    );
  }

  /* =======================================================
     PARSE MANIFEST
     ======================================================= */

  function parseManifest(data) {
    /*
     * Формат RainRadar:
     *
     * [
     *   [
     *     timestamp,
     *     [
     *       [[x,y], ...],
     *       [[x,y], ...],
     *       [[x,y], ...]
     *     ]
     *   ],
     *   ...
     * ]
     */

    if (
      !Array.isArray(data)
    ) {
      throw new Error(
        "Manifest не является массивом"
      );
    }

    /*
     * Самый первый элемент —
     * самый свежий кадр в текущем
     * manifest RainRadar.
     *
     * Дополнительно сортируем по timestamp,
     * чтобы не зависеть от порядка.
     */
    const entries =
      data
        .filter(
          entry =>
            Array.isArray(entry) &&
            Number.isFinite(
              Number(entry[0])
            ) &&
            Array.isArray(
              entry[1]
            )
        )
        .map(
          entry => ({
            timestamp:
              Number(entry[0]),
            groups:
              entry[1]
          })
        )
        .sort(
          (a,b) =>
            b.timestamp -
            a.timestamp
        );

    if (
      !entries.length
    ) {
      throw new Error(
        "В manifest нет кадров"
      );
    }

    const latest =
      entries[0];

    const tiles =
      new Map();

    /*
     * Группы:
     *
     * index 0 -> z3
     * index 1 -> z4
     * index 2 -> z5
     */
    latest.groups.forEach(
      (
        group,
        groupIndex
      ) => {
        const z =
          MIN_ZOOM +
          groupIndex;

        if (
          z >
          MAX_ZOOM
        ) {
          return;
        }

        if (
          !Array.isArray(
            group
          )
        ) {
          return;
        }

        const set =
          new Set();

        group.forEach(
          tile => {
            if (
              !Array.isArray(
                tile
              ) ||
              tile.length <
              2
            ) {
              return;
            }

            const x =
              Number(
                tile[0]
              );

            const y =
              Number(
                tile[1]
              );

            if (
              !Number.isInteger(
                x
              ) ||
              !Number.isInteger(
                y
              )
            ) {
              return;
            }

            set.add(
              x +
              "_" +
              y
            );
          }
        );

        tiles.set(
          z,
          set
        );
      }
    );

    return {
      timestamp:
        latest.timestamp,

      tiles
    };
  }

  /* =======================================================
     TILE LAYER
     ======================================================= */

  const RainRadarTileLayer =
    L.TileLayer.extend({

      initialize:
        function(
          timestamp,
          tileMap,
          options
        ) {
          this._rainTimestamp =
            timestamp;

          this._rainTileMap =
            tileMap;

          L.TileLayer.prototype.initialize.call(
            this,

            ROOT +
            timestamp +
            "/{z}/{x}_{y}.png",

            options
          );
        },

      createTile:
        function(
          coords,
          done
        ) {
          const tile =
            document.createElement(
              "img"
            );

          const z =
            coords.z;

          const x =
            coords.x;

          const y =
            coords.y;

          /*
           * Не даём Leaflet запрашивать
           * тайлы, которых нет в manifest.
           */
          const available =
            this._rainTileMap.get(
              z
            );

          const key =
            x +
            "_" +
            y;

          if (
            available &&
            !available.has(
              key
            )
          ) {
            tile.style.display =
              "none";

            setTimeout(
              () => {
                done(
                  null,
                  tile
                );
              },
              0
            );

            return tile;
          }

          tile.alt =
            "";

          tile.setAttribute(
            "role",
            "presentation"
          );

          tile.decoding =
            "async";

          tile.crossOrigin =
            "anonymous";

          tile.onload =
            () => {
              done(
                null,
                tile
              );
            };

          tile.onerror =
            error => {
              /*
               * Ошибка отдельного тайла
               * не должна ломать весь слой.
               */
              tile.style.display =
                "none";

              done(
                null,
                tile
              );
            };

          tile.src =
            this.getTileUrl(
              coords
            );

          return tile;
        },

      getTileUrl:
        function(
          coords
        ) {
          return (
            ROOT +
            this._rainTimestamp +
            "/" +
            coords.z +
            "/" +
            coords.x +
            "_" +
            coords.y +
            ".png"
          );
        }
    });

  /* =======================================================
     CREATE LAYER
     ======================================================= */

  function createRainRadarLayer() {
    if (
      !window.map
    ) {
      throw new Error(
        "Leaflet map не найден"
      );
    }

    if (
      rainRadarLayer
    ) {
      try {
        window.map.removeLayer(
          rainRadarLayer
        );
      } catch {}

      rainRadarLayer =
        null;
    }

    rainRadarLayer =
      new RainRadarTileLayer(
        rainRadarTimestamp,
        rainRadarTiles,
        {
          minZoom:
            MIN_ZOOM,

          maxZoom:
            MAX_ZOOM,

          minNativeZoom:
            MIN_ZOOM,

          maxNativeZoom:
            MAX_ZOOM,

          opacity:1,

          zIndex:6,

          noWrap:true,

          bounds:
            RAINRADAR_BOUNDS,

          updateWhenIdle:true,

          updateWhenZooming:false,

          keepBuffer:2,

          crossOrigin:true,

          className:
            "clorad-rainradar-layer"
        }
      );

    return rainRadarLayer;
  }

  /* =======================================================
     LOAD RAINRADAR
     ======================================================= */

  async function enableRainRadar() {
    if (
      rainRadarLoading
    ) {
      return;
    }

    if (
      !window.map
    ) {
      showMessage(
        "Карта ещё не готова"
      );

      return;
    }

    rainRadarLoading =
      true;

    updateButton();

    try {
      /*
       * Загружаем manifest только
       * при первом включении.
       */
      if (
        !rainRadarManifest
      ) {
        rainRadarManifest =
          await loadManifest();
      }

      const parsed =
        parseManifest(
          rainRadarManifest
        );

      rainRadarTimestamp =
        parsed.timestamp;

      rainRadarTiles =
        parsed.tiles;

      /*
       * Создаём новый слой.
       */
      createRainRadarLayer();

      /*
       * Добавляем слой на карту.
       */
      rainRadarLayer.addTo(
        window.map
      );

      /*
       * RainRadar должен быть поверх
       * базовой карты, но не перекрывать
       * интерфейс.
       */
      try {
        rainRadarLayer.bringToFront();
      } catch {}

      rainRadarActive =
        true;

      /*
       * Уведомляем другие части CLOrad,
       * если они используют глобальный API.
       */
      window.CLOradRainRadarActive =
        true;

      showMessage(
        "RainRadar включён"
      );

    } catch (
      error
    ) {
      console.error(
        "CLOrad RainRadar:",
        error
      );

      rainRadarActive =
        false;

      window.CLOradRainRadarActive =
        false;

      if (
        rainRadarLayer
      ) {
        try {
          window.map.removeLayer(
            rainRadarLayer
          );
        } catch {}

        rainRadarLayer =
          null;
      }

      showMessage(
        "RainRadar: ошибка загрузки"
      );

    } finally {
      rainRadarLoading =
        false;

      updateButton();
    }
  }

  /* =======================================================
     DISABLE
     ======================================================= */

  function disableRainRadar() {
    rainRadarActive =
      false;

    window.CLOradRainRadarActive =
      false;

    if (
      rainRadarLayer &&
      window.map &&
      window.map.hasLayer(
        rainRadarLayer
      )
    ) {
      window.map.removeLayer(
        rainRadarLayer
      );
    }

    updateButton();

    showMessage(
      "RainRadar выключен"
    );
  }

  /* =======================================================
     TOGGLE
     ======================================================= */

  async function toggleRainRadar() {
    if (
      rainRadarActive
    ) {
      disableRainRadar();

      return;
    }

    await enableRainRadar();
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRainRadar = {

    enable:
      enableRainRadar,

    disable:
      disableRainRadar,

    toggle:
      toggleRainRadar,

    reload:
      async function() {
        rainRadarManifest =
          null;

        rainRadarTimestamp =
          null;

        rainRadarTiles =
          new Map();

        if (
          rainRadarActive
        ) {
          if (
            rainRadarLayer &&
            window.map
          ) {
            try {
              window.map.removeLayer(
                rainRadarLayer
              );
            } catch {}
          }

          rainRadarLayer =
            null;

          rainRadarActive =
            false;

          await enableRainRadar();

        } else {
          showMessage(
            "RainRadar обновлён"
          );
        }
      },

    isActive:
      function() {
        return rainRadarActive;
      },

    getTimestamp:
      function() {
        return rainRadarTimestamp;
      }
  };

  window.CLOradRainRadarActive =
    false;

  /* =======================================================
     INITIALIZATION
     ======================================================= */

  function initRainRadar() {
    createRainRadarButton();

    /*
     * Следующая попытка нужна для случаев,
     * когда layers создаётся чуть позже.
     */
    setTimeout(
      createRainRadarButton,
      250
    );

    setTimeout(
      createRainRadarButton,
      1000
    );
  }

  /*
   * Если карта уже существует —
   * запускаем сразу.
   */
  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initRainRadar,
      {
        once:true
      }
    );
  } else {
    initRainRadar();
  }

})();
