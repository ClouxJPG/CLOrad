/* =========================================================
   CLOrad — IDARKMETEO RASTER
   Преобразование индексного .rdr в PNG через Canvas.

   Формат:
   - 1 байт = 1 пиксель
   - 0 = NODATA / прозрачный
   - остальные значения = индексы палитры
========================================================= */

(function () {
  "use strict";

  const API = "/api/idarkmeteo?path=";

  let palettePromise = null;
  let activeUrl = null;

  function api(path) {
    return API + encodeURIComponent(path);
  }

  /* -------------------------------------------------------
     Загрузка палитр
  ------------------------------------------------------- */

  async function loadPalettes() {
    if (!palettePromise) {
      palettePromise = fetch(
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

    return palettePromise;
  }

  function getPalette(all, product) {
    if (!all) {
      return null;
    }

    if (all[product]) {
      return all[product];
    }

    if (
      all.palettes &&
      all.palettes[product]
    ) {
      return all.palettes[product];
    }

    return null;
  }

  /* -------------------------------------------------------
     Поиск цвета по индексу
  ------------------------------------------------------- */

  function findBand(bands, index) {
    for (const band of bands || []) {
      const lo = Number(band.lo_i);
      const hi = Number(band.hi_i);

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
     Создание изображения
  ------------------------------------------------------- */

  function rasterToCanvas(
    bytes,
    width,
    height,
    palette
  ) {
    const expected =
      width * height;

    if (bytes.length < expected) {
      throw new Error(
        "RDR слишком маленький: " +
        bytes.length +
        " байт, ожидалось " +
        expected
      );
    }

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = width;
    canvas.height = height;

    const ctx =
      canvas.getContext(
        "2d"
      );

    if (!ctx) {
      throw new Error(
        "Canvas недоступен"
      );
    }

    const image =
      ctx.createImageData(
        width,
        height
      );

    const pixels =
      image.data;

    const bands =
      palette?.bands || [];

    for (
      let i = 0, p = 0;
      i < expected;
      i++, p += 4
    ) {
      const index =
        bytes[i];

      /*
         0 = нет данных / NODATA
      */

      if (index === 0) {
        pixels[p] = 0;
        pixels[p + 1] = 0;
        pixels[p + 2] = 0;
        pixels[p + 3] = 0;

        continue;
      }

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
        pixels[p] = 0;
        pixels[p + 1] = 0;
        pixels[p + 2] = 0;
        pixels[p + 3] = 0;

        continue;
      }

      pixels[p] =
        Number(
          band.rgb[0]
        ) || 0;

      pixels[p + 1] =
        Number(
          band.rgb[1]
        ) || 0;

      pixels[p + 2] =
        Number(
          band.rgb[2]
        ) || 0;

      pixels[p + 3] =
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
     PNG → если существует, используем его напрямую
  ------------------------------------------------------- */

  async function pngExists(url) {
    try {
      const response =
        await fetch(
          url,
          {
            method: "HEAD",
            cache: "force-cache"
          }
        );

      return response.ok;

    } catch {
      return false;
    }
  }

  /* -------------------------------------------------------
     .rdr → PNG
  ------------------------------------------------------- */

  async function renderRdr(
    path,
    product,
    width,
    height
  ) {
    const response =
      await fetch(
        api(path),
        {
          cache: "force-cache"
        }
      );

    if (!response.ok) {
      throw new Error(
        "RDR HTTP " +
        response.status
      );
    }

    const buffer =
      await response.arrayBuffer();

    const bytes =
      new Uint8Array(
        buffer
      );

    const all =
      await loadPalettes();

    const palette =
      getPalette(
        all,
        product
      );

    if (!palette) {
      throw new Error(
        "Палитра не найдена: " +
        product
      );
    }

    const canvas =
      rasterToCanvas(
        bytes,
        width,
        height,
        palette
      );

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
        "Canvas не смог создать PNG"
      );
    }

    if (activeUrl) {
      URL.revokeObjectURL(
        activeUrl
      );
    }

    activeUrl =
      URL.createObjectURL(
        blob
      );

    return activeUrl;
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
    /*
       Сначала пробуем PNG.
    */

    const pngPath =
      path.replace(
        /\.rdr$/i,
        ".png"
      );

    const pngUrl =
      api(pngPath);

    if (
      await pngExists(
        pngUrl
      )
    ) {
      return pngUrl;
    }

    /*
       Если PNG нет —
       декодируем .rdr.
    */

    return renderRdr(
      path,
      product,
      width,
      height
    );
  }

  window.CLOIdarkRaster = {
    frameToImageUrl
  };
})();
