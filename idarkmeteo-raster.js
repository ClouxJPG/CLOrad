/* =========================================================
   CLOrad — IDARKMETEO RASTER
   Рендер индексного .rdr/GeoTIFF в Canvas.
   Сначала пробуем соответствующий PNG.
   Индекс 0 = прозрачный / NODATA.
========================================================= */

(function () {
  "use strict";

  const API = "/api/idarkmeteo?path=";
  let palettePromise = null;
  let geoTiffPromise = null;
  let activeUrl = null;

  function api(path) {
    return API + encodeURIComponent(path);
  }

  async function loadPalette(product) {
    if (!palettePromise) {
      palettePromise = fetch(api("palettes.json"), {
        cache: "force-cache"
      }).then(r => {
        if (!r.ok) {
          throw new Error("palettes.json: HTTP " + r.status);
        }
        return r.json();
      });
    }

    const all = await palettePromise;

    return (
      all?.[product] ||
      all?.palettes?.[product] ||
      null
    );
  }

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

  function makeCanvas(values, width, height, palette) {
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");

    const imageData = ctx.createImageData(
      width,
      height
    );

    const out = imageData.data;
    const bands = palette?.bands || [];

    for (
      let i = 0, p = 0;
      i < values.length;
      i++, p += 4
    ) {
      const index = Number(values[i]);

      /*
         0 = GDAL_NODATA / нет наблюдения
      */

      if (
        !Number.isFinite(index) ||
        index === 0
      ) {
        out[p + 3] = 0;
        continue;
      }

      const band = findBand(
        bands,
        index
      );

      if (
        !band ||
        !Array.isArray(band.rgb)
      ) {
        out[p + 3] = 0;
        continue;
      }

      out[p] =
        Number(band.rgb[0]) || 0;

      out[p + 1] =
        Number(band.rgb[1]) || 0;

      out[p + 2] =
        Number(band.rgb[2]) || 0;

      out[p + 3] = Math.max(
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
      imageData,
      0,
      0
    );

    return canvas;
  }

  async function loadGeoTiff() {
    if (!geoTiffPromise) {
      geoTiffPromise =
        import(
          "https://unpkg.com/geotiff@2.1.3/+esm"
        )
          .then(
            mod =>
              mod.default || mod
          )
          .catch(error => {
            geoTiffPromise = null;
            throw error;
          });
    }

    return geoTiffPromise;
  }

  async function renderRdr(
    arrayBuffer,
    palette
  ) {
    const GeoTIFF =
      await loadGeoTiff();

    const tiff =
      await GeoTIFF.fromArrayBuffer(
        arrayBuffer
      );

    const image =
      await tiff.getImage();

    const width =
      image.getWidth();

    const height =
      image.getHeight();

    const values =
      await image.readRasters({
        interleave: true,
        samples: [0]
      });

    return makeCanvas(
      values,
      width,
      height,
      palette
    );
  }

  async function pngExists(url) {
    try {
      const response =
        await fetch(url, {
          method: "HEAD",
          cache: "force-cache"
        });

      return response.ok;
    } catch {
      return false;
    }
  }

  async function frameToImageUrl(
    path,
    product
  ) {
    if (activeUrl) {
      URL.revokeObjectURL(
        activeUrl
      );

      activeUrl = null;
    }

    /*
       Если для .rdr существует
       соответствующий .png —
       используем PNG напрямую.
    */

    const pngPath =
      path.replace(
        /\.rdr$/i,
        ".png"
      );

    const pngUrl =
      api(pngPath);

    if (
      await pngExists(pngUrl)
    ) {
      return pngUrl;
    }

    /*
       Иначе загружаем raster.
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
        "Raster: HTTP " +
        response.status
      );
    }

    const buffer =
      await response.arrayBuffer();

    const palette =
      await loadPalette(product);

    const canvas =
      await renderRdr(
        buffer,
        palette
      );

    const blob =
      await new Promise(resolve =>
        canvas.toBlob(
          resolve,
          "image/png"
        )
      );

    if (!blob) {
      throw new Error(
        "Не удалось создать PNG из raster"
      );
    }

    activeUrl =
      URL.createObjectURL(blob);

    return activeUrl;
  }

  window.CLOIdarkRaster = {
    frameToImageUrl
  };
})();
