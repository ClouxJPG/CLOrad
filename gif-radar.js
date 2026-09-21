// ============================================================
// CLOrad — Meteoinfo GIF Radar
// Полностью автономный GIF decoder
// Без npm / CDN / ImageDecoder
// ============================================================

(() => {

  const API = "/api/radar-gif";

  let gifFrames = [];
  let gifFrameIndex = 0;
  let gifLayer = null;
  let gifBounds = null;
  let gifLoaded = false;
  let gifLoading = false;

  // ------------------------------------------------------------
  // Создание кнопки GIF
  // ------------------------------------------------------------

  const rainButton = document.getElementById("rainProduct");

  if (!rainButton) {
    console.error("CLOrad GIF: rainProduct не найден");
    return;
  }

  const gifButton = document.createElement("button");

  gifButton.className = "n";
  gifButton.id = "gifRadar";
  gifButton.title = "Радар Meteoinfo";

  gifButton.innerHTML = `
    <span style="
      display:inline-flex;
      align-items:center;
      justify-content:center;
      width:16px;
      height:16px;
      font-size:13px;
      font-weight:700;
      line-height:1;
    ">▦</span>
    <span>GIF радар</span>
  `;

  rainButton.parentNode.insertBefore(
    gifButton,
    rainButton.nextSibling
  );


  // ------------------------------------------------------------
  // Общая активация кнопок
  // ------------------------------------------------------------

  function activateGIFButton() {

    document.querySelectorAll(".n").forEach(button => {
      button.classList.remove("active");
    });

    gifButton.classList.add("active");
  }


  // ------------------------------------------------------------
  // Отключение GIF при выборе обычного продукта
  // ------------------------------------------------------------

  function deactivateGIF() {

    gifButton.classList.remove("active");

    if (gifLayer && window.map) {
      try {
        window.map.removeLayer(gifLayer);
      } catch (e) {}
    }

    gifLayer = null;
  }


  // ------------------------------------------------------------
  // Подключаемся к существующим кнопкам CLOrad
  // ------------------------------------------------------------

  document.querySelectorAll(".n").forEach(button => {

    if (button === gifButton) return;

    button.addEventListener("click", () => {
      deactivateGIF();
    });

  });


  // ------------------------------------------------------------
  // GIF parser
  // ------------------------------------------------------------

  function readUint16(view, pos) {
    return view.getUint16(pos, true);
  }


  function readColorTable(view, pos, size) {

    const table = [];

    for (let i = 0; i < size; i++) {

      table.push([
        view.getUint8(pos++),
        view.getUint8(pos++),
        view.getUint8(pos++)
      ]);

    }

    return {
      table,
      pos
    };
  }


  // ------------------------------------------------------------
  // Sub-block reader
  // ------------------------------------------------------------

  function readSubBlocks(view, pos) {

    const chunks = [];
    let total = 0;

    while (true) {

      const size = view.getUint8(pos++);

      if (size === 0) break;

      const chunk = new Uint8Array(
        view.buffer,
        view.byteOffset + pos,
        size
      );

      chunks.push(chunk);
      total += size;

      pos += size;
    }

    const data = new Uint8Array(total);

    let offset = 0;

    for (const chunk of chunks) {

      data.set(chunk, offset);
      offset += chunk.length;

    }

    return {
      data,
      pos
    };
  }


  // ------------------------------------------------------------
  // GIF LZW decoder
  // ------------------------------------------------------------

  function decodeLZW(data, minCodeSize, expectedSize) {

    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;

    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;

    let bitPos = 0;

    const dictionary = [];

    function resetDictionary() {

      dictionary.length = 0;

      for (let i = 0; i < clearCode; i++) {
        dictionary[i] = [i];
      }

      dictionary[clearCode] = null;
      dictionary[endCode] = null;

      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    }

    function readCode() {

      let code = 0;

      for (let i = 0; i < codeSize; i++) {

        const byteIndex = bitPos >> 3;
        const bitIndex = bitPos & 7;

        if (byteIndex >= data.length) {
          return null;
        }

        const bit =
          (data[byteIndex] >> bitIndex) & 1;

        code |= bit << i;

        bitPos++;

      }

      return code;
    }

    resetDictionary();

    const output = new Uint8Array(expectedSize);

    let outputPos = 0;
    let previous = null;

    while (outputPos < expectedSize) {

      const code = readCode();

      if (code === null) break;

      if (code === clearCode) {

        resetDictionary();
        previous = null;
        continue;
      }

      if (code === endCode) {
        break;
      }

      let entry;

      if (dictionary[code]) {

        entry = dictionary[code];

      } else if (
        code === nextCode &&
        previous !== null
      ) {

        entry = previous.concat(previous[0]);

      } else {

        break;
      }

      for (let i = 0; i < entry.length; i++) {

        if (outputPos >= expectedSize) break;

        output[outputPos++] = entry[i];

      }

      if (
        previous !== null &&
        nextCode < 4096
      ) {

        dictionary[nextCode++] =
          previous.concat(entry[0]);

        if (
          nextCode === (1 << codeSize) &&
          codeSize < 12
        ) {

          codeSize++;

        }

      }

      previous = entry;
    }

    return output;
  }


  // ------------------------------------------------------------
  // Interlaced GIF
  // ------------------------------------------------------------

  function deinterlace(
    pixels,
    width,
    height
  ) {

    const result = new Uint8Array(
      width * height
    );

    let source = 0;

    const passes = [
      [0, 8],
      [4, 8],
      [2, 4],
      [1, 2]
    ];

    for (const [start, step] of passes) {

      for (
        let y = start;
        y < height;
        y += step
      ) {

        const rowStart = y * width;

        for (let x = 0; x < width; x++) {

          result[rowStart + x] =
            pixels[source++];

        }

      }

    }

    return result;
  }


  // ------------------------------------------------------------
  // GIF parser
  // ------------------------------------------------------------

  function parseGIF(buffer) {

    const view = new DataView(buffer);

    let pos = 0;

    // Header
    const signature =
      String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2)
      );

    if (signature !== "GIF") {
      throw new Error("Это не GIF");
    }

    pos += 6;

    const width = readUint16(view, pos);
    pos += 2;

    const height = readUint16(view, pos);
    pos += 2;

    const packed = view.getUint8(pos++);

    const backgroundColorIndex =
      view.getUint8(pos++);

    pos++;

    const globalColorFlag =
      (packed & 0x80) !== 0;

    const globalColorSize =
      2 << (packed & 7);

    let globalColorTable = null;

    if (globalColorFlag) {

      const result = readColorTable(
        view,
        pos,
        globalColorSize
      );

      globalColorTable = result.table;
      pos = result.pos;
    }

    const frames = [];

    let gce = {
      disposal: 0,
      transparent: false,
      transparentIndex: 0,
      delay: 0
    };


    while (pos < view.byteLength) {

      const block = view.getUint8(pos++);

      // Trailer
      if (block === 0x3B) {
        break;
      }


      // Extension
      if (block === 0x21) {

        const label = view.getUint8(pos++);

        // Graphic Control Extension
        if (label === 0xF9) {

          const size = view.getUint8(pos++);

          if (size !== 4) {
            pos += size;
            continue;
          }

          const gcePacked =
            view.getUint8(pos++);

          const delay =
            readUint16(view, pos);

          pos += 2;

          const transparentIndex =
            view.getUint8(pos++);

          pos++;

          gce = {
            disposal:
              (gcePacked >> 2) & 7,

            transparent:
              (gcePacked & 1) !== 0,

            transparentIndex,

            delay
          };

        } else {

          // Other extension:
          // skip sub-blocks
          const result =
            readSubBlocks(view, pos);

          pos = result.pos;
        }

        continue;
      }


      // Image Descriptor
      if (block === 0x2C) {

        const left = readUint16(view, pos);
        pos += 2;

        const top = readUint16(view, pos);
        pos += 2;

        const frameWidth =
          readUint16(view, pos);

        pos += 2;

        const frameHeight =
          readUint16(view, pos);

        pos += 2;

        const imagePacked =
          view.getUint8(pos++);

        const localColorFlag =
          (imagePacked & 0x80) !== 0;

        const interlaced =
          (imagePacked & 0x40) !== 0;

        const localColorSize =
          2 << (imagePacked & 7);

        let colorTable =
          globalColorTable;

        if (localColorFlag) {

          const result =
            readColorTable(
              view,
              pos,
              localColorSize
            );

          colorTable = result.table;
          pos = result.pos;
        }

        const minCodeSize =
          view.getUint8(pos++);

        const result =
          readSubBlocks(view, pos);

        pos = result.pos;

        let indices = decodeLZW(
          result.data,
          minCodeSize,
          frameWidth * frameHeight
        );

        if (interlaced) {

          indices = deinterlace(
            indices,
            frameWidth,
            frameHeight
          );

        }

        frames.push({
          left,
          top,
          width: frameWidth,
          height: frameHeight,
          indices,
          colorTable,
          transparent:
            gce.transparent,

          transparentIndex:
            gce.transparentIndex,

          disposal:
            gce.disposal,

          delay:
            gce.delay
        });


        // GCE applies only to next frame
        gce = {
          disposal: 0,
          transparent: false,
          transparentIndex: 0,
          delay: 0
        };

        continue;
      }


      // Unknown block
      throw new Error(
        "Неизвестный GIF блок: 0x" +
        block.toString(16)
      );
    }

    return {
      width,
      height,
      frames,
      backgroundColorIndex
    };
  }


  // ------------------------------------------------------------
  // Создание Canvas кадров
  // ------------------------------------------------------------

  function renderFrames(gif) {

    const canvas =
      document.createElement("canvas");

    canvas.width = gif.width;
    canvas.height = gif.height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true
      });

    const result = [];

    // Начальный прозрачный кадр
    ctx.clearRect(
      0,
      0,
      gif.width,
      gif.height
    );


    for (
      let frameIndex = 0;
      frameIndex < gif.frames.length;
      frameIndex++
    ) {

      const frame =
        gif.frames[frameIndex];

      const beforeFrame =
        ctx.getImageData(
          0,
          0,
          gif.width,
          gif.height
        );

      const imageData =
        ctx.createImageData(
          frame.width,
          frame.height
        );

      const data =
        imageData.data;


      for (
        let i = 0;
        i < frame.indices.length;
        i++
      ) {

        const colorIndex =
          frame.indices[i];

        const target =
          i * 4;

        if (
          frame.transparent &&
          colorIndex === frame.transparentIndex
        ) {

          data[target] = 0;
          data[target + 1] = 0;
          data[target + 2] = 0;
          data[target + 3] = 0;

          continue;
        }

        const color =
          frame.colorTable?.[colorIndex];

        if (!color) {

          data[target] = 0;
          data[target + 1] = 0;
          data[target + 2] = 0;
          data[target + 3] = 0;

        } else {

          data[target] = color[0];
          data[target + 1] = color[1];
          data[target + 2] = color[2];
          data[target + 3] = 255;
        }
      }


      ctx.putImageData(
        imageData,
        frame.left,
        frame.top
      );


      // Сохраняем полный кадр
      const fullFrame =
        document.createElement("canvas");

      fullFrame.width = gif.width;
      fullFrame.height = gif.height;

      fullFrame
        .getContext("2d")
        .drawImage(canvas, 0, 0);

      result.push({
        canvas: fullFrame,
        delay: frame.delay
      });


      // Обработка disposal
      if (frame.disposal === 2) {

        // Restore to background
        ctx.clearRect(
          frame.left,
          frame.top,
          frame.width,
          frame.height
        );

      } else if (frame.disposal === 3) {

        // Restore previous
        ctx.putImageData(
          beforeFrame,
          0,
          0
        );
      }
    }

    return result;
  }


  // ------------------------------------------------------------
  // Загрузка GIF
  // ------------------------------------------------------------

  async function loadGIF() {

    if (gifLoading) return;

    gifLoading = true;

    try {

      msg("Загрузка GIF радара…");

      const response =
        await fetch(API, {
          cache: "no-store"
        });

      if (!response.ok) {

        throw new Error(
          "GIF API HTTP " +
          response.status
        );
      }

      const buffer =
        await response.arrayBuffer();

      if (!buffer.byteLength) {
        throw new Error("GIF пустой");
      }

      msg("Разбор кадров GIF…");

      const gif =
        parseGIF(buffer);

      if (!gif.frames.length) {
        throw new Error("В GIF нет кадров");
      }

      gifFrames =
        renderFrames(gif);

      gifFrameIndex =
        gifFrames.length - 1;

      gifLoaded = true;

      msg(
        "GIF радар: " +
        gifFrames.length +
        " кадров"
      );

      // Показываем самый свежий
      showGIFFrame(gifFrameIndex);

    } catch (error) {

      console.error(
        "CLOrad GIF error:",
        error
      );

      msg(
        "Ошибка GIF: " +
        (error?.message || error)
      );

    } finally {

      gifLoading = false;
    }
  }


  // ------------------------------------------------------------
  // Показ кадра
  // ------------------------------------------------------------

  function showGIFFrame(index) {

    if (!gifFrames.length) return;

    index = Math.max(
      0,
      Math.min(
        gifFrames.length - 1,
        index
      )
    );

    gifFrameIndex = index;

    const frame =
      gifFrames[index];

    if (!window.map) {
      console.error(
        "CLOrad GIF: map не найден"
      );
      return;
    }


    if (!gifBounds) {

      // Если у Meteoinfo нет геопривязки
      // в самом GIF, используем область России,
      // которую затем можно скорректировать.

      gifBounds =
        [
          [35, 20],
          [75, 180]
        ];
    }


    const image =
      frame.canvas.toDataURL(
        "image/png"
      );


    if (gifLayer) {

      gifLayer.setUrl(image);
      gifLayer.setBounds(gifBounds);

    } else {

      gifLayer =
        L.imageOverlay(
          image,
          gifBounds,
          {
            opacity: 0.82,
            interactive: false,
            zIndex: 500
          }
        ).addTo(window.map);

    }
  }


  // ------------------------------------------------------------
  // Кнопка GIF
  // ------------------------------------------------------------

  gifButton.addEventListener(
    "click",
    async event => {

      event.stopPropagation();

      activateGIFButton();

      // Если GIF ещё не загружен
      if (!gifLoaded) {

        await loadGIF();

        return;
      }

      showGIFFrame(
        gifFrameIndex
      );
    }
  );


  // ------------------------------------------------------------
  // Экспорт для существующего таймлайна
  // ------------------------------------------------------------

  window.CLOradGIF = {

    isActive() {
      return gifButton.classList.contains("active");
    },

    getFrames() {
      return gifFrames;
    },

    getFrameCount() {
      return gifFrames.length;
    },

    getCurrentFrame() {
      return gifFrameIndex;
    },

    showFrame(index) {

      if (
        !gifButton.classList.contains("active")
      ) {
        return;
      }

      showGIFFrame(index);
    },

    deactivate() {
      deactivateGIF();
    }

  };


  // ------------------------------------------------------------
  // Дополнительное управление существующим таймлайном
  // ------------------------------------------------------------

  // Если CLOrad вызывает это событие,
  // GIF сможет реагировать на изменение кадра.
  window.addEventListener(
    "clorad:timeline",
    event => {

      if (
        !gifButton.classList.contains("active")
      ) {
        return;
      }

      const index =
        Number(
          event.detail?.index
        );

      if (
        Number.isFinite(index)
      ) {

        showGIFFrame(index);
      }

    }
  );


})();
