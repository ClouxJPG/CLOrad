// api/radar.js

const NOWCAST = "https://www.nowcast.ru";
const DEMO_URL = `${NOWCAST}/demo/demo.html`;
const TOKEN_URL = `${NOWCAST}/get_token`;
const WMS_URL = `${NOWCAST}/baltrad_wsgi`;
const VECTOR_URL = `${NOWCAST}/vector_wsgi`;

const RADAR_LAYER =
  "bufr_dbz1,bufr_novosib_dbz1,bufr_vlad_dbz1";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";


/* =====================================================
   CORS
===================================================== */

function cors(res) {
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
    "*"
  );
}


function sendJSON(res, status, data) {
  cors(res);

  res.status(status);

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.end(
    JSON.stringify(data)
  );
}


/* =====================================================
   TOKEN
===================================================== */

async function getToken() {

  const response = await fetch(
    TOKEN_URL,
    {
      method: "GET",
      redirect: "follow",

      headers: {
        "Accept":
          "application/json, text/plain, */*",

        "Referer":
          DEMO_URL,

        "User-Agent":
          USER_AGENT
      }
    }
  );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `/get_token HTTP ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  let data;

  try {
    data =
      JSON.parse(text);

  } catch {
    throw new Error(
      `/get_token вернул не JSON: ${text.slice(0, 1000)}`
    );
  }

  if (!data.token) {
    throw new Error(
      "Nowcast не вернул token"
    );
  }

  return data.token;
}


/* =====================================================
   TOKEN → URL
===================================================== */

function addToken(url, token) {

  const u =
    new URL(url);

  u.searchParams.set(
    "token",
    token
  );

  return u.toString();
}


/* =====================================================
   NOWCAST FETCH
===================================================== */

async function nowcastFetch(
  url,
  options = {}
) {

  let token =
    await getToken();

  let response =
    await fetch(
      addToken(url, token),
      {
        ...options,

        redirect:
          "follow",

        headers: {
          "Accept": "*/*",

          "Referer":
            DEMO_URL,

          "Origin":
            NOWCAST,

          "User-Agent":
            USER_AGENT,

          ...(options.headers || {})
        }
      }
    );


  /*
   * Если token истёк —
   * берём новый.
   */

  if (response.status === 403) {

    token =
      await getToken();

    response =
      await fetch(
        addToken(url, token),
        {
          ...options,

          redirect:
            "follow",

          headers: {
            "Accept": "*/*",

            "Referer":
              DEMO_URL,

            "Origin":
              NOWCAST,

            "User-Agent":
              USER_AGENT,

            ...(options.headers || {})
          }
        }
      );
  }

  return response;
}


/* =====================================================
   GETCAPABILITIES
===================================================== */

async function getCapabilities() {

  const url =
    `${WMS_URL}` +
    `?SERVICE=WMS` +
    `&VERSION=1.1.1` +
    `&REQUEST=GetCapabilities`;

  const response =
    await nowcastFetch(url);

  const text =
    await response.text();

  return {
    response,
    text
  };
}


/* =====================================================
   TIMES
===================================================== */

function extractTimes(xml) {

  const result =
    new Set();

  const regex =
    /20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

  const matches =
    xml.match(regex) || [];

  for (const time of matches) {
    result.add(time);
  }

  return [...result].sort();
}


/* =====================================================
   VECTOR
===================================================== */

async function getVector(
  time,
  layer
) {

  const params =
    new URLSearchParams();

  params.set(
    "time",
    time
  );

  params.set(
    "title",
    layer
  );

  const url =
    `${VECTOR_URL}?${params.toString()}`;

  const response =
    await nowcastFetch(url);

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);

  } catch {
    data = null;
  }

  return {
    response,
    data
  };
}


/* =====================================================
   НАСТОЯЩИЙ RADAR TIMESTAMP
===================================================== */

/*
   GetCapabilities содержит очень много времён,
   включая старые/тестовые.

   Поэтому проверяем последние времена
   через vector_wsgi.

   Проверяем три реальные BUFR-набора отдельно.
*/

async function findLatestRadarTime(
  times
) {

  if (!times.length) {
    return null;
  }


  /*
   * Проверяем максимум последние 60 кадров.
   *
   * Это 10 часов при шаге 10 минут.
   */

  const candidates =
    times
      .slice(-60)
      .reverse();


  for (const time of candidates) {

    try {

      const layers = [
        "bufr_dbz1",
        "bufr_novosib_dbz1",
        "bufr_vlad_dbz1"
      ];


      /*
       * Проверяем параллельно.
       */

      const results =
        await Promise.all(
          layers.map(
            layer =>
              getVector(
                time,
                layer
              )
          )
        );


      let total =
        0;


      for (
        const result of results
      ) {

        if (
          result.response.ok &&
          Array.isArray(
            result.data
          )
        ) {

          total +=
            result.data.length;
        }
      }


      /*
       * Есть реальные точки
       */

      if (total > 0) {

        return {
          time,
          dataCount:
            total
        };
      }

    } catch {
      /*
       * Если один timestamp
       * не ответил — идём дальше.
       */
    }
  }


  return null;
}


/* =====================================================
   WMS GETMAP
===================================================== */

async function getRadarImage({
  time,
  layer,
  width,
  height,
  bbox
}) {

  const params =
    new URLSearchParams();

  params.set(
    "SERVICE",
    "WMS"
  );

  params.set(
    "VERSION",
    "1.1.1"
  );

  params.set(
    "REQUEST",
    "GetMap"
  );

  params.set(
    "LAYERS",
    layer || RADAR_LAYER
  );

  params.set(
    "STYLES",
    ""
  );

  params.set(
    "SRS",
    "EPSG:4326"
  );

  params.set(
    "BBOX",
    bbox || "20,40,180,82"
  );

  params.set(
    "WIDTH",
    String(width || 1200)
  );

  params.set(
    "HEIGHT",
    String(height || 700)
  );

  params.set(
    "FORMAT",
    "image/png"
  );

  params.set(
    "TRANSPARENT",
    "TRUE"
  );

  params.set(
    "TIME",
    time
  );


  const url =
    `${WMS_URL}?${params.toString()}`;


  const response =
    await nowcastFetch(url);


  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );


  return {
    response,
    buffer,
    url
  };
}


/* =====================================================
   PNG CHECK
===================================================== */

function isPNG(buffer) {

  if (
    !buffer ||
    buffer.length < 8
  ) {
    return false;
  }

  return (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}


/* =====================================================
   HANDLER
===================================================== */

export default async function handler(
  req,
  res
) {

  cors(res);


  if (
    req.method ===
    "OPTIONS"
  ) {

    res.status(204).end();

    return;
  }


  const action =
    req.query.action ||
    "diagnostic";


  try {


    /* =================================================
       TOKEN
    ================================================= */

    if (
      action === "token"
    ) {

      try {

        const token =
          await getToken();

        return sendJSON(
          res,
          200,
          {
            ok: true,
            source: "nowcast",
            tokenReceived: true,
            tokenLength:
              token.length
          }
        );

      } catch (e) {

        return sendJSON(
          res,
          502,
          {
            ok: false,
            source: "nowcast",
            error:
              e.message
          }
        );
      }
    }


    /* =================================================
       TIMES
    ================================================= */

    if (
      action ===
      "nowcast-times"
    ) {

      const result =
        await getCapabilities();


      if (
        !result.response.ok
      ) {

        return sendJSON(
          res,
          result.response.status,
          {
            ok: false,
            source: "nowcast",
            status:
              result.response.status,
            body:
              result.text.slice(
                0,
                3000
              )
          }
        );
      }


      const times =
        extractTimes(
          result.text
        );


      return sendJSON(
        res,
        200,
        {
          ok: true,
          source: "nowcast",
          layer: "bufr_dbz1",
          status:
            result.response.status,
          count:
            times.length,
          times
        }
      );
    }


    /* =================================================
       LATEST REAL RADAR TIME
    ================================================= */

    if (
      action ===
      "nowcast-latest"
    ) {

      const cap =
        await getCapabilities();


      if (
        !cap.response.ok
      ) {

        return sendJSON(
          res,
          cap.response.status,
          {
            ok: false,
            error:
              "GetCapabilities failed"
          }
        );
      }


      const times =
        extractTimes(
          cap.text
        );


      const latest =
        await findLatestRadarTime(
          times
        );


      if (!latest) {

        return sendJSON(
          res,
          404,
          {
            ok: false,
            source: "nowcast",
            error:
              "За последние 60 timestamps не найден кадр с vector-данными",
            checked:
              Math.min(
                60,
                times.length
              )
          }
        );
      }


      return sendJSON(
        res,
        200,
        {
          ok: true,
          source: "nowcast",
          time:
            latest.time,
          dataCount:
            latest.dataCount
        }
      );
    }


    /* =================================================
       IMAGE
    ================================================= */

    if (
      action ===
      "nowcast-image"
    ) {

      let time =
        req.query.time;


      /*
       * Если time НЕ передан —
       * автоматически ищем настоящий
       * последний кадр.
       */

      if (!time) {

        const cap =
          await getCapabilities();

        const times =
          extractTimes(
            cap.text
          );

        const latest =
          await findLatestRadarTime(
            times
          );


        if (!latest) {

          return sendJSON(
            res,
            404,
            {
              ok: false,
              error:
                "Не найден актуальный радарный timestamp"
            }
          );
        }

        time =
          latest.time;
      }


      const layer =
        req.query.layer ||
        RADAR_LAYER;


      const result =
        await getRadarImage({
          time,
          layer,

          width:
            Number(
              req.query.width
            ) || 1200,

          height:
            Number(
              req.query.height
            ) || 700,

          bbox:
            req.query.bbox ||
            "20,40,180,82"
        });


      if (
        !result.response.ok
      ) {

        return sendJSON(
          res,
          result.response.status,
          {
            ok: false,
            source: "nowcast",
            status:
              result.response.status,
            error:
              "WMS GetMap failed"
          }
        );
      }


      if (
        !isPNG(
          result.buffer
        )
      ) {

        return sendJSON(
          res,
          502,
          {
            ok: false,
            error:
              "Nowcast не вернул PNG",
            contentType:
              result.response.headers.get(
                "content-type"
              ),
            bytes:
              result.buffer.length
          }
        );
      }


      cors(res);

      res.status(200);

      res.setHeader(
        "Content-Type",
        "image/png"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=60"
      );

      res.setHeader(
        "X-Nowcast-Time",
        time
      );

      res.setHeader(
        "X-Nowcast-Layer",
        layer
      );


      res.end(
        result.buffer
      );

      return;
    }


    /* =================================================
       VECTOR
    ================================================= */

    if (
      action ===
      "nowcast"
    ) {

      const time =
        req.query.time;


      if (!time) {

        return sendJSON(
          res,
          400,
          {
            ok: false,
            error:
              "Не указан time"
          }
        );
      }


      const layer =
        req.query.layer ||
        RADAR_LAYER;


      const result =
        await getVector(
          time,
          layer
        );


      return sendJSON(
        res,
        result.response.ok
          ? 200
          : result.response.status,
        {
          ok:
            result.response.ok,
          source:
            "nowcast",
          layer,
          time,
          status:
            result.response.status,
          data:
            result.data
        }
      );
    }


    /* =================================================
       DIAGNOSTIC
    ================================================= */

    if (
      action ===
      "diagnostic"
    ) {

      const started =
        Date.now();


      const output = {
        ok: true,

        service:
          "CLOrad → Nowcast diagnostic v4",

        nowcast:
          NOWCAST,

        requests: []
      };


      /* homepage */

      try {

        const r =
          await fetch(
            `${NOWCAST}/`,
            {
              headers: {
                "User-Agent":
                  USER_AGENT
              }
            }
          );


        output.requests.push({
          name:
            "homepage",

          status:
            r.status,

          ok:
            r.ok
        });

      } catch (e) {

        output.ok =
          false;

        output.requests.push({
          name:
            "homepage",

          ok:
            false,

          error:
            e.message
        });
      }


      /* demo */

      try {

        const r =
          await fetch(
            DEMO_URL,
            {
              headers: {
                "User-Agent":
                  USER_AGENT
              }
            }
          );


        output.requests.push({
          name:
            "demo",

          status:
            r.status,

          ok:
            r.ok
        });

      } catch (e) {

        output.ok =
          false;

        output.requests.push({
          name:
            "demo",

          ok:
            false,

          error:
            e.message
        });
      }


      /* token */

      let token;

      try {

        token =
          await getToken();


        output.requests.push({
          name:
            "get_token",

          status:
            200,

          ok:
            true,

          tokenReceived:
            true,

          tokenLength:
            token.length
        });

      } catch (e) {

        output.ok =
          false;

        output.requests.push({
          name:
            "get_token",

          ok:
            false,

          error:
            e.message
        });


        return sendJSON(
          res,
          502,
          output
        );
      }


      /* capabilities */

      const cap =
        await getCapabilities();


      output.requests.push({
        name:
          "GetCapabilities_with_token",

        status:
          cap.response.status,

        ok:
          cap.response.ok,

        contentType:
          cap.response.headers.get(
            "content-type"
          ),

        bodyPreview:
          cap.text.slice(
            0,
            800
          )
      });


      if (
        !cap.response.ok
      ) {

        output.ok =
          false;

        return sendJSON(
          res,
          502,
          output
        );
      }


      /* timestamps */

      const times =
        extractTimes(
          cap.text
        );


      output.requests.push({
        name:
          "timestamps",

        ok:
          times.length > 0,

        count:
          times.length,

        first:
          times[0] || null,

        last:
          times[times.length - 1] ||
          null
      });


      /* ищем настоящий кадр */

      const latest =
        await findLatestRadarTime(
          times
        );


      output.requests.push({
        name:
          "latest_real_radar",

        ok:
          !!latest,

        time:
          latest?.time || null,

        dataCount:
          latest?.dataCount || 0
      });


      /* WMS */

      if (latest) {

        try {

          const image =
            await getRadarImage({
              time:
                latest.time,

              layer:
                RADAR_LAYER,

              width:
                1200,

              height:
                700,

              bbox:
                "20,40,180,82"
            });


          output.requests.push({
            name:
              "WMS_GetMap_real_data",

            status:
              image.response.status,

            ok:
              image.response.ok,

            contentType:
              image.response.headers.get(
                "content-type"
              ),

            bytes:
              image.buffer.length,

            png:
              isPNG(
                image.buffer
              )
          });


        } catch (e) {

          output.ok =
            false;

          output.requests.push({
            name:
              "WMS_GetMap_real_data",

            ok:
              false,

            error:
              e.message
          });
        }
      }


      output.summary = {
        durationMs:
          Date.now() - started,

        totalTimes:
          times.length,

        latestRealTime:
          latest?.time ||
          null
      };


      return sendJSON(
        res,
        output.ok
          ? 200
          : 502,
        output
      );
    }


    /* =================================================
       UNKNOWN
    ================================================= */

    return sendJSON(
      res,
      400,
      {
        ok: false,

        error:
          "Unknown action",

        availableActions: [
          "diagnostic",
          "token",
          "nowcast-times",
          "nowcast-latest",
          "nowcast-image",
          "nowcast",
          "capabilities"
        ]
      }
    );


  } catch (e) {

    console.error(
      "CLOrad Nowcast error:",
      e
    );


    return sendJSON(
      res,
      500,
      {
        ok: false,

        error:
          e.message ||
          String(e)
      }
    );
  }
}
