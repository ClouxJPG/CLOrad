/* =========================================================
   CLOrad — GIF Radar API

   Источник:
   https://meteoinfo.ru/hmc-output/rmap/phenomena.gif

   API:
   GET /api/radar-gif
      -> информация о кадрах

   GET /api/radar-gif?frame=0
      -> PNG выбранного кадра

   Старые кадры НЕ сохраняются на диске.
   ========================================================= */

const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";

/*
  Кэш только в памяти текущего serverless-инстанса.

  Он не является архивом:
  при смене/перезапуске инстанса старые данные исчезают.
*/

let gifCache = null;

const CACHE_TIME = 5 * 60 * 1000;

/* =========================================================
   Получение GIF
   ========================================================= */

async function downloadGIF() {
  const now = Date.now();

  if (
    gifCache &&
    gifCache.buffer &&
    now - gifCache.loadedAt < CACHE_TIME
  ) {
    return gifCache;
  }

  const response = await fetch(SOURCE_GIF, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 CLOrad Radar",
      "Accept":
        "image/gif,image/*;q=0.9,*/*;q=0.8"
    },

    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      `Meteoinfo GIF: HTTP ${response.status}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  const buffer = Buffer.from(arrayBuffer);

  /*
    Здесь намеренно не записываем GIF
    в /frames, /public или /tmp как постоянный файл.
  */

  gifCache = {
    buffer,
    loadedAt: now,
    version: String(now)
  };

  return gifCache;
}

/* =========================================================
   GIF parser
   ========================================================= */

/*
  Минимальный GIF89a parser с поддержкой:

  - GIF87a / GIF89a
  - global color table
  - local color table
  - LZW
  - interlacing
  - graphic control extension
  - transparency
  - disposal methods

  На выходе получаем RGBA-кадр.
*/

function readUint16(buffer, offset) {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8)
  );
}

function readColorTable(buffer, offset, size) {
  const table = [];

  for (let i = 0; i < size; i++) {
    const p = offset + i * 3;

    table.push([
      buffer[p],
      buffer[p + 1],
      buffer[p + 2]
    ]);
  }

  return table;
}

function readSubBlocks(buffer, state) {
  const chunks = [];

  while (state.offset < buffer.length) {
    const size = buffer[state.offset++];

    if (size === 0) {
      break;
    }

    chunks.push(
      buffer.subarray(
        state.offset,
        state.offset + size
      )
    );

    state.offset += size;
  }

  let total = 0;

  for (const chunk of chunks) {
    total += chunk.length;
  }

  const result = Buffer.alloc(total);

  let position = 0;

  for (const chunk of chunks) {
    chunk.copy(result, position);
    position += chunk.length;
  }

  return result;
}

/* =========================================================
   LZW decode
   ========================================================= */

function decodeLZW(data, minCodeSize, expected) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;

  let dictionary = [];

  function resetDictionary() {
    dictionary = [];

    for (let i = 0; i < clearCode; i++) {
      dictionary[i] = [i];
    }

    dictionary[clearCode] = null;
    dictionary[endCode] = null;

    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  }

  resetDictionary();

  let bitPosition = 0;

  function readCode() {
    let code = 0;

    for (let i = 0; i < codeSize; i++) {
      const byteIndex =
        bitPosition >> 3;

      const bitIndex =
        bitPosition & 7;

      if (byteIndex >= data.length) {
        return null;
      }

      const bit =
        (data[byteIndex] >> bitIndex) & 1;

      code |= bit << i;

      bitPosition++;
    }

    return code;
  }

  const output = [];

  let previous = null;

  while (output.length < expected) {
    const code = readCode();

    if (code === null) {
      break;
    }

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
      previous
    ) {
      entry = previous.concat(previous[0]);
    } else {
      break;
    }

    for (const value of entry) {
      output.push(value);

      if (output.length >= expected) {
        break;
      }
    }

    if (previous) {
      dictionary[nextCode] =
        previous.concat(entry[0]);

      nextCode++;

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

/* =========================================================
   PNG encoder
   ========================================================= */

function crc32(buffer) {
  let crc = 0xffffffff;

  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];

    for (let j = 0; j < 8; j++) {
      crc =
        (crc >>> 1) ^
        (0xedb88320 &
          -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer =
    Buffer.from(type, "ascii");

  const combined =
    Buffer.concat([
      typeBuffer,
      data
    ]);

  const chunk =
    Buffer.alloc(12 + data.length);

  chunk.writeUInt32BE(
    data.length,
    0
  );

  typeBuffer.copy(chunk, 4);

  data.copy(chunk, 8);

  chunk.writeUInt32BE(
    crc32(combined),
    8 + data.length
  );

  return chunk;
}

function rgbaToPNG(width, height, rgba) {
  const zlib = require("zlib");

  const raw = Buffer.alloc(
    height * (width * 4 + 1)
  );

  for (let y = 0; y < height; y++) {
    const rowStart =
      y * (width * 4 + 1);

    raw[rowStart] = 0;

    rgba.copy(
      raw,
      rowStart + 1,
      y * width * 4,
      (y + 1) * width * 4
    );
  }

  const compressed =
    zlib.deflateSync(raw, {
      level: 6
    });

  const signature = Buffer.from([
    137, 80, 78, 71,
    13, 10, 26, 10
  ]);

  const ihdr = Buffer.alloc(13);

  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);

  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,

    pngChunk("IHDR", ihdr),

    pngChunk("IDAT", compressed),

    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/* =========================================================
   GIF → RGBA frames
   ========================================================= */

function decodeGIF(buffer) {
  const header =
    buffer.toString(
      "ascii",
      0,
      6
    );

  if (
    header !== "GIF87a" &&
    header !== "GIF89a"
  ) {
    throw new Error(
      "Файл не является GIF."
    );
  }

  let offset = 6;

  const width =
    readUint16(buffer, offset);

  const height =
    readUint16(buffer, offset + 2);

  const packed =
    buffer[offset + 4];

  offset += 7;

  const globalColorTableFlag =
    !!(packed & 0x80);

  const globalColorTableSize =
    2 <<
    (packed & 0x07);

  let globalColorTable = null;

  if (globalColorTableFlag) {
    globalColorTable =
      readColorTable(
        buffer,
        offset,
        globalColorTableSize
      );

    offset +=
      globalColorTableSize * 3;
  }

  /*
    Фон текущего canvas.
  */

  let canvas =
    Buffer.alloc(
      width * height * 4
    );

  canvas.fill(0);

  const frames = [];

  let gce = {
    delay: 100,
    transparent: false,
    transparentIndex: 0,
    disposal: 0
  };

  while (offset < buffer.length) {
    const introducer =
      buffer[offset++];

    /*
      Trailer
    */

    if (introducer === 0x3b) {
      break;
    }

    /*
      Extension
    */

    if (introducer === 0x21) {
      const label =
        buffer[offset++];

      /*
        Graphic Control Extension
      */

      if (label === 0xf9) {
        const blockSize =
          buffer[offset++];

        if (blockSize === 4) {
          const packedGCE =
            buffer[offset++];

          const delay =
            readUint16(
              buffer,
              offset
            );

          offset += 2;

          const transparentIndex =
            buffer[offset++];

          offset++;

          gce = {
            delay:
              Math.max(
                20,
                delay * 10
              ),

            transparent:
              !!(
                packedGCE & 1
              ),

            transparentIndex,

            disposal:
              (packedGCE >> 2) & 7
          };
        } else {
          offset += blockSize;

          while (
            offset < buffer.length
          ) {
            const size =
              buffer[offset++];

            if (size === 0) break;

            offset += size;
          }
        }

        continue;
      }

      /*
        Остальные extensions
      */

      while (offset < buffer.length) {
        const size =
          buffer[offset++];

        if (size === 0) {
          break;
        }

        offset += size;
      }

      continue;
    }

    /*
      Image Descriptor
    */

    if (introducer === 0x2c) {
      const left =
        readUint16(buffer, offset);

      const top =
        readUint16(
          buffer,
          offset + 2
        );

      const frameWidth =
        readUint16(
          buffer,
          offset + 4
        );

      const frameHeight =
        readUint16(
          buffer,
          offset + 6
        );

      const imagePacked =
        buffer[offset + 8];

      offset += 9;

      const localColorTableFlag =
        !!(imagePacked & 0x80);

      const interlaced =
        !!(imagePacked & 0x40);

      const localColorTableSize =
        2 <<
        (imagePacked & 0x07);

      let colorTable =
        globalColorTable;

      if (localColorTableFlag) {
        colorTable =
          readColorTable(
            buffer,
            offset,
            localColorTableSize
          );

        offset +=
          localColorTableSize * 3;
      }

      const minCodeSize =
        buffer[offset++];

      const compressed =
        readSubBlocks(
          buffer,
          {
            get offset() {
              return offset;
            },

            set offset(value) {
              offset = value;
            }
          }
        );

      const pixelCount =
        frameWidth * frameHeight;

      let indices =
        decodeLZW(
          compressed,
          minCodeSize,
          pixelCount
        );

      /*
        Интерлейс.
      */

      if (interlaced) {
        const reordered =
          new Array(pixelCount);

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
            y < frameHeight;
            y += step
          ) {
            for (
              let x = 0;
              x < frameWidth;
              x++
            ) {
              reordered[
                y * frameWidth + x
              ] = indices[source++];
            }
          }
        }

        indices = reordered;
      }

      /*
        Сохраняем canvas до рисования,
        если disposal = 3.
      */

      const previousCanvas =
        gce.disposal === 3
          ? Buffer.from(canvas)
          : null;

      /*
        Рисуем кадр.
      */

      for (let y = 0; y < frameHeight; y++) {
        for (
          let x = 0;
          x < frameWidth;
          x++
        ) {
          const sourceIndex =
            y * frameWidth + x;

          const colorIndex =
            indices[sourceIndex];

          if (
            gce.transparent &&
            colorIndex ===
              gce.transparentIndex
          ) {
            continue;
          }

          const color =
            colorTable &&
            colorTable[colorIndex];

          if (!color) {
            continue;
          }

          const dx =
            left + x;

          const dy =
            top + y;

          if (
            dx < 0 ||
            dy < 0 ||
            dx >= width ||
            dy >= height
          ) {
            continue;
          }

          const destination =
            (dy * width + dx) * 4;

          canvas[destination] =
            color[0];

          canvas[destination + 1] =
            color[1];

          canvas[destination + 2] =
            color[2];

          canvas[destination + 3] =
            255;
        }
      }

      frames.push({
        width,
        height,
        rgba: Buffer.from(canvas),
        delay: gce.delay
      });

      /*
        Disposal.
      */

      if (gce.disposal === 2) {
        for (
          let y = top;
          y < top + frameHeight;
          y++
        ) {
          for (
            let x = left;
            x < left + frameWidth;
            x++
          ) {
            if (
              x < 0 ||
              y < 0 ||
              x >= width ||
              y >= height
            ) {
              continue;
            }

            const p =
              (y * width + x) * 4;

            canvas[p] = 0;
            canvas[p + 1] = 0;
            canvas[p + 2] = 0;
            canvas[p + 3] = 0;
          }
        }
      }

      if (
        gce.disposal === 3 &&
        previousCanvas
      ) {
        canvas = previousCanvas;
      }

      /*
        Graphic Control Extension относится
        только к следующему кадру.
      */

      gce = {
        delay: 100,
        transparent: false,
        transparentIndex: 0,
        disposal: 0
      };

      continue;
    }

    break;
  }

  return {
    width,
    height,
    frames
  };
}

/* =========================================================
   Получить декодированные GIF-данные
   ========================================================= */

function getDecodedGIF(buffer) {
  if (
    gifCache &&
    gifCache.decoded &&
    gifCache.buffer === buffer
  ) {
    return gifCache.decoded;
  }

  const decoded =
    decodeGIF(buffer);

  if (gifCache) {
    gifCache.decoded = decoded;
  }

  return decoded;
}

/* =========================================================
   Handler
   ========================================================= */

export default async function handler(req, res) {
  try {
    const cache = await downloadGIF();

    const gif =
      getDecodedGIF(cache.buffer);

    /*
      /api/radar-gif
    */

    if (
      req.method === "GET" &&
      req.query.frame === undefined
    ) {
      const frames =
        gif.frames.map(
          (frame, index) => ({
            index,

            time:
              `Кадр ${index + 1}`,

            delay:
              frame.delay
          })
        );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      res.status(200).json({
        source: SOURCE_GIF,

        width: gif.width,
        height: gif.height,

        version:
          cache.version,

        frames
      });

      return;
    }

    /*
      /api/radar-gif?frame=N
    */

    const index =
      Number(req.query.frame);

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= gif.frames.length
    ) {
      res.status(400).json({
        error: "Некорректный номер кадра."
      });

      return;
    }

    const frame =
      gif.frames[index];

    const png =
      rgbaToPNG(
        frame.width,
        frame.height,
        frame.rgba
      );

    res.setHeader(
      "Content-Type",
      "image/png"
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    res.setHeader(
      "Content-Length",
      String(png.length)
    );

    res.status(200).send(png);

  } catch (error) {
    console.error(
      "CLOrad radar-gif API:",
      error
    );

    res.status(500).json({
      error:
        "Не удалось обработать radar GIF.",
      message:
        error?.message ||
        String(error)
    });
  }
}
