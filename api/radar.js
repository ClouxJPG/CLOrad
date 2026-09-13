// api/radar.js

const NOWCAST =
  "https://www.nowcast.ru";

const IDARK =
  "https://idarkmeteo.host/api/v1";

export default async function handler(req, res) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({
      error: "method_not_allowed"
    });
    return;
  }

  const action =
    String(
      req.query?.action || ""
    ).toLowerCase();


  /*
   * =========================================
   * NOWCAST — ВРЕМЕНА
   * =========================================
   */

  if (action === "nowcast-times") {

    try {

      const url =
        NOWCAST +
        "/baltrad_wsgi" +
        "?SERVICE=WMS" +
        "&VERSION=1.1.1" +
        "&REQUEST=GetCapabilities";

      const response =
        await fetch(url, {
          headers: {
            "Accept":
              "application/xml,text/xml,*/*"
          }
        });

      if (!response.ok) {

        throw new Error(
          "HTTP " +
          response.status
        );
      }

      const xml =
        await response.text();

      const times =
        extractTimes(xml);

      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=60"
      );

      res.status(200).json({
        source: "nowcast",
        layer: "bufr_dbz1",
        count: times.length,
        times
      });

      return;

    } catch (error) {

      console.error(
        "Nowcast capabilities error:",
        error
      );

      /*
       * Резерв:
       * генерируем последние 24 часа
       * с шагом 10 минут.
       *
       * Если сам Nowcast временно не отдаёт
       * capabilities, сайт всё равно сможет
       * попытаться получить кадры.
       */

      const fallback =
        makeFallbackTimes(144);

      res.status(200).json({
        source: "nowcast",
        layer: "bufr_dbz1",
        fallback: true,
        count: fallback.length,
        times: fallback
      });

      return;
    }
  }


  /*
   * =========================================
   * NOWCAST — ОДИН КАДР ОТРАЖАЕМОСТИ
   * =========================================
   */

  if (action === "nowcast") {

    const time =
      String(
        req.query?.time || ""
      );

    if (!time) {

      res.status(400).json({
        error: "missing_time"
      });

      return;
    }

    try {

      const url =
        NOWCAST +
        "/vector_wsgi" +
        "?time=" +
        encodeURIComponent(time) +
        "&title=bufr_dbz1";

      const response =
        await fetch(url, {
          headers: {
            "Accept":
              "application/json"
          }
        });

      const text =
        await response.text();

      if (!response.ok) {

        res.status(
          response.status
        );

        res.setHeader(
          "Content-Type",
          "application/json"
        );

        res.send(text);

        return;
      }

      let data;

      try {

        data =
          JSON.parse(text);

      } catch {

        res.status(502).json({
          error:
            "invalid_nowcast_response"
        });

        return;
      }

      res.setHeader(
        "Cache-Control",
        "public, max-age=600, s-maxage=600"
      );

      res.status(200).json({
        time,
        title: "bufr_dbz1",
        data
      });

      return;

    } catch (error) {

      console.error(
        "Nowcast frame error:",
        error
      );

      res.status(502).json({
        error:
          "nowcast_unavailable"
      });

      return;
    }
  }


  /*
   * =========================================
   * IDARKMETEO — СТАРЫЕ ENDPOINTS
   * =========================================
   *
   * Оставляем их, чтобы существующий
   * Vercel API не сломался.
   */

  if (
    action === "frames" ||
    action === "rain" ||
    action === "rainfine" ||
    action === "phenomena" ||
    action === "palette" ||
    action === "latest" ||
    action === "manifest"
  ) {

    const KEY =
      process.env.IDARKMETEO_KEY;

    if (!KEY) {

      res.status(500).json({
        error:
          "server_config_error",
        message:
          "IDARKMETEO_KEY is not configured"
      });

      return;
    }

    const endpoints = {

      frames:
        "/frames.json",

      rain:
        "/frames/rain/wide.json",

      rainfine:
        "/frames/rain/fine.json",

      phenomena:
        "/frames/phenomena/dmrl.json",

      palette:
        "/palettes.json",

      latest:
        "/latest.json",

      manifest:
        "/manifest.json"

    };

    const path =
      endpoints[action];

    try {

      const response =
        await fetch(
          IDARK + path,
          {
            headers: {
              "X-API-Key": KEY,
              "Accept":
                "application/json"
            }
          }
        );

      const text =
        await response.text();

      res.status(
        response.status
      );

      res.setHeader(
        "Content-Type",
        response.headers.get(
          "content-type"
        ) ||
        "application/json"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=30"
      );

      res.send(text);

      return;

    } catch (error) {

      console.error(
        "IDark error:",
        error
      );

      res.status(502).json({
        error:
          "upstream_unavailable"
      });

      return;
    }
  }


  /*
   * =========================================
   * UNKNOWN
   * =========================================
   */

  res.status(400).json({

    error:
      "unknown_action",

    available: [
      "nowcast-times",
      "nowcast",
      "frames",
      "rain",
      "rainfine",
      "phenomena",
      "palette",
      "latest",
      "manifest"
    ]

  });
}


