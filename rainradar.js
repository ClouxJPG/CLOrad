/* =========================================================
   CLOrad — RainRadar Russia Composite
   Полный rainradar.js
   index.html НЕ ИЗМЕНЯЕТСЯ.

   Фиксы:
   - без fade/transition при смене кадров
   - старый кадр остаётся видимым до полной готовности нового
   - новый и старый кадр не видны одновременно после переключения
   - нет пустого промежутка между кадрами
   - дата/время под таймлайном скрыты
   - накрутка 1..30, default 23
   ========================================================= */

(() => {
  "use strict";

  const API = "/api/rainradar";

  const RR_BOUNDS = [[35, 15], [72, 180]];
  const MIN_ZOOM = 3;
  const MIN_NATIVE_ZOOM = 3;
  const MAX_NATIVE_ZOOM = 5;
  const MAX_ZOOM = 14;
  const REFRESH_TIME = 60000;

  const BOOST_MIN = 1;
  const BOOST_MAX = 30;
  const BOOST_DEFAULT = 23;
  const BOOST_STORAGE_KEY = "clorad_rainradar_boost";

  const PALETTE = [
    "#dadada","#e4e4e4","#c0c0c0","#c9dced","#e3fdbe",
    "#a3fb83","#6ebff7","#5880f7","#4d4cd4","#4b4c9f",
    "#fffe6e","#f1a75c","#ed7e77","#eb5a55","#98e364",
    "#6fbf5c","#e459f0","#b454f4","#91504e"
  ];

  const LABELS = [
    "empty","-30 dBZ","-10 dBZ","-5 dBZ","0 dBZ","5 dBZ",
    "10 dBZ","15 dBZ","20 dBZ","25 dBZ","30 dBZ","35 dBZ",
    "40 dBZ","45 dBZ","50 dBZ","55 dBZ","60 dBZ","65 dBZ","70 dBZ"
  ];

  const RGB = PALETTE.map(c => ({
    r: parseInt(c.slice(1,3),16),
    g: parseInt(c.slice(3,5),16),
    b: parseInt(c.slice(5,7),16)
  }));

  let boost = loadBoost();
  let selectedBoost = boost;

  let nav = null;
  let layer = null;
  let timestamps = [];
  let currentIndex = -1;
  let active = false;
  let loading = false;
  let refreshTimer = null;
  let playbackTimer = null;
  let playing = false;
  let playbackBusy = false;

  let requestId = 0;
  let frameRequestId = 0;
  let savedRangeOnInput = null;
  let savedPlayOnClick = null;
  let timelineSaved = false;

  const grayCache = new Map();
  const colorCache = new Map();
  const MAX_CACHE = 600;

  let originalLegend = null;
  let legendSaved = false;

  const $ = id => document.getElementById(id);
  const getMap = () => window.map || null;

  function loadBoost() {
    try {
      const n = Number(localStorage.getItem(BOOST_STORAGE_KEY));
      if (Number.isFinite(n))
        return Math.max(BOOST_MIN, Math.min(BOOST_MAX, Math.round(n)));
    } catch {}
    return BOOST_DEFAULT;
  }

  function saveBoost(n) {
    try {
      localStorage.setItem(BOOST_STORAGE_KEY, String(n));
    } catch {}
  }

  function msg(text) {
    if (typeof window.msg === "function") return window.msg(text);

    const e = document.createElement("div");
    e.textContent = text;
    e.style.cssText =
      "position:fixed;z-index:2147483646;left:50%;bottom:125px;" +
      "transform:translateX(-50%);background:#202930;color:#fff;" +
      "padding:9px 14px;border-radius:8px;border:1px solid #3d4850;" +
      "white-space:nowrap;max-width:calc(100% - 30px);overflow:hidden;" +
      "text-overflow:ellipsis";

    document.body.appendChild(e);
    setTimeout(() => e.remove(), 2200);
  }

  function installSharpCSS() {
    if ($("cloradRainRadarSharpCSS")) return;

    const s = document.createElement("style");
    s.id = "cloradRainRadarSharpCSS";

    s.textContent = `
      canvas.clorad-rainradar-tile{
        image-rendering:pixelated!important;
        image-rendering:-moz-crisp-edges!important;
        -ms-interpolation-mode:nearest-neighbor!important;
        display:block!important;
        backface-visibility:hidden!important;
        transition:none!important;
        animation:none!important;
      }

      .clorad-rainradar-layer,
      .clorad-rainradar-layer *,
      .clorad-rainradar-layer .leaflet-tile-container,
      .clorad-rainradar-layer .leaflet-layer{
        transition:none!important;
        animation:none!important;
      }
    `;

    document.head.appendChild(s);
  }

  function trim(cache) {
    while (cache.size > MAX_CACHE) {
      const k = cache.keys().next().value;
      if (k === undefined) break;
      cache.delete(k);
    }
  }

  function gamma() {
    return Math.max(0.22, 1.02 - boost * 0.033);
  }

  function boosted(v) {
    if (v <= 0) return 0;

    return Math.max(
      0,
      Math.min(
        255,
        Math.round(
          Math.pow(v / 255, gamma()) * 255
        )
      )
    );
  }

  function paletteIndex(v) {
    if (v <= 0) return -1;

    return Math.max(
      0,
      Math.min(
        PALETTE.length - 1,
        Math.floor(v * PALETTE.length / 256)
      )
    );
  }

  function colorize(data) {
    const c = document.createElement("canvas");

    c.width = data.width;
    c.height = data.height;
    c.className = "clorad-rainradar-tile";

    const ctx = c.getContext("2d");

    if (!ctx) {
      throw Error("Canvas 2D недоступен");
    }

    ctx.imageSmoothingEnabled = false;

    const out =
      new ImageData(
        data.width,
        data.height
      );

    const src = data.data;
    const dst = out.data;

    for (
      let i = 0;
      i < src.length;
      i += 4
    ) {
      const raw = src[i];

      if (raw <= 0) {
        dst[i] =
          dst[i + 1] =
          dst[i + 2] =
          dst[i + 3] =
          0;

        continue;
      }

      const p =
        paletteIndex(
          boosted(raw)
        );

      const c =
        RGB[p];

      dst[i] = c.r;
      dst[i + 1] = c.g;
      dst[i + 2] = c.b;
      dst[i + 3] = 255;
    }

    ctx.putImageData(out, 0, 0);

    return c;
  }

  function tileUrl(ts, c) {
    return (
      `${API}?timestamp=${encodeURIComponent(ts)}` +
      `&z=${c.z}&x=${c.x}&y=${c.y}`
    );
  }

  function loadGray(ts, coords) {
    const key =
      `${ts}/${coords.z}/${coords.x}/${coords.y}`;

    if (grayCache.has(key)) {
      return Promise.resolve(
        grayCache.get(key)
      );
    }

    return new Promise(
      (resolve, reject) => {
        const img =
          new Image();

        img.crossOrigin =
          "anonymous";

        img.decoding =
          "async";

        img.onload = () => {
          try {
            const w =
              img.naturalWidth ||
              256;

            const h =
              img.naturalHeight ||
              256;

            const c =
              document.createElement(
                "canvas"
              );

            c.width = w;
            c.height = h;

            const ctx =
              c.getContext(
                "2d",
                {
                  willReadFrequently:
                    true
                }
              );

            if (!ctx) {
              throw Error(
                "Canvas 2D недоступен"
              );
            }

            ctx.imageSmoothingEnabled =
              false;

            ctx.drawImage(
              img,
              0,
              0
            );

            const d =
              ctx.getImageData(
                0,
                0,
                w,
                h
              );

            grayCache.set(
              key,
              d
            );

            trim(
              grayCache
            );

            resolve(d);

          } catch (e) {
            reject(e);
          }
        };

        img.onerror = () =>
          reject(
            Error(
              "RainRadar tile unavailable"
            )
          );

        img.src =
          tileUrl(
            ts,
            coords
          );
      }
    );
  }

  async function coloredTile(
    ts,
    coords
  ) {
    const key =
      `${ts}/${coords.z}/${coords.x}/${coords.y}/${boost}`;

    if (colorCache.has(key)) {
      return colorCache.get(key);
    }

    const c =
      colorize(
        await loadGray(
          ts,
          coords
        )
      );

    colorCache.set(
      key,
      c
    );

    trim(
      colorCache
    );

    return c;
  }

  /* =======================================================
     LEGEND
     ======================================================= */

  function legendContainer() {
    const a =
      document.querySelector(
        ".l1"
      );

    const b =
      document.querySelector(
        ".l19"
      );

    if (!a || !b) {
      return null;
    }

    let n =
      a.parentElement;

    for (
      let i = 0;
      n && i < 10;
      i++,
      n = n.parentElement
    ) {
      if (n.contains(b)) {
        return n;
      }
    }

    return null;
  }

  function saveLegend() {
    if (legendSaved) {
      return;
    }

    const c =
      legendContainer();

    if (!c) {
      return;
    }

    originalLegend = {
      container: c,
      html: c.innerHTML
    };

    legendSaved = true;
  }

  function textReplace(
    root,
    from,
    to
  ) {
    if (!root) {
      return;
    }

    const w =
      document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
      );

    const a = [];
    let n;

    while (
      (n = w.nextNode())
    ) {
      a.push(n);
    }

    for (const x of a) {
      if (
        x.nodeValue.includes(
          from
        )
      ) {
        x.nodeValue =
          x.nodeValue.replaceAll(
            from,
            to
          );
      }
    }
  }

  function applyLegend() {
    saveLegend();

    const l =
      legendContainer();

    if (!l) {
      return;
    }

    textReplace(
      l,
      "ОЯ",
      "О"
    );

    for (
      let i = 1;
      i <= 19;
      i++
    ) {
      const s =
        l.querySelector(
          `.l${i}`
        );

      if (!s) {
        continue;
      }

      const color =
        PALETTE[i - 1];

      s.style.background =
        color;

      s.style.backgroundColor =
        color;

      s.style.backgroundImage =
        "none";

      const inner =
        s.querySelector(
          "*"
        );

      if (inner) {
        inner.style.background =
          color;

        inner.style.backgroundColor =
          color;

        inner.style.backgroundImage =
          "none";
      }

      if (
        !s.children.length &&
        s.textContent.trim()
      ) {
        s.textContent =
          LABELS[i - 1];
      }
    }

    textReplace(
      l,
      "ОЯ",
      "О"
    );
  }

  function restoreLegend() {
    if (
      !legendSaved ||
      !originalLegend?.container
    ) {
      return;
    }

    originalLegend.container.innerHTML =
      originalLegend.html;
  }

  /* =======================================================
     NAV
     ======================================================= */

  function createNav() {
    const old =
      $("rainRadarNav");

    if (old) {
      nav = old;

      if (
        old.dataset.rrHook !==
        "1"
      ) {
        old.dataset.rrHook =
          "1";

        old.onclick =
          e => {
            e.stopPropagation();
            activate();
            show();
          };
      }

      return;
    }

    const rain =
      $("rainProduct");

    if (!rain) {
      return;
    }

    nav =
      document.createElement(
        "button"
      );

    nav.id =
      "rainRadarNav";

    nav.className =
      "n";

    nav.type =
      "button";

    nav.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M4 17h16M4 12h16M4 7h16"/>
      </svg>
      RainRadar
    `;

    rain.insertAdjacentElement(
      "afterend",
      nav
    );

    nav.dataset.rrHook =
      "1";

    nav.onclick =
      e => {
        e.stopPropagation();
        activate();
        show();
      };
  }

  /* =======================================================
     TIMELINE
     ======================================================= */

  function rangeEl() {
    return $("range");
  }

  function playEl() {
    return $("play");
  }

  function timeText(ts) {
    const d =
      new Date(
        Number(ts) * 1000
      );

    if (
      Number.isNaN(
        d.getTime()
      )
    ) {
      return "—";
    }

    return d.toLocaleString(
      "ru-RU",
      {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }
    );
  }

  function saveTimeline() {
    if (timelineSaved) {
      return true;
    }

    const r =
      rangeEl();

    const p =
      playEl();

    if (!r || !p) {
      return false;
    }

    savedRangeOnInput =
      r.oninput;

    savedPlayOnClick =
      p.onclick;

    timelineSaved =
      true;

    return true;
  }

  function restoreTimeline() {
    if (!timelineSaved) {
      return;
    }

    const r =
      rangeEl();

    const p =
      playEl();

    if (r) {
      r.oninput =
        savedRangeOnInput;
    }

    if (p) {
      p.onclick =
        savedPlayOnClick;
    }

    savedRangeOnInput =
      null;

    savedPlayOnClick =
      null;

    timelineSaved =
      false;
  }

  function updateTimeline() {
    const range =
      rangeEl();

    if (range) {
      range.min =
        "0";

      range.max =
        String(
          Math.max(
            0,
            timestamps.length - 1
          )
        );

      range.step =
        "1";

      if (
        currentIndex >= 0
      ) {
        range.value =
          String(
            currentIndex
          );
      }
    }

    const times =
      $("times");

    if (times) {
      times.innerHTML =
        "";

      times.style.display =
        "none";
    }

    const info =
      $("framesInfo");

    if (info) {
      info.textContent =
        timestamps.length
          ? `${timestamps.length} кадров`
          : "";
    }

    const label =
      $("timeLabel");

    if (
      label &&
      currentIndex >= 0 &&
      timestamps[currentIndex]
    ) {
      label.textContent =
        timeText(
          timestamps[currentIndex]
        );
    }
  }

  function updatePlayButton() {
    const p =
      playEl();

    if (!p) {
      return;
    }

    if (playing) {
      p.innerHTML =
        '<svg viewBox="0 0 24 24">' +
        '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' +
        "</svg>";
    } else {
      p.innerHTML =
        '<svg viewBox="0 0 24 24">' +
        '<path d="M7 4l13 8-13 8z"/>' +
        "</svg>";
    }
  }

  function hookTimeline() {
    if (!active) {
      return;
    }

    const r =
      rangeEl();

    const p =
      playEl();

    if (!r || !p) {
      return;
    }

    if (!saveTimeline()) {
      return;
    }

    r.oninput =
      () => {
        if (!active) {
          return;
        }

        stopPlayback();

        const index =
          Number(
            r.value
          );

        if (
          !Number.isFinite(
            index
          )
        ) {
          return;
        }

        setFrame(index);
      };

    p.onclick =
      event => {
        if (!active) {
          if (
            typeof savedPlayOnClick ===
            "function"
          ) {
            savedPlayOnClick.call(
              p,
              event
            );
          }

          return;
        }

        event.preventDefault();
        event.stopPropagation();

        togglePlayback();
      };

    updateTimeline();
    updatePlayButton();
  }

  /* =======================================================
     RAINRADAR GRID LAYER
     ======================================================= */

  class RainRadarLayer
    extends L.GridLayer {

    constructor(
      timestamp,
      token
    ) {
      super({
        tileSize: 256,
        minZoom: MIN_NATIVE_ZOOM,
        maxZoom: MAX_NATIVE_ZOOM,
        opacity: 0,
        updateWhenIdle: true,
        updateWhenZooming: false,
        keepBuffer: 2,
        noWrap: true
      });

      this.timestamp =
        timestamp;

      this.token =
        token;

      this._pending =
        new Set();

      this._ready =
        new Set();

      this._failed =
        new Set();

      this._frameReady =
        false;

      this._fired =
        false;
    }

    onAdd(map) {
      super.onAdd(map);

      const container =
        this.getContainer();

      if (container) {
        container.classList.add(
          "clorad-rainradar-layer"
        );

        container.style.transition =
          "none";

        container.style.animation =
          "none";
      }

      this.setOpacity(
        0
      );
    }

    createTile(
      coords,
      done
    ) {
      const canvas =
        document.createElement(
          "canvas"
        );

      canvas.width =
        256;

      canvas.height =
        256;

      canvas.className =
        "clorad-rainradar-tile";

      canvas.style.imageRendering =
        "pixelated";

      canvas.style.transition =
        "none";

      canvas.style.animation =
        "none";

      const key =
        `${coords.z}/${coords.x}/${coords.y}`;

      this._pending.add(
        key
      );

      coloredTile(
        this.timestamp,
        coords
      )
        .then(source => {
          if (
            !this._pending.has(
              key
            )
          ) {
            return;
          }

          const ctx =
            canvas.getContext(
              "2d"
            );

          if (!ctx) {
            throw Error(
              "Canvas 2D недоступен"
            );
          }

          ctx.imageSmoothingEnabled =
            false;

          ctx.clearRect(
            0,
            0,
            256,
            256
          );

          ctx.drawImage(
            source,
            0,
            0,
            256,
            256
          );

          canvas.style.transition =
            "none";

          this._pending.delete(
            key
          );

          this._ready.add(
            key
          );

          done(
            null,
            canvas
          );

          this._checkReady();

        })
        .catch(error => {
          this._pending.delete(
            key
          );

          this._failed.add(
            key
          );

          done(
            error,
            canvas
          );

          this._checkReady();
        });

      return canvas;
    }

    _checkReady() {
      if (this._fired) {
        return;
      }

      /*
       * Leaflet создаёт tile-контейнеры
       * по мере необходимости.
       *
       * Когда pending пуст,
       * все уже созданные видимые
       * тайлы завершили загрузку.
       */
      if (
        this._pending.size !==
        0
      ) {
        return;
      }

      if (
        this._ready.size ===
          0 &&
        this._failed.size ===
          0
      ) {
        return;
      }

      this._frameReady =
        true;

      this._fired =
        true;

      this.fire(
        "frameready",
        {
          ready:
            this._failed.size === 0
        }
      );
    }
  }

  function createLayer(
    timestamp,
    token
  ) {
    const map =
      getMap();

    if (!map) {
      return null;
    }

    const old =
      layer;

    const next =
      new RainRadarLayer(
        timestamp,
        token
      );

    layer =
      next;

    next.once(
      "frameready",
      event => {
        if (
          !active ||
          token !== frameRequestId
        ) {
          if (
            map.hasLayer(next)
          ) {
            map.removeLayer(
              next
            );
          }

          return;
        }

        if (
          !event.ready
        ) {
          if (
            map.hasLayer(next)
          ) {
            map.removeLayer(
              next
            );
          }

          if (
            layer === next
          ) {
            layer =
              old;
          }

          msg(
            "Кадр RainRadar загружен не полностью"
          );

          return;
        }

        /*
         * КРИТИЧЕСКАЯ ЧАСТЬ.
         *
         * Старый кадр НЕ убирается во время
         * загрузки нового.
         *
         * Новый слой всё это время имеет
         * opacity:0.
         *
         * Когда новый кадр полностью готов,
         * удаляем старый и сразу показываем
         * новый в одном JS-задачном проходе.
         *
         * Между этими двумя операциями нет
         * requestAnimationFrame / await,
         * поэтому браузер не получает возможности
         * отрисовать пустую карту.
         */

        if (
          old &&
          old !== next &&
          map.hasLayer(old)
        ) {
          map.removeLayer(
            old
          );
        }

        next.setOpacity(
          1
        );

        layer =
          next;
      }
    );

    next.addTo(
      map
    );

    return next;
  }

  /* =======================================================
     MANIFEST
     ======================================================= */

  async function loadFrames() {
    const r =
      await fetch(
        `${API}?manifest=1&t=${Date.now()}`,
        {
          cache:
            "no-store"
        }
      );

    let data;

    try {
      data =
        await r.json();
    } catch {
      throw Error(
        `RainRadar API вернул HTTP ${r.status}`
      );
    }

    if (
      !r.ok ||
      !data ||
      data.ok === false
    ) {
      throw Error(
        data?.error ||
        `RainRadar API HTTP ${r.status}`
      );
    }

    timestamps =
      (
        Array.isArray(
          data.frames
        )
          ? data.frames
          : []
      )
        .map(
          f =>
            typeof f ===
            "object"
              ? Number(
                  f?.timestamp
                )
              : Number(f)
        )
        .filter(
          Number.isFinite
        )
        .sort(
          (a,b) =>
            a - b
        );

    if (
      !timestamps.length
    ) {
      throw Error(
        "RainRadar не вернул кадры"
      );
    }

    return timestamps;
  }

  async function setFrame(
    index
  ) {
    if (
      !active ||
      !timestamps.length
    ) {
      return false;
    }

    const target =
      Math.max(
        0,
        Math.min(
          timestamps.length - 1,
          Number(index)
        )
      );

    if (
      !Number.isFinite(
        target
      )
    ) {
      return false;
    }

    const previous =
      currentIndex;

    const token =
      ++frameRequestId;

    currentIndex =
      target;

    updateTimeline();

    const next =
      createLayer(
        timestamps[target],
        token
      );

    if (!next) {
      currentIndex =
        previous;

      updateTimeline();

      return false;
    }

    return new Promise(
      resolve => {
        let done =
          false;

        const finish =
          e => {
            if (done) {
              return;
            }

            done =
              true;

            const ok =
              Boolean(
                e?.ready
              );

            if (
              !ok &&
              active &&
              token ===
                frameRequestId &&
              currentIndex ===
                target
            ) {
              currentIndex =
                previous;

              updateTimeline();
            }

            resolve(ok);
          };

        next.once(
          "frameready",
          finish
        );

        if (
          next._frameReady
        ) {
          finish({
            ready:
              next._failed.size ===
              0
          });
        }
      }
    );
  }

  /* =======================================================
     PLAYBACK
     ======================================================= */

  function stopPlayback() {
    playing =
      false;

    playbackBusy =
      false;

    if (
      playbackTimer
    ) {
      clearTimeout(
        playbackTimer
      );
    }

    playbackTimer =
      null;

    updatePlayButton();
  }

  async function playbackStep() {
    if (
      !active ||
      !playing ||
      playbackBusy
    ) {
      return;
    }

    playbackBusy =
      true;

    const next =
      currentIndex >=
        timestamps.length - 1
        ? 0
        : currentIndex + 1;

    let ok =
      false;

    try {
      ok =
        await setFrame(
          next
        );
    } finally {
      playbackBusy =
        false;
    }

    if (
      ok &&
      active &&
      playing
    ) {
      playbackTimer =
        setTimeout(
          playbackStep,
          700
        );
    }
  }

  function startPlayback() {
    if (
      !active ||
      timestamps.length < 2
    ) {
      return;
    }

    stopPlayback();

    playing =
      true;

    updatePlayButton();

    playbackTimer =
      setTimeout(
        playbackStep,
        0
      );
  }

  function togglePlayback() {
    if (playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  /* =======================================================
     ACTIVATE / STOP
     ======================================================= */

  function activate() {
    ++requestId;
    ++frameRequestId;

    active =
      true;

    stopPlayback();

    document
      .querySelectorAll(
        ".nav .n"
      )
      .forEach(
        b =>
          b.classList.remove(
            "active"
          )
      );

    if (nav) {
      nav.classList.add(
        "active"
      );
    }

    applyLegend();

    try {
      window.CLOradStopRadar?.();
    } catch {}

    try {
      window.CLOradDeactivateGIF?.();
    } catch {}

    hookTimeline();
  }

  function stop() {
    active =
      false;

    loading =
      false;

    stopPlayback();
    stopRefresh();

    ++requestId;
    ++frameRequestId;

    restoreTimeline();

    const map =
      getMap();

    if (
      map &&
      layer
    ) {
      try {
        map.removeLayer(
          layer
        );
      } catch {}
    }

    if (map) {
      const remove =
        [];

      map.eachLayer(
        x => {
          if (
            x instanceof
            RainRadarLayer
          ) {
            remove.push(x);
          }
        }
      );

      remove.forEach(
        x => {
          try {
            map.removeLayer(
              x
            );
          } catch {}
        }
      );
    }

    layer =
      null;

    if (nav) {
      nav.classList.remove(
        "active"
      );
    }

    restoreLegend();
  }

  function hookOtherLayers() {
    const n =
      document.querySelector(
        ".nav"
      );

    if (
      !n ||
      n.dataset.rrOtherHooked
    ) {
      return;
    }

    n.dataset.rrOtherHooked =
      "1";

    n.addEventListener(
      "click",
      e => {
        const b =
          e.target.closest(
            ".nav .n"
          );

        if (
          !b ||
          b.id ===
            "rainRadarNav"
        ) {
          return;
        }

        if (
          active ||
          layer
        ) {
          stop();
        }
      },
      true
    );

    if (
      typeof MutationObserver !==
      "undefined"
    ) {
      const ob =
        new MutationObserver(
          () => {
            if (!active) {
              return;
            }

            const b =
              n.querySelector(
                ".n.active"
              );

            if (
              b &&
              b.id !==
                "rainRadarNav"
            ) {
              stop();
            }
          }
        );

      ob.observe(
        n,
        {
          subtree:
            true,
          attributes:
            true,
          attributeFilter:
            ["class"]
        }
      );
    }
  }

  /* =======================================================
     SHOW / REFRESH
     ======================================================= */

  async function show() {
    if (loading) {
      return;
    }

    if (!getMap()) {
      return msg(
        "Карта ещё не готова"
      );
    }

    loading =
      true;

    stopPlayback();

    msg(
      "Загрузка RainRadar..."
    );

    try {
      await loadFrames();

      if (!active) {
        return;
      }

      await setFrame(
        timestamps.length - 1
      );

      if (!active) {
        return;
      }

      startRefresh();

      msg(
        `RainRadar загружен · накрутка ${boost}`
      );

    } catch (e) {
      console.error(
        "RainRadar:",
        e
      );

      msg(
        e?.message ||
        "Ошибка загрузки RainRadar"
      );

    } finally {
      loading =
        false;
    }
  }

  function startRefresh() {
    stopRefresh();

    refreshTimer =
      setInterval(
        async () => {
          if (
            !active ||
            loading
          ) {
            return;
          }

          try {
            const oldLatest =
              timestamps[
                timestamps.length - 1
              ];

            await loadFrames();

            if (!active) {
              return;
            }

            const latest =
              timestamps[
                timestamps.length - 1
              ];

            if (
              latest !==
              oldLatest
            ) {
              const wasPlaying =
                playing;

              if (wasPlaying) {
                stopPlayback();
              }

              await setFrame(
                timestamps.length - 1
              );

              if (
                wasPlaying &&
                active
              ) {
                startPlayback();
              }

              msg(
                "RainRadar: новый кадр"
              );
            }

          } catch (e) {
            console.warn(
              "RainRadar refresh:",
              e
            );
          }
        },
        REFRESH_TIME
      );
  }

  function stopRefresh() {
    if (
      refreshTimer
    ) {
      clearInterval(
        refreshTimer
      );
    }

    refreshTimer =
      null;
  }

  /* =======================================================
     BOOST SETTINGS
     ======================================================= */

  function settingsContainer() {
    return $("settings");
  }

  function syncBoostUI() {
    const r =
      $("cloradRainRadarBoostRange");

    const v =
      $("cloradRainRadarBoostValue");

    if (r) {
      r.value =
        String(
          selectedBoost
        );
    }

    if (v) {
      v.textContent =
        String(
          selectedBoost
        );
    }
  }

  function applyBoost() {
    if (
      selectedBoost ===
      boost
    ) {
      msg(
        `Накрутка RainRadar: ${boost}`
      );

      return;
    }

    boost =
      selectedBoost;

    saveBoost(
      boost
    );

    colorCache.clear();

    if (
      active &&
      currentIndex >= 0
    ) {
      setFrame(
        currentIndex
      );
    }

    msg(
      `Накрутка RainRadar применена: ${boost}`
    );
  }

  function createSettings() {
    const settings =
      settingsContainer();

    if (!settings) {
      return;
    }

    const old =
      settings.querySelector(
        "#cloradRainRadarSetting"
      );

    if (old) {
      syncBoostUI();
      return;
    }

    const box =
      document.createElement(
        "div"
      );

    box.className =
      "setting";

    box.id =
      "cloradRainRadarSetting";

    const head =
      document.createElement(
        "button"
      );

    head.className =
      "settingHead";

    head.type =
      "button";

    head.innerHTML =
      `<span>Накрутка RainRadar</span>` +
      `<span class="settingArrow">›</span>`;

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "settingBody";

    const info =
      document.createElement(
        "div"
      );

    info.className =
      "framesInfo";

    info.style.marginBottom =
      "9px";

    info.textContent =
      "Усиление интенсивности данных";

    const row =
      document.createElement(
        "div"
      );

    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;" +
      "margin-bottom:8px;font-size:13px";

    const name =
      document.createElement(
        "span"
      );

    name.textContent =
      "Выбрано:";

    const value =
      document.createElement(
        "strong"
      );

    value.id =
      "cloradRainRadarBoostValue";

    value.style.cssText =
      "font-size:16px;font-variant-numeric:tabular-nums;" +
      "min-width:28px;text-align:right;color:#53e39b";

    row.append(
      name,
      value
    );

    const r =
      document.createElement(
        "input"
      );

    r.type =
      "range";

    r.id =
      "cloradRainRadarBoostRange";

    r.min =
      String(
        BOOST_MIN
      );

    r.max =
      String(
        BOOST_MAX
      );

    r.step =
      "1";

    r.value =
      String(
        selectedBoost
      );

    r.style.cssText =
      "width:100%;display:block;margin:3px 0 4px;" +
      "accent-color:#53e39b";

    const scale =
      document.createElement(
        "div"
      );

    scale.style.cssText =
      "display:flex;justify-content:space-between;font-size:10px;" +
      "color:#858e95;margin-bottom:10px";

    scale.innerHTML =
      "<span>1</span><span>30</span>";

    const apply =
      document.createElement(
        "button"
      );

    apply.id =
      "cloradRainRadarBoostApply";

    apply.type =
      "button";

    apply.textContent =
      "Применить";

    apply.style.cssText =
      "width:100%;height:40px;border:1px solid #3d8e6a;" +
      "border-radius:8px;background:#194c38;color:#eafff5;" +
      "font-size:14px;font-weight:600;cursor:pointer";

    body.append(
      info,
      row,
      r,
      scale,
      apply
    );

    box.append(
      head,
      body
    );

    const frames =
      settings.querySelector(
        "#framesSetting"
      );

    if (
      frames?.parentElement ===
      settings
    ) {
      frames.insertAdjacentElement(
        "afterend",
        box
      );
    } else {
      settings.appendChild(
        box
      );
    }

    head.onclick =
      e => {
        e.preventDefault();
        e.stopPropagation();

        box.classList.toggle(
          "open"
        );
      };

    r.oninput =
      () => {
        selectedBoost =
          Math.max(
            BOOST_MIN,
            Math.min(
              BOOST_MAX,
              Math.round(
                Number(
                  r.value
                )
              )
            )
          );

        value.textContent =
          String(
            selectedBoost
          );
      };

    apply.onclick =
      e => {
        e.preventDefault();
        e.stopPropagation();

        applyBoost();
      };

    syncBoostUI();
  }

  /* =======================================================
     INIT / PUBLIC API
     ======================================================= */

  function init() {
    installSharpCSS();

    createNav();
    hookOtherLayers();
    createSettings();

    [
      300,
      800,
      1500,
      3000
    ].forEach(
      ms =>
        setTimeout(
          () => {
            createNav();
            hookOtherLayers();
            createSettings();
          },
          ms
        )
    );
  }

  window.CLOradStopRainRadar =
    stop;

  window.CLOradDeactivateRainRadar =
    stop;

  window.CLOradRainRadar = {
    show,
    stop,
    reload:
      show,

    play:
      startPlayback,

    pause:
      stopPlayback,

    getFrames:
      () =>
        timestamps.slice(),

    getCurrent:
      () =>
        timestamps[
          currentIndex
        ] ||
        null,

    getBoost:
      () =>
        boost,

    setBoost:
      value => {
        selectedBoost =
          Math.max(
            BOOST_MIN,
            Math.min(
              BOOST_MAX,
              Math.round(
                Number(
                  value
                )
              )
            )
          );

        syncBoostUI();

        applyBoost();
      }
  };

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once:
          true
      }
    );
  } else {
    init();
  }

})();
