/* =========================================================
   CLOrad — IDARKMETEO RASTER
   Универсальный обработчик кадров IDARKMETEO.

   Поддерживает:
   1. PNG
   2. TIFF/GeoTIFF
   3. Однобайтный индексный raster

   Индекс 0 = NODATA / прозрачный.
   Остальные индексы переводятся через palettes.json.
========================================================= */

(function () {
  "use strict";

  const API = "/api/idarkmeteo?path=";

  let palettesPromise = null;
  let activeObjectUrl = null;

  function api(path) {
    return API + encodeURIComponent(path);
  }

  /* -------------------------------------------------------
     Палитры
  ------------------------------------------------------- */

  async function getPalettes() {
    if (!palettesPromise) {
      palettesPromise = fetch(
        api("palettes.json"),
        {
          cache: "force-cache"
        }
      ).then(response => {
        if (!response.ok) {
          throw new Error(
            "palettes.json HTTP " +
            response.status
          );
        }

        return response.json();
      });
    }

    return palettesPromise;
  }

  function getPalette(data, product) {
    if (!data) {
      return null;
    }

    if (data[product]) {
      return data[product];
    }

    if (
      data.palettes &&
      data.palettes[product]
    ) {
      return data.palettes[product];
    }

    return null;
  }

  /* -------------------------------------------------------
     Поиск полосы палитры
  ------------------------------------------------------- */

  function findBand(bands, index) {
    for (const band of bands || []) {
      const lo =
        Number(band.lo_i);

      const hi =
        Number(band.hi_i);

      if (
        Number.isFinite(lo) &&
        Number.isFinite(hi) &&
        index >= lo &&
        index <= hi
      ) {
        return band;
      }
    }

    return null;
  }

  /* -------------------------------------------------------
     Индексный raster → Canvas
  ------------------------------------------------------- */

  function indexedRasterToCanvas(
    bytes,
    width,
    height,
    palette
  ) {
    const pixelsCount =
      width * height;

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error(
        "Некорректный размер raster: " +
        width +
        "×" +
        height
      );
    }

    if (
      bytes.length <
      pixelsCount
    ) {
      throw new Error(
        "Размер RDR меньше ожидаемого: " +
        bytes.length +
        " < " +
        pixelsCount
      );
    }

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = width;
    canvas.height = height;

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    const image =
      ctx.createImageData(
        width,
        height
      );

    const out =
      image.data;

    const bands =
      palette?.bands || [];

    for (
      let i = 0, p = 0;
      i < pixelsCount;
      i++, p += 4
    ) {
      const index =
        bytes[i];

      /*
         0 = прибор не смотрел.
         Это не «сухо».
      */

      if (index === 0) {
        out[p] = 0;
        out[p + 1] = 0;
        out[p + 2] = 0;
        out[p + 3] = 0;

        continue;
      }

      /*
         Ищем соответствующую
         полосу индексов.
      */

      const band =
        findBand(
          bands,
          index
        );

      if (
        !band ||
        !Array.isArray(
          band.rgb
        )
      ) {
        out[p] = 0;
        out[p + 1] = 0;
        out[p + 2] = 0;
        out[p + 3] = 0;

        continue;
      }

      out[p] =
        Number(
          band.rgb[0]
        ) || 0;

      out[p + 1] =
        Number(
          band.rgb[1]
        ) || 0;

      out[p + 2] =
        Number(
          band.rgb[2]
        ) || 0;

      out[p + 3] =
        Math.max(
          0,
          Math.min(
            255,
            Number(
              band.alpha ?? 255
            )
          )
        );
    }

    ctx.putImageData(
      image,
      0,
      0
    );

    return canvas;
  }

  /* -------------------------------------------------------
     Определение формата файла
  ------------------------------------------------------- */

  function detectFormat(bytes) {
    /*
       PNG:
       89 50 4E 47 0D 0A 1A 0A
    */

    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return "png";
    }

    /*
       TIFF little endian:
       II 2A 00
    */

    if (
      bytes.length >= 4 &&
      bytes[0] === 0x49 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x2a &&
      bytes[3] === 0x00
    ) {
      return "tiff";
    }

    /*
       TIFF big endian:
       MM 00 2A
    */

    if (
      bytes.length >= 4 &&
      bytes[0] === 0x4d &&
      bytes[1] === 0x4d &&
      bytes[2] === 0x00 &&
      bytes[3] === 0x2a
    ) {
      return "tiff";
    }

    return "indexed";
  }

  /* -------------------------------------------------------
     GeoTIFF
  ------------------------------------------------------- */

  async function decodeTiff(
    buffer,
    palette
  ) {
    const GeoTIFF =
      await import(
        "https://unpkg.com/geotiff@2.1.3/+esm"
      );

    const lib =
      GeoTIFF.default ||
      GeoTIFF;

    const tiff =
      await lib.fromArrayBuffer(
        buffer
      );

    const image =
      await tiff.getImage();

    const width =
      image.getWidth();

    const height =
      image.getHeight();

    const raster =
      await image.readRasters({
        interleave: true,
        samples: [0]
      });

    const bytes =
      raster instanceof Uint8Array
        ? raster
        : new Uint8Array(
            raster.buffer,
            raster.byteOffset,
            raster.byteLength
          );

    return indexedRasterToCanvas(
      bytes,
      width,
      height,
      palette
    );
  }

  /* -------------------------------------------------------
     Canvas → object URL
  ------------------------------------------------------- */

  async function canvasToUrl(
    canvas
  ) {
    const blob =
      await new Promise(
        resolve => {
          canvas.toBlob(
            resolve,
            "image/png"
          );
        }
      );

    if (!blob) {
      throw new Error(
        "Не удалось создать PNG"
      );
    }

    if (activeObjectUrl) {
      URL.revokeObjectURL(
        activeObjectUrl
      );
    }

    activeObjectUrl =
      URL.createObjectURL(
        blob
      );

    return activeObjectUrl;
  }

  /* -------------------------------------------------------
     Главная функция
  ------------------------------------------------------- */

  async function frameToImageUrl(
    path,
    product,
    width,
    height
  ) {
    if (!path) {
      throw new Error(
        "У кадра отсутствует path"
      );
    }

    /*
       Загружаем сам кадр.
    */

    const response =
      await fetch(
        api(path),
        {
          cache: "force-cache"
        }
      );

    if (!response.ok) {
      throw new Error(
        "Кадр HTTP " +
        response.status
      );
    }

    const buffer =
      await response.arrayBuffer();

    const bytes =
      new Uint8Array(
        buffer
      );

    if (!bytes.length) {
      throw new Error(
        "Кадр пустой"
      );
    }

    const format =
      detectFormat(bytes);

    console.log(
      "CLOrad IDARKMETEO:",
      path,
      "формат:",
      format,
      "размер:",
      bytes.length,
      "байт"
    );

    /*
       PNG можно сразу показать.
    */

    if (format === "png") {
      const blob =
        new Blob(
          [buffer],
          {
            type: "image/png"
          }
        );

      if (activeObjectUrl) {
        URL.revokeObjectURL(
          activeObjectUrl
        );
      }

      activeObjectUrl =
        URL.createObjectURL(
          blob
        );

      return activeObjectUrl;
    }

    /*
       Палитра нужна для
       индексного raster.
    */

    const palettes =
      await getPalettes();

    const palette =
      getPalette(
        palettes,
        product
      );

    if (!palette) {
      throw new Error(
        "Палитра отсутствует для продукта: " +
        product
      );
    }

    /*
       TIFF / GeoTIFF.
    */

    if (format === "tiff") {
      const canvas =
        await decodeTiff(
          buffer,
          palette
        );

      return canvasToUrl(
        canvas
      );
    }

    /*
       Если файл не PNG и не TIFF,
       рассматриваем его как
       однобайтный индексный raster.

       Размер берём из frames JSON.
    */

    const canvas =
      indexedRasterToCanvas(
        bytes,
        width,
        height,
        palette
      );

    return canvasToUrl(
      canvas
    );
  }

  window.CLOIdarkRaster = {
    frameToImageUrl
  };
})();