/*
 * ===========================================
 * ПАРСЕР ВРЕМЁН WMS
 * ===========================================
 */

function extractTimes(xml) {

  const result = [];

  /*
   * Ищем Dimension/Extent с time.
   */

  const blocks =
    xml.match(
      /<(?:Dimension|Extent)[^>]*name=["']time["'][^>]*>[\s\S]*?<\/(?:Dimension|Extent)>/gi
    ) || [];

  for (
    const block of blocks
  ) {

    const clean =
      block
        .replace(
          /<[^>]+>/g,
          ""
        )
        .trim();

    if (!clean) {
      continue;
    }

    const parts =
      clean
        .split(",")
        .map(x =>
          x.trim()
        )
        .filter(Boolean);

    for (
      const value of parts
    ) {

      /*
       * Обычная дата:
       *
       * 2026-09-13T10:00:00Z
       */

      if (
        /^\d{4}-\d{2}-\d{2}T/.test(
          value
        )
      ) {

        const d =
          new Date(value);

        if (
          !Number.isNaN(
            d.getTime()
          )
        ) {

          result.push(
            d.toISOString()
          );

        }

        continue;
      }

      /*
       * Интервал:
       *
       * start/end/PT10M
       */

      if (
        value.includes("/") &&
        value.includes("PT")
      ) {

        const p =
          value.split("/");

        if (
          p.length >= 3
        ) {

          const start =
            new Date(p[0]);

          const end =
            new Date(p[1]);

          const step =
            parseDuration(
              p[2]
            );

          if (
            !Number.isNaN(
              start.getTime()
            ) &&
            !Number.isNaN(
              end.getTime()
            ) &&
            step > 0
          ) {

            for (
              let t =
                start.getTime();

              t <=
                end.getTime();

              t += step
            ) {

              result.push(
                new Date(t)
                  .toISOString()
              );
            }
          }
        }
      }
    }
  }

  /*
   * Если первый поиск не нашёл
   * ничего — просто ищем ISO timestamps
   * во всём XML.
   */

  if (
    result.length === 0
  ) {

    const matches =
      xml.match(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z/g
      ) || [];

    matches.forEach(
      value => {

        const d =
          new Date(value);

        if (
          !Number.isNaN(
            d.getTime()
          )
        ) {

          result.push(
            d.toISOString()
          );
        }

      }
    );
  }

  return [
    ...new Set(result)
  ].sort();
}


/*
 * ===========================================
 * ISO DURATION
 * ===========================================
 */

function parseDuration(value) {

  const m =
    value.match(
      /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
    );

  if (!m) {
    return 0;
  }

  const h =
    Number(m[1] || 0);

  const min =
    Number(m[2] || 0);

  const s =
    Number(m[3] || 0);

  return (
    h * 3600000 +
    min * 60000 +
    s * 1000
  );
}


/*
 * ===========================================
 * FALLBACK TIMES
 * ===========================================
 */

function makeFallbackTimes(count) {

  const result = [];

  const now =
    Date.now();

  const rounded =
    Math.floor(
      now / 600000
    ) * 600000;

  for (
    let i = count - 1;
    i >= 0;
    i--
  ) {

    result.push(
      new Date(
        rounded -
        i * 600000
      ).toISOString()
    );

  }

  return result;
}
