/* =========================================================
   CLOrad — Meteoinfo GIF Radar
   ДМРЛ композит
   Разрешение ДМРЛ + сетка данных ДМРЛ
   ========================================================= */
(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const API = "/api/radar-gif";

  const GIF_BOUNDS = [
    [38.2155955810, 14.9892981264],
    [69.6543707199, 72.9237642948]
  ];

  /*
     Разрешения:
       1 = 1×1
       2 = 2×2
       4 = 4×4
  */
  const ALLOWED_RESOLUTIONS = [
    1,
    2,
    4
  ];

  /* =======================================================
     STATE
     ======================================================= */

  let gifActive = false;
  let gifFrames = [];
  let gifFrameTimes = [];
  let gifFrameDelays = [];
  let gifFrameRequest = 0;
  let gifMeta = null;
  let gifImageCache = new Map();
  let gifPlaying = false;
  let gifPlayTimer = null;
  let gifLayer = null;

  let gifResolution = 1;

  let dmrlGridEnabled = false;

  let dmrlGridCanvas = null;
  let dmrlGridLayer = null;

  /*
     Тёмная карта.
  */
  let darkMapLayer = null;

  /* =======================================================
     HELPER
     ======================================================= */

  const $ = id =>
    document.getElementById(id);

  function showLoading() {
    $("loadingFrames")?.classList.add(
      "show"
    );
  }

  function hideLoading() {
    $("loadingFrames")?.classList.remove(
      "show"
    );
  }

  /* =======================================================
     SETTINGS — ОБЩИЙ СТИЛЬ
     ======================================================= */

  function installDMRLSettingsStyle() {
    if (
      document.getElementById(
        "clorad-dmrl-settings-style"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "clorad-dmrl-settings-style";

    style.textContent = `
      #gifResolutionSetting
      .clorad-dmrl-resolution-options {
        display: flex;
        width: 100%;
        gap: 7px;
      }

      #gifResolutionSetting
      .clorad-dmrl-resolution-option {
        flex: 1;
        height: 38px;
        padding: 0;
        border: 1px solid
          rgba(255,255,255,.10);
        border-radius: 9px;
        background:
          rgba(255,255,255,.055);
        color:
          rgba(255,255,255,.72);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        -webkit-tap-highlight-color:
          transparent;
        transition:
          background .15s ease,
          color .15s ease,
          border-color .15s ease;
      }

      #gifResolutionSetting
      .clorad-dmrl-resolution-option.active {
        background:
          rgba(255,255,255,.13);
        border-color:
          rgba(255,255,255,.20);
        color:
          #fff;
      }

      #gifResolutionSetting
      .clorad-dmrl-resolution-option:active {
        transform:
          scale(.97);
      }

      #dmrlGridSetting
      .clorad-dmrl-grid-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        cursor: pointer;
      }

      #dmrlGridSetting
      .clorad-dmrl-grid-toggle-text {
        color:
          rgba(255,255,255,.76);
        font-size: 13px;
        font-weight: 500;
      }

      #dmrlGridSetting
      .clorad-dmrl-grid-switch {
        position: relative;
        flex: 0 0 auto;
        width: 42px;
        height: 24px;
        border-radius: 999px;
        background:
          rgba(255,255,255,.12);
        border:
          1px solid rgba(255,255,255,.12);
        transition:
          background .15s ease;
      }

      #dmrlGridSetting
      .clorad-dmrl-grid-switch::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        transition:
          transform .15s ease;
      }

      #dmrlGridSetting.active
      .clorad-dmrl-grid-switch {
        background:
          rgba(95,190,130,.65);
      }

      #dmrlGridSetting.active
      .clorad-dmrl-grid-switch::after {
        transform:
          translateX(18px);
      }

      body.light
      #gifResolutionSetting
      .clorad-dmrl-resolution-option {
        background:
          rgba(0,0,0,.045);
        border-color:
          rgba(0,0,0,.10);
        color:
          rgba(0,0,0,.62);
      }

      body.light
      #gifResolutionSetting
      .clorad-dmrl-resolution-option.active {
        background:
          rgba(0,0,0,.09);
        border-color:
          rgba(0,0,0,.16);
        color:
          #111;
      }

      body.light
      #dmrlGridSetting
      .clorad-dmrl-grid-toggle-text {
        color:
          rgba(0,0,0,.68);
      }

      body.light
      #dmrlGridSetting
      .clorad-dmrl-grid-switch {
        background:
          rgba(0,0,0,.10);
        border-color:
          rgba(0,0,0,.10);
      }

      body.light
      #dmrlGridSetting.active
      .clorad-dmrl-grid-switch {
        background:
          rgba(70,160,100,.65);
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     SETTINGS — РАЗРЕШЕНИЕ ДМРЛ
     ======================================================= */

  function installGIFResolutionSetting() {
    const settings =
      document.getElementById(
        "settings"
      );

    if (!settings) {
      return;
    }

    if (
      document.getElementById(
        "gifResolutionSetting"
      )
    ) {
      return;
    }

    const setting =
      document.createElement(
        "div"
      );

    setting.className =
      "setting";

    setting.id =
      "gifResolutionSetting";

    setting.innerHTML = `
      <button
        class="settingHead"
        id="gifResolutionHead"
        type="button"
      >
        <span>
          Разрешение ДМРЛ
        </span>
        <span class="settingArrow">
          ›
        </span>
      </button>

      <div
        class="settingBody"
        id="gifResolutionBody"
      >
        <div
          class="clorad-dmrl-resolution-options"
        >
          <button
            class="clorad-dmrl-resolution-option active"
            type="button"
            data-resolution="1"
          >
            1×1
          </button>

          <button
            class="clorad-dmrl-resolution-option"
            type="button"
            data-resolution="2"
          >
            2×2
          </button>

          <button
            class="clorad-dmrl-resolution-option"
            type="button"
            data-resolution="4"
          >
            4×4
          </button>
        </div>
      </div>
    `;

    const framesSetting =
      document.getElementById(
        "framesSetting"
      );

    if (framesSetting) {
      framesSetting.after(
        setting
      );
    } else {
      settings.appendChild(
        setting
      );
    }

    const head =
      document.getElementById(
        "gifResolutionHead"
      );

    if (head) {
      head.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          const isOpen =
            setting.classList.contains(
              "open"
            );

          document
            .querySelectorAll(
              ".setting.open"
            )
            .forEach(
              other => {
                if (
                  other !== setting
                ) {
                  other.classList.remove(
                    "open"
                  );
                }
              }
            );

          setting.classList.toggle(
            "open",
            !isOpen
          );
        }
      );
    }

    setting
      .querySelectorAll(
        ".clorad-dmrl-resolution-option"
      )
      .forEach(
        option => {
          option.addEventListener(
            "click",
            event => {
              event.stopPropagation();

              const value =
                Number(
                  option.dataset.resolution
                );

              if (
                !ALLOWED_RESOLUTIONS.includes(
                  value
                )
              ) {
                return;
              }

              setGIFResolution(
                value
              );
            }
          );
        }
      );

    updateGIFResolutionButtons();
  }

  function updateGIFResolutionButtons() {
    document
      .querySelectorAll(
        ".clorad-dmrl-resolution-option"
      )
      .forEach(
        option => {
          option.classList.toggle(
            "active",
            Number(
              option.dataset.resolution
            ) === gifResolution
          );
        }
      );
  }

  /* =======================================================
     SETTINGS — СЕТКА ДМРЛ
     ======================================================= */

  function installDMRLGridSetting() {
    const settings =
      document.getElementById(
        "settings"
      );

    if (!settings) {
      return;
    }

    if (
      document.getElementById(
        "dmrlGridSetting"
      )
    ) {
      return;
    }

    const setting =
      document.createElement(
        "div"
      );

    setting.className =
      "setting";

    setting.id =
      "dmrlGridSetting";

    setting.innerHTML = `
      <button
        class="settingHead"
        id="dmrlGridHead"
        type="button"
      >
        <span>
          Сетка данных ДМРЛ
        </span>

        <span class="settingArrow">
          ›
        </span>
      </button>

      <div
        class="settingBody"
        id="dmrlGridBody"
      >
        <div
          class="clorad-dmrl-grid-toggle"
          id="dmrlGridToggle"
          role="button"
          tabindex="0"
        >
          <span
            class="clorad-dmrl-grid-toggle-text"
          >
            Показывать сетку данных
          </span>

          <span
            class="clorad-dmrl-grid-switch"
          ></span>
        </div>
      </div>
    `;

    const resolutionSetting =
      document.getElementById(
        "gifResolutionSetting"
      );

    if (resolutionSetting) {
      resolutionSetting.after(
        setting
      );
    } else {
      settings.appendChild(
        setting
      );
    }

    const head =
      document.getElementById(
        "dmrlGridHead"
      );

    if (head) {
      head.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          const isOpen =
            setting.classList.contains(
              "open"
            );

          document
            .querySelectorAll(
              ".setting.open"
            )
            .forEach(
              other => {
                if (
                  other !== setting
                ) {
                  other.classList.remove(
                    "open"
                  );
                }
              }
            );

          setting.classList.toggle(
            "open",
            !isOpen
          );
        }
      );
    }

    const toggle =
      document.getElementById(
        "dmrlGridToggle"
      );

    if (toggle) {
      toggle.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          setDMRLGridEnabled(
            !dmrlGridEnabled
          );
        }
      );

      toggle.addEventListener(
        "keydown",
        event => {
          if (
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            event.stopPropagation();

            setDMRLGridEnabled(
              !dmrlGridEnabled
            );
          }
        }
      );
    }

    updateDMRLGridButton();
  }

  function updateDMRLGridButton() {
    const setting =
      document.getElementById(
        "dmrlGridSetting"
      );

    if (!setting) {
      return;
    }

    setting.classList.toggle(
      "active",
      dmrlGridEnabled
    );
  }

  /* =======================================================
     RESOLUTION
     ======================================================= */

  function setGIFResolution(
    value
  ) {
    if (
      !ALLOWED_RESOLUTIONS.includes(
        value
      )
    ) {
      value = 1;
    }

    gifResolution =
      value;

    updateGIFResolutionButtons();

    if (
      dmrlGridEnabled
    ) {
      drawDMRLGrid();
    }

    if (
      gifActive &&
      gifFrames.length
    ) {
      const index =
        Number(
          $("range")?.value || 0
        );

      gifImageCache.clear();

      rebuildFrameUrls();

      showGIFFrame(
        index
      );
    }
  }

  /* =======================================================
     GRID — CANVAS LAYER
     ======================================================= */

  function createDMRLGridLayer() {
    if (
      dmrlGridLayer ||
      !window.map
    ) {
      return;
    }

    /*
       Отдельная панель выше
       радара и остальных overlay.
    */
    if (
      !window.map.getPane(
        "dmrlGridPane"
      )
    ) {
      window.map.createPane(
        "dmrlGridPane"
      );

      window.map.getPane(
        "dmrlGridPane"
      ).style.zIndex =
        "650";
    }

    const GridLayer =
      L.Layer.extend({

        onAdd(map) {
          this._map =
            map;

          this._canvas =
            document.createElement(
              "canvas"
            );

          this._canvas.className =
            "clorad-dmrl-grid-canvas";

          this._canvas.style.position =
            "absolute";

          this._canvas.style.pointerEvents =
            "none";

          this._canvas.style.zIndex =
            "650";

          this._canvas.style.display =
            "block";

          this._canvas.style.zIndex =
            "650";

          map.getPane(
            "dmrlGridPane"
          ).appendChild(
            this._canvas
          );

          dmrlGridCanvas =
            this._canvas;

          map.on(
            "move zoom resize viewreset",
            this._reset,
            this
          );

          this._reset();
        },

        onRemove(map) {
          map.off(
            "move zoom resize viewreset",
            this._reset,
            this
          );

          if (
            this._canvas &&
            this._canvas.parentNode
          ) {
            this._canvas.parentNode
              .removeChild(
                this._canvas
              );
          }

          dmrlGridCanvas =
            null;

          this._canvas =
            null;

          this._map =
            null;
        },

        _reset() {
          if (
            !this._map ||
            !this._canvas
          ) {
            return;
          }

          if (
            !dmrlGridEnabled
          ) {
            this._canvas.style.display =
              "none";

            return;
          }

          this._canvas.style.display =
            "block";

          drawDMRLGrid();
        }
      });

    dmrlGridLayer =
      new GridLayer();

    if (
      dmrlGridEnabled
    ) {
      dmrlGridLayer.addTo(
        window.map
      );
    }
  }

  /* =======================================================
     GRID — DRAW
     ======================================================= */

  function drawDMRLGrid() {
    if (
      !dmrlGridCanvas ||
      !window.map
    ) {
      return;
    }

    if (
      !dmrlGridEnabled
    ) {
      dmrlGridCanvas.style.display =
        "none";

      return;
    }

    dmrlGridCanvas.style.display =
      "block";

    const map =
      window.map;

    const canvas =
      dmrlGridCanvas;

    const size =
      map.getSize();

    const dpr =
      Math.min(
        window.devicePixelRatio || 1,
        2
      );

    canvas.width =
      Math.max(
        1,
        Math.round(
          size.x * dpr
        )
      );

    canvas.height =
      Math.max(
        1,
        Math.round(
          size.y * dpr
        )
      );

    canvas.style.width =
      size.x + "px";

    canvas.style.height =
      size.y + "px";

    const topLeft =
      map.containerPointToLayerPoint(
        [0, 0]
      );

    L.DomUtil.setPosition(
      canvas,
      topLeft
    );

    const ctx =
      canvas.getContext(
        "2d"
      );

    if (!ctx) {
      return;
    }

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    ctx.clearRect(
      0,
      0,
      size.x,
      size.y
    );

    /* =====================================================
       ИЗМЕНЕНО ТОЛЬКО ЗДЕСЬ:
       сетка теперь является настоящей
       пиксельной сеткой PNG.

       Сервер создаёт PNG:
         width  = gifMeta.width
         height = gifMeta.height

       и географически привязывает его
       к GIF_BOUNDS в Web Mercator.

       Поэтому DMRL_GRID_BOUNDS больше
       НЕ используется.
       ===================================================== */

    const rasterWidth =
      Number(
        gifMeta?.width
      ) ||
      1122;

    const rasterHeight =
      Number(
        gifMeta?.height
      ) ||
      1136;

    const columns =
      Math.ceil(
        rasterWidth /
        gifResolution
      );

    const rows =
      Math.ceil(
        rasterHeight /
        gifResolution
      );

    if (
      columns < 1 ||
      rows < 1
    ) {
      return;
    }

    const north =
      GIF_BOUNDS[1][0];

    const east =
      GIF_BOUNDS[1][1];

    const south =
      GIF_BOUNDS[0][0];

    const west =
      GIF_BOUNDS[0][1];

    /*
       ВАЖНО:

       Сервер делает строки PNG
       линейными по Web Mercator:

         northMerc - y * mercStep

       Поэтому здесь делаем ТО ЖЕ САМОЕ.

       Нельзя использовать просто:
         lat = north - i * latStep

       потому что широта в Web Mercator
       нелинейна.
    */

    function mercatorY(
      lat
    ) {
      const rad =
        lat *
        Math.PI /
        180;

      return Math.log(
        Math.tan(
          Math.PI / 4 +
          rad / 2
        )
      );
    }

    function inverseMercatorY(
      value
    ) {
      return (
        Math.atan(
          Math.sinh(
            value
          )
        ) *
        180 /
        Math.PI
      );
    }

    const northMerc =
      mercatorY(
        north
      );

    const southMerc =
      mercatorY(
        south
      );

    /*
       Полный растр в проектированных
       координатах карты.
    */
    const northWest =
      map.latLngToContainerPoint(
        [
          north,
          west
        ]
      );

    const northEast =
      map.latLngToContainerPoint(
        [
          north,
          east
        ]
      );

    const southWest =
      map.latLngToContainerPoint(
        [
          south,
          west
        ]
      );

    const southEast =
      map.latLngToContainerPoint(
        [
          south,
          east
        ]
      );

    /*
       Для вертикальных линий
       долгота линейная.
    */
    const westX =
      northWest.x;

    const eastX =
      northEast.x;

    const rasterPixelWidth =
      (
        eastX -
        westX
      ) /
      rasterWidth;

    /*
       Для горизонтальных линий
       используем Mercator.

       Это обеспечивает соответствие:
         PNG row 0     = north
         PNG row 1     = следующий пиксель
         PNG row 2     = следующий пиксель
         ...
         PNG row height = south
    */
    const northY =
      northWest.y;

    const southY =
      southWest.y;

    const rasterPixelHeight =
      (
        southY -
        northY
      ) /
      rasterHeight;

    /*
       Видимая область.
    */
    const left =
      Math.min(
        northWest.x,
        southWest.x
      );

    const right =
      Math.max(
        northEast.x,
        southEast.x
      );

    const top =
      Math.min(
        northWest.y,
        northEast.y
      );

    const bottom =
      Math.max(
        southWest.y,
        southEast.y
      );

    if (
      right < 0 ||
      bottom < 0 ||
      left > size.x ||
      top > size.y
    ) {
      return;
    }

    ctx.lineWidth =
      1;

    ctx.strokeStyle =
      "rgba(255,255,255,0.34)";

    ctx.beginPath();

    /*
       =====================================================
       ВЕРТИКАЛЬНЫЕ ЛИНИИ

       Одна линия = одна граница
       группы пикселей по X.
       =====================================================
    */

    for (
      let i = 0;
      i <= columns;
      i++
    ) {
      const pixelX =
        Math.min(
          rasterWidth,
          i *
          gifResolution
        );

      const x =
        westX +
        pixelX *
        rasterPixelWidth;

      if (
        x < -2 ||
        x > size.x + 2
      ) {
        continue;
      }

      ctx.moveTo(
        Math.round(
          x
        ) + 0.5,
        Math.max(
          0,
          top
        )
      );

      ctx.lineTo(
        Math.round(
          x
        ) + 0.5,
        Math.min(
          size.y,
          bottom
        )
      );
    }

    /*
       =====================================================
       ГОРИЗОНТАЛЬНЫЕ ЛИНИИ

       Одна линия = одна граница
       группы пикселей по Y.

       Координата полностью соответствует
       Mercator-геопривязке PNG.
       =====================================================
    */

    for (
      let i = 0;
      i <= rows;
      i++
    ) {
      const pixelY =
        Math.min(
          rasterHeight,
          i *
          gifResolution
        );

      /*
         Положение непосредственно
         в проекции PNG.
      */
      const y =
        northY +
        pixelY *
        rasterPixelHeight;

      /*
         Дополнительно вычисляем
         географическую широту этой
         строки через обратный Mercator.
         Это сохраняет математическую
         привязку к серверному растру.
      */
      const merc =
        northMerc -
        (
          pixelY /
          rasterHeight
        ) *
        (
          northMerc -
          southMerc
        );

      const lat =
        inverseMercatorY(
          merc
        );

      /*
         Получаем реальную экранную
         координату через Leaflet.
      */
      const p1 =
        map.latLngToContainerPoint(
          [
            lat,
            west
          ]
        );

      const p2 =
        map.latLngToContainerPoint(
          [
            lat,
            east
          ]
        );

      const lineY =
        (
          p1.y +
          p2.y
        ) /
        2;

      if (
        lineY < -2 ||
        lineY > size.y + 2
      ) {
        continue;
      }

      ctx.moveTo(
        Math.max(
          0,
          left
        ),
        Math.round(
          lineY
        ) + 0.5
      );

      ctx.lineTo(
        Math.min(
          size.x,
          right
        ),
        Math.round(
          lineY
        ) + 0.5
      );
    }

    ctx.stroke();

    /*
       Внешняя рамка самого PNG.
    */
    ctx.strokeStyle =
      "rgba(255,255,255,0.55)";

    ctx.lineWidth =
      1.2;

    ctx.strokeRect(
      left + 0.5,
      top + 0.5,
      right - left,
      bottom - top
    );
  }

  /* =======================================================
     GRID — ENABLE / DISABLE
     ======================================================= */

  function setDMRLGridEnabled(
    enabled
  ) {
    dmrlGridEnabled =
      Boolean(
        enabled
      );

    updateDMRLGridButton();

    if (
      !window.map
    ) {
      return;
    }

    if (
      dmrlGridEnabled
    ) {
      createDMRLGridLayer();

      if (
        dmrlGridLayer &&
        !window.map.hasLayer(
          dmrlGridLayer
        )
      ) {
        dmrlGridLayer.addTo(
          window.map
        );
      }

      drawDMRLGrid();
    } else {
      if (
        dmrlGridCanvas
      ) {
        const ctx =
          dmrlGridCanvas.getContext(
            "2d"
          );

        if (ctx) {
          ctx.clearRect(
            0,
            0,
            dmrlGridCanvas.width,
            dmrlGridCanvas.height
          );
        }

        dmrlGridCanvas.style.display =
          "none";
      }
    }
  }

  /* =======================================================
     GRID — RESIZE
     ======================================================= */

  window.addEventListener(
    "resize",
    () => {
      if (
        dmrlGridEnabled
      ) {
        requestAnimationFrame(
          drawDMRLGrid
        );
      }
    }
  );

  /* =======================================================
     DARK BASEMAP — INVERTED LEAFLET
     ======================================================= */

  function enableDarkMap() {
    if (
      !window.map
    ) {
      return;
    }

    if (
      darkMapLayer
    ) {
      if (
        !window.map.hasLayer(
          darkMapLayer
        )
      ) {
        darkMapLayer.addTo(
          window.map
        );
      }

      return;
    }

    darkMapLayer =
      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            "© OpenStreetMap contributors",
          className:
            "clorad-inverted-leaflet"
        }
      );

    darkMapLayer.addTo(
      window.map
    );

    if (
      !document.getElementById(
        "clorad-inverted-leaflet-style"
      )
    ) {
      const style =
        document.createElement(
          "style"
        );

      style.id =
        "clorad-inverted-leaflet-style";

      style.textContent = `
        .clorad-inverted-leaflet {
          filter:
            invert(1)
            hue-rotate(180deg)
            brightness(.55)
            contrast(1.25);
        }
      `;

      document.head.appendChild(
        style
      );
    }
  }

  function disableDarkMap() {
    if (
      darkMapLayer &&
      window.map &&
      window.map.hasLayer(
        darkMapLayer
      )
    ) {
      window.map.removeLayer(
        darkMapLayer
      );
    }
  }

  /* =======================================================
     GIF STYLE
     ======================================================= */

  function installGIFStyle() {
    if (
      document.getElementById(
        "clorad-gif-style"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "clorad-gif-style";

    style.textContent = `
      .clorad-gif-radar-image {
        image-rendering:
          pixelated !important;
        image-rendering:
          crisp-edges !important;
        pointer-events:
          none !important;
        user-select:
          none !important;
        -webkit-user-drag:
          none !important;
        max-width:
          none !important;
        max-height:
          none !important;
      }

      .clorad-dmrl-grid-canvas {
        pointer-events:
          none !important;
        user-select:
          none !important;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     IMAGE PRELOAD
     ======================================================= */

  function loadImage(
    url
  ) {
    if (
      gifImageCache.has(
        url
      )
    ) {
      return gifImageCache.get(
        url
      );
    }

    const promise =
      new Promise(
        (
          resolve,
          reject
        ) => {
          const img =
            new Image();

          img.decoding =
            "async";

          img.onload =
            () => {
              resolve(
                img
              );
            };

          img.onerror =
            () => {
              gifImageCache.delete(
                url
              );

              reject(
                new Error(
                  "Не удалось загрузить ДМРЛ-кадр"
                )
              );
            };

          img.src =
            url;
        }
      );

    gifImageCache.set(
      url,
      promise
    );

    return promise;
  }

  /* =======================================================
     META
     ======================================================= */

  async function loadGIFMeta() {
    const response =
      await fetch(
        `${API}?mode=meta`,
        {
          method:
            "GET",
          cache:
            "no-store"
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        "GIF API: HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    if (
      !data ||
      !Number.isInteger(
        Number(data.frames)
      ) ||
      Number(data.frames) < 1
    ) {
      throw new Error(
        data?.message ||
        data?.error ||
        "GIF API вернул некорректные данные"
      );
    }

    gifMeta =
      data;

    return data;
  }

  /* =======================================================
     FRAME URLS
     ======================================================= */

  function buildFrameUrls(
    count
  ) {
    const result = [];

    for (
      let i = 0;
      i < count;
      i++
    ) {
      result.push(
        `${API}?frame=${i}&resolution=${gifResolution}`
      );
    }

    return result;
  }

  /* =======================================================
     REBUILD URLS
     ======================================================= */

  function rebuildFrameUrls() {
    if (!gifMeta) {
      return;
    }

    gifFrames =
      buildFrameUrls(
        Number(
          gifMeta.frames
        )
      );
  }

  /* =======================================================
     FRAME DELAYS
     ======================================================= */

  function buildGIFDelays(
    count,
    delays
  ) {
    const result = [];

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const value =
        Number(
          delays?.[i]
        );

      result.push(
        Number.isFinite(
          value
        ) &&
        value > 0
          ? value
          : 700
      );
    }

    return result;
  }

  /* =======================================================
     FRAME TIMES
     ======================================================= */

  function buildGIFTimes(
    count
  ) {
    const result = [];

    const newest =
      new Date();

    newest.setSeconds(
      0,
      0
    );

    newest.setMinutes(
      Math.floor(
        newest.getMinutes() /
        10
      ) * 10
    );

    const spanMinutes =
      180;

    const step =
      count > 1
        ? spanMinutes /
          (count - 1)
        : 0;

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const minutesAgo =
        spanMinutes -
        i * step;

      const date =
        new Date(
          newest.getTime() -
          minutesAgo *
          60000
        );

      result.push(
        date.toLocaleTimeString(
          "ru-RU",
          {
            hour:
              "2-digit",
            minute:
              "2-digit",
            timeZone:
              "Europe/Moscow"
          }
        )
      );
    }

    return result;
  }

  /* =======================================================
     TIMELINE
     ======================================================= */

  function updateGIFTimeline(
    index
  ) {
    if (
      !$("range")
    ) {
      return;
    }

    const count =
      gifFrames.length;

    $("range").min =
      0;

    $("range").max =
      Math.max(
        0,
        count - 1
      );

    $("range").value =
      index;

    const time =
      gifFrameTimes[index] ||
      "—";

    $("timeLabel").textContent =
      "ДМРЛ композит · " +
      time;

    $("times").innerHTML =
      "<span>" +
      (
        gifFrameTimes[0] ||
        "—"
      ) +
      "</span>" +
      "<span>" +
      (
        gifFrameTimes[
          gifFrameTimes.length - 1
        ] ||
        "—"
      ) +
      "</span>";

    $("framesInfo").textContent =
      "ДМРЛ композит • кадров: " +
      count;

    $("intensityValue").textContent =
      "радар";
  }

  /* =======================================================
     PRELOAD
     ======================================================= */

  function preloadGIFNeighbors(
    index
  ) {
    [
      index - 2,
      index - 1,
      index + 1,
      index + 2
    ]
      .filter(
        i =>
          i >= 0 &&
          i < gifFrames.length
      )
      .forEach(
        i => {
          loadImage(
            gifFrames[i]
          )
            .catch(
              () => {}
            );
        }
      );
  }

  /* =======================================================
     CREATE GIF OVERLAY
     ======================================================= */

  function createGIFLayer(
    url
  ) {
    const layer =
      L.imageOverlay(
        url,
        GIF_BOUNDS,
        {
          opacity:
            1,
          interactive:
            false,
          zIndex:
            6,
          className:
            "clorad-gif-radar-image"
        }
      );

    layer.addTo(
      window.map
    );

    return layer;
  }

  /* =======================================================
     SHOW FRAME
     ======================================================= */

  async function showGIFFrame(
    index
  ) {
    if (
      !gifActive ||
      !gifFrames.length
    ) {
      return;
    }

    index =
      Math.max(
        0,
        Math.min(
          Number(index),
          gifFrames.length - 1
        )
      );

    const requestId =
      ++gifFrameRequest;

    const url =
      gifFrames[index];

    try {
      await loadImage(
        url
      );

      if (
        !gifActive ||
        requestId !==
          gifFrameRequest
      ) {
        return;
      }

      if (
        !gifLayer
      ) {
        gifLayer =
          createGIFLayer(
            url
          );
      } else {
        gifLayer.setUrl(
          url
        );
      }

      gifLayer.setOpacity(
        1
      );

      gifLayer.bringToFront();

      updateGIFTimeline(
        index
      );

      preloadGIFNeighbors(
        index
      );

      if (
        dmrlGridEnabled &&
        dmrlGridLayer
      ) {
        dmrlGridLayer.bringToFront();
      }

    } catch (error) {
      console.error(
        "CLOrad GIF frame:",
        error
      );

      if (
        requestId ===
        gifFrameRequest
      ) {
        if (
          typeof msg ===
          "function"
        ) {
          msg(
            error?.message ||
            "Ошибка ДМРЛ-кадра"
          );
        }
      }

    } finally {
      if (
        requestId ===
        gifFrameRequest
      ) {
        hideLoading();
      }
    }
  }

  /* =======================================================
     ACTIVATE
     ======================================================= */

  async function activateGIF() {
    if (
      gifActive
    ) {
      return;
    }

    if (
      typeof window.CLOradStopRadar ===
      "function"
    ) {
      window.CLOradStopRadar();
    }

    gifActive =
      true;

    /*
       Тёмная карта только
       в режиме ДМРЛ.
    */
    enableDarkMap();

    setActiveNav(
      gifButton
    );

    showLoading();

    $("framesInfo").textContent =
      "Загрузка ДМРЛ композита…";

    $("timeLabel").textContent =
      "Загрузка ДМРЛ композита…";

    try {
      const meta =
        await loadGIFMeta();

      if (
        !gifActive
      ) {
        return;
      }

      gifMeta =
        meta;

      const count =
        Number(
          meta.frames
        );

      gifFrames =
        buildFrameUrls(
          count
        );

      gifFrameTimes =
        buildGIFTimes(
          count
        );

      gifFrameDelays =
        buildGIFDelays(
          count,
          meta.delays
        );

      /*
         После получения meta
         сетка сразу пересчитывается
         по реальному размеру растра.
      */
      if (
        dmrlGridEnabled
      ) {
        drawDMRLGrid();
      }

      const newestIndex =
        gifFrames.length - 1;

      await showGIFFrame(
        newestIndex
      );

    } catch (error) {
      console.error(
        "CLOrad GIF:",
        error
      );

      gifActive =
        false;

      disableDarkMap();

      if (
        gifLayer
      ) {
        if (
          window.map.hasLayer(
            gifLayer
          )
        ) {
          window.map.removeLayer(
            gifLayer
          );
        }

        gifLayer =
          null;
      }

      $("timeLabel").textContent =
        "Ошибка ДМРЛ композита";

      $("framesInfo").textContent =
        error?.message ||
        "Не удалось загрузить ДМРЛ";

      if (
        typeof msg ===
        "function"
      ) {
        msg(
          error?.message ||
          "Ошибка ДМРЛ композита"
        );
      }

    } finally {
      hideLoading();
    }
  }

  /* =======================================================
     DEACTIVATE
     ======================================================= */

  function deactivateGIF() {
    gifFrameRequest++;

    gifActive =
      false;

    stopGIFPlayback();

    if (
      gifLayer &&
      window.map &&
      window.map.hasLayer(
        gifLayer
      )
    ) {
      window.map.removeLayer(
        gifLayer
      );
    }

    gifLayer =
      null;

    gifFrames =
      [];

    gifFrameTimes =
      [];

    gifFrameDelays =
      [];

    gifMeta =
      null;

    gifImageCache.clear();

    /*
       Возвращаем карту.
    */
    disableDarkMap();

    if (
      dmrlGridLayer &&
      window.map &&
      window.map.hasLayer(
        dmrlGridLayer
      )
    ) {
      window.map.removeLayer(
        dmrlGridLayer
      );
    }

    if (
      $("range")
    ) {
      $("range").max =
        0;

      $("range").value =
        0;
    }

    if (
      $("times")
    ) {
      $("times").textContent =
        "";
    }

    if (
      $("timeLabel")
    ) {
      $("timeLabel").textContent =
        "Радар не подключён";
    }

    if (
      $("framesInfo")
    ) {
      $("framesInfo").textContent =
        "Радар пока не подключён";
    }

    if (
      $("intensityValue")
    ) {
      $("intensityValue").textContent =
        "Нет данных";
    }
  }

  /* =======================================================
     PLAY
     ======================================================= */

  function playGIF() {
    if (
      !gifActive ||
      !gifFrames.length
    ) {
      return;
    }

    if (
      gifPlaying
    ) {
      stopGIFPlayback();
      return;
    }

    gifPlaying =
      true;

    $("play").innerHTML =
      '<svg viewBox="0 0 24 24">' +
      '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' +
      '</svg>';

    const playNext =
      () => {
        if (
          !gifActive ||
          !gifPlaying
        ) {
          stopGIFPlayback();
          return;
        }

        let index =
          Number(
            $("range").value
          );

        index++;

        if (
          index >=
          gifFrames.length
        ) {
          index =
            0;
        }

        $("range").value =
          index;

        const delay =
          Number(
            gifFrameDelays[index]
          ) ||
          700;

        showGIFFrame(
          index
        );

        gifPlayTimer =
          setTimeout(
            playNext,
            delay
          );
      };

    const currentIndex =
      Number(
        $("range").value
      );

    const firstDelay =
      Number(
        gifFrameDelays[
          currentIndex
        ]
      ) ||
      700;

    gifPlayTimer =
      setTimeout(
        playNext,
        firstDelay
      );
  }

  function stopGIFPlayback() {
    gifPlaying =
      false;

    if (
      gifPlayTimer
    ) {
      clearTimeout(
        gifPlayTimer
      );
    }

    gifPlayTimer =
      null;

    if (
      $("play")
    ) {
      $("play").innerHTML =
        '<svg viewBox="0 0 24 24">' +
        '<path d="M7 4l13 8-13 8z"/>' +
        '</svg>';
    }
  }

  /* =======================================================
     GIF BUTTON
     ======================================================= */

  let gifButton =
    document.getElementById(
      "gifRadarNav"
    );

  if (
    !gifButton
  ) {
    gifButton =
      document.createElement(
        "button"
      );

    gifButton.className =
      "n";

    gifButton.id =
      "gifRadarNav";

    gifButton.innerHTML = `
      <svg viewBox="0 0 24 24">
        <rect
          x="4"
          y="4"
          width="16"
          height="16"
          rx="2"
        />

        <path
          d="M9 8v8l6-4z"
        />
      </svg>

      ДМРЛ композит
    `;

    const rainButton =
      $("rainProduct");

    if (
      rainButton
    ) {
      rainButton.after(
        gifButton
      );
    } else {
      const navElement =
        document.querySelector(
          ".nav"
        );

      navElement?.appendChild(
        gifButton
      );
    }

  } else {
    const textNodes =
      [];

    gifButton.childNodes
      .forEach(
        node => {
          if (
            node.nodeType ===
            Node.TEXT_NODE
          ) {
            textNodes.push(
              node
            );
          }
        }
      );

    textNodes.forEach(
      node => {
        node.textContent =
          node.textContent.replace(
            /GIF\s*радар/gi,
            "ДМРЛ композит"
          );
      }
    );
  }

  /* =======================================================
     ACTIVE NAV
     ======================================================= */

  function setActiveNav(
    button
  ) {
    document
      .querySelectorAll(
        ".n"
      )
      .forEach(
        item =>
          item.classList.remove(
            "active"
          )
      );

    if (
      button
    ) {
      button.classList.add(
        "active"
      );
    }
  }

  /* =======================================================
     RANGE
     ======================================================= */

  $("range")?.addEventListener(
    "input",
    () => {
      if (
        !gifActive
      ) {
        return;
      }

      showGIFFrame(
        Number(
          $("range").value
        )
      );
    }
  );

  /* =======================================================
     PLAY BUTTON
     ======================================================= */

  $("play")?.addEventListener(
    "click",
    event => {
      if (
        !gifActive
      ) {
        return;
      }

      event.stopImmediatePropagation();

      playGIF();
    },
    true
  );

  /* =======================================================
     GIF BUTTON
     ======================================================= */

  gifButton.addEventListener(
    "click",
    event => {
      event.stopPropagation();

      activateGIF();
    }
  );

  /* =======================================================
     NAV SWITCHING
     ======================================================= */

  const nav =
    document.querySelector(
      ".nav"
    );

  nav?.addEventListener(
    "click",
    event => {
      const button =
        event.target.closest(
          ".n"
        );

      if (
        !button
      ) {
        return;
      }

      if (
        button.id ===
        "layersNav"
      ) {
        return;
      }

      if (
        button ===
        gifButton
      ) {
        return;
      }

      deactivateGIF();
    },
    true
  );

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradDeactivateGIF =
    deactivateGIF;

  window.CLOradGIFActive =
    () =>
      gifActive;

  window.CLOradShowGIFFrame =
    showGIFFrame;

  window.CLOradPlayGIF =
    playGIF;

  window.CLOradSetDMRLGrid =
    setDMRLGridEnabled;

  window.CLOradDMRLGridActive =
    () =>
      dmrlGridEnabled;

  /* =======================================================
     INIT
     ======================================================= */

  installGIFStyle();

  installDMRLSettingsStyle();

  installGIFResolutionSetting();

  installDMRLGridSetting();

  if (
    !document.getElementById(
      "gifResolutionSetting"
    ) ||
    !document.getElementById(
      "dmrlGridSetting"
    )
  ) {
    const observer =
      new MutationObserver(
        () => {
          installGIFResolutionSetting();

          installDMRLGridSetting();

          if (
            document.getElementById(
              "gifResolutionSetting"
            ) &&
            document.getElementById(
              "dmrlGridSetting"
            )
          ) {
            observer.disconnect();
          }
        }
      );

    if (
      document.body
    ) {
      observer.observe(
        document.body,
        {
          childList:
            true,
          subtree:
            true
        }
      );
    }
  }

})()
