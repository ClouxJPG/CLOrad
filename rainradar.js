/* =========================================================
   CLOrad — RainRadar composite
   ========================================================= */
(() => {
  "use strict";

  const map = window.map;
  if (!map) return;

  const MANIFEST_URL = "/api/rainradar?path=manifest.json";
  const TILE_BASE = "https://rainradar.ru/composite";
  const REFRESH_MS = 5 * 60 * 1000;

  const TRANSPARENT =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

  let layer = null;
  let enabled = false;
  let manifest = null;
  let refreshTimer = null;

  function msg(text) {
    if (typeof window.msg === "function") {
      window.msg(text);
      return;
    }

    console.log("CLOrad RainRadar:", text);
  }

  function parseManifest(data) {
    if (!Array.isArray(data)) {
      throw new Error("RainRadar: неверный manifest");
    }

    const frames = [];

    for (const item of data) {
      if (!Array.isArray(item) || item.length < 2) {
        continue;
      }

      const timestamp = Number(item[0]);
      const groups = item[1];

      if (
        !Number.isFinite(timestamp) ||
        !Array.isArray(groups)
      ) {
        continue;
      }

      const levels = new Map();

      groups.forEach((tiles, index) => {
        const z = 3 + index;
        const set = new Set();

        if (Array.isArray(tiles)) {
          for (const pair of tiles) {
            if (
              !Array.isArray(pair) ||
              pair.length < 2
            ) {
              continue;
            }

            const x = Number(pair[0]);
            const y = Number(pair[1]);

            if (
              Number.isInteger(x) &&
              Number.isInteger(y) &&
              x >= 0 &&
              y >= 0
            ) {
              set.add(x + "_" + y);
            }
          }
        }

        levels.set(z, set);
      });

      frames.push({
        timestamp,
        levels
      });
    }

    frames.sort(
      (a, b) =>
        a.timestamp - b.timestamp
    );

    if (!frames.length) {
      throw new Error(
        "RainRadar: manifest пуст"
      );
    }

    return frames;
  }

  function removeLayer() {
    if (layer) {
      map.removeLayer(layer);
      layer = null;
    }
  }

  function createLayer(frame) {
    return L.tileLayer(
      TILE_BASE +
        "/" +
        frame.timestamp +
        "/{z}/{x}_{y}.png",
      {
        tileSize: 256,

        minZoom: 2,
        maxZoom: 14,

        minNativeZoom: 3,
        maxNativeZoom: 5,

        bounds: [
          [31.5, -46],
          [77.5, 90]
        ],

        noWrap: true,

        opacity: 1,

        zIndex: 8,

        updateWhenIdle: true,
        updateWhenZooming: false,

        keepBuffer: 1,

        errorTileUrl:
          TRANSPARENT,

        attribution:
          "RainRadar"
      }
    );
  }

  function showLatest() {
    if (
      !enabled ||
      !manifest?.length
    ) {
      return;
    }

    const latest =
      manifest[
        manifest.length - 1
      ];

    removeLayer();

    layer =
      createLayer(latest);

    layer.addTo(map);
  }

  async function loadManifest(
    showMessage
  ) {
    try {
      const response =
        await fetch(
          MANIFEST_URL +
            "&t=" +
            Date.now(),
          {
            cache: "no-store"
          }
        );

      if (!response.ok) {
        throw new Error(
          "RainRadar manifest HTTP " +
          response.status
        );
      }

      manifest =
        parseManifest(
          await response.json()
        );

      if (enabled) {
        showLatest();
      }

      if (showMessage) {
        const d =
          new Date(
            manifest[
              manifest.length - 1
            ].timestamp * 1000
          );

        msg(
          "RainRadar: " +
          d.toLocaleTimeString(
            "ru-RU",
            {
              hour: "2-digit",
              minute: "2-digit"
            }
          )
        );
      }
    } catch (error) {
      console.error(
        "CLOrad RainRadar:",
        error
      );

      if (showMessage) {
        msg(
          error?.message ||
          "RainRadar: ошибка"
        );
      }
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);

    if (!enabled) {
      removeLayer();
      return;
    }

    if (manifest?.length) {
      showLatest();
    } else {
      loadManifest(true);
    }
  }

  const button =
    document.getElementById(
      "rainradarSwitch"
    );

  if (button) {
    button.addEventListener(
      "pointerdown",
      event => {
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        const next =
          !button.classList.contains(
            "on"
          );

        button.classList.toggle(
          "on",
          next
        );

        setEnabled(next);

        msg(
          next
            ? "RainRadar включён"
            : "RainRadar выключен"
        );
      },
      true
    );
  }

  window.CLOradRainRadar = {
    enable: () => {
      if (button) {
        button.classList.add("on");
      }

      setEnabled(true);
    },

    disable: () => {
      if (button) {
        button.classList.remove("on");
      }

      setEnabled(false);
    },

    refresh: () =>
      loadManifest(false),

    active: () =>
      enabled
  };

  loadManifest(false);

  refreshTimer =
    setInterval(
      () => {
        if (enabled) {
          loadManifest(false);
        }
      },
      REFRESH_MS
    );

  window.addEventListener(
    "beforeunload",
    () =>
      clearInterval(
        refreshTimer
      ),
    {
      once: true
    }
  );
})();
