/* =========================================================
   CLOrad — Meteoinfo GIF Radar
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
  /*
     Разрешение ДМРЛ.
     1×1 — максимальное качество
     2×2
     4×4
     По умолчанию 1×1.
  */
  let gifResolution = 1;
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
     ДМРЛ — НАСТРОЙКИ
     ======================================================= */
  function installGIFResolutionSetting() {
    const settings =
      document.getElementById("settings");
    if (!settings) {
      return;
    }
    /*
       Если пункт уже существует —
       второй раз не создаём.
    */
    if (
      document.getElementById(
        "gifResolutionSetting"
      )
    ) {
      return;
    }
    const setting =
      document.createElement("div");
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
    /*
       Добавляем после существующего
       пункта «Кол. кадров».
    */
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
    /* =====================================================
       STYLE
       ===================================================== */
    if (
      !document.getElementById(
        "clorad-dmrl-resolution-style"
      )
    ) {
      const style =
        document.createElement("style");
      style.id =
        "clorad-dmrl-resolution-style";
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
      `;
      document.head.appendChild(
        style
      );
    }
    /* =====================================================
       HEAD
       ===================================================== */
    const head =
      document.getElementById(
        "gifResolutionHead"
      );
    const body =
      document.getElementById(
        "gifResolutionBody"
      );
    if (head && body) {
      head.addEventListener(
        "click",
        event => {
          event.stopPropagation();
          const isOpen =
            setting.classList.contains(
              "open"
            );
          /*
             Закрываем остальные
             настройки.
          */
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
    /* =====================================================
       OPTIONS
       ===================================================== */
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
                value !== 1 &&
                value !== 2 &&
                value !== 4
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
    /*
       Применяем текущее значение.
    */
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
     RESOLUTION
     ======================================================= */
  function setGIFResolution(
    value
  ) {
    if (
      value !== 1 &&
      value !== 2 &&
      value !== 4
    ) {
      value = 1;
    }
    gifResolution =
      value;
    updateGIFResolutionButtons();
    /*
       Если GIF уже открыт —
       запрашиваем текущий кадр
       в новом разрешении.
    */
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
     STYLE
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
        Number.isFinite(value) &&
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
     CREATE OVERLAY
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
    } catch (error) {
      console.error(
        "CLOrad GIF frame:",
        error
      );
      if (
        requestId ===
        gifFrameRequest
      ) {
        msg(
          error?.message ||
          "Ошибка ДМРЛ-кадра"
        );
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
    /*
       Останавливаем другие
       радарные режимы.
    */
    if (
      typeof window.CLOradStopRadar ===
      "function"
    ) {
      window.CLOradStopRadar();
    }
    gifActive =
      true;
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
      msg(
        error?.message ||
        "Ошибка ДМРЛ композита"
      );
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
          ) || 700;
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
        gifFrameDelays[currentIndex]
      ) || 700;
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
     EXISTING GIF BUTTON
     ======================================================= */
  let gifButton =
    document.getElementById(
      "gifRadarNav"
    );
  /*
     Если кнопки ещё нет —
     создаём её автоматически.
  */
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
        <path d="M9 8v8l6-4z"/>
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
    /*
       Гарантируем правильное
       название обычной кнопки.
    */
    const textNodes = [];
    gifButton.childNodes.forEach(
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
  /* =======================================================
     INIT
     ======================================================= */
  installGIFStyle();
  /*
     Устанавливаем пункт
     «Разрешение ДМРЛ»
     в Настройки.
     Если settings появляется
     немного позже — наблюдаем
     за DOM.
  */
  installGIFResolutionSetting();
  if (
    !document.getElementById(
      "gifResolutionSetting"
    )
  ) {
    const observer =
      new MutationObserver(
        () => {
          installGIFResolutionSetting();
          if (
            document.getElementById(
              "gifResolutionSetting"
            )
          ) {
            observer.disconnect();
          }
        }
      );
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
})();
