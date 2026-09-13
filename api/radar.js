// api/radar.js

const NOWCAST = "https://www.nowcast.ru";
const DEMO = `${NOWCAST}/demo/demo.html`;
const TOKEN = `${NOWCAST}/get_token`;
const WMS = `${NOWCAST}/baltrad_wsgi`;
const VECTOR = `${NOWCAST}/vector_wsgi`;

const DEFAULT_LAYER =
  "bufr_dbz1,bufr_novosib_dbz1,bufr_vlad_dbz1";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

function json(res, status, data) {
  cors(res);
  res.status(status);
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.end(JSON.stringify(data));
}

/*
========================================================
Запрос как можно ближе к demo.js
========================================================
*/

async function getToken() {
  const headers = {
    "Accept": "application/json, text/plain, */*",
    "Referer": DEMO,
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
  };

  const response = await fetch(TOKEN, {
    method: "GET",
    headers,
    redirect: "follow"
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Nowcast /get_token: HTTP ${response.status}; ` +
      `response: ${text.substring(0, 1000)}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Nowcast /get_token вернул не JSON: " +
      text.substring(0, 1000)
    );
  }

  if (!data.token) {
    throw new Error(
      "Nowcast /get_token не вернул token: " +
      text.substring(0, 1000)
    );
  }

  return {
    token: data.token,
    headers
  };
}

/*
========================================================
Добавление token
========================================================
*/

function withToken(url, token) {
  const u = new URL(url);
  u.searchParams.set("token", token);
  return u.toString();
}

/*
========================================================
Запрос Nowcast с токеном
========================================================
*/

async function requestNowcast(url, options = {}) {
  let auth = await getToken();

  let response = await fetch(
    withToken(url, auth.token),
    {
      ...options,
      redirect: "follow",
      headers: {
        "Accept": "*/*",
        "Referer": DEMO,
        "User-Agent": auth.headers["User-Agent"],
        ...(options.headers || {})
      }
    }
  );

  /*
   * Токен живёт недолго.
   * Если Nowcast ответил 403 — получаем новый.
   */

  if (response.status === 403) {
    auth = await getToken();

    response = await fetch(
      withToken(url, auth.token),
      {
        ...options,
        redirect: "follow",
        headers: {
          "Accept": "*/*",
          "Referer": DEMO,
          "User-Agent": auth.headers["User-Agent"],
          ...(options.headers || {})
        }
      }
    );
  }

  return response;
}

/*
========================================================
GETCAPABILITIES
========================================================
*/

async function capabilities() {
  const url =
    `${WMS}?SERVICE=WMS` +
    `&VERSION=1.1.1` +
    `&REQUEST=GetCapabilities`;

  const response =
    await requestNowcast(url);

  const text =
    await response.text();

  return {
    response,
    text
  };
}

/*
========================================================
TIME
========================================================
*/

function extractTimes(xml) {
  const set = new Set();

  const re =
    /20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

  const matches =
    xml.match(re) || [];

  for (const t of matches) {
    set.add(t);
  }

  return [...set].sort();
}

/*
========================================================
IMAGE
========================================================
*/

async function radarImage({
  time,
  layer,
  width,
  height,
  bbox
}) {
  const params = new URLSearchParams();

  params.set("SERVICE", "WMS");
  params.set("VERSION", "1.1.1");
  params.set("REQUEST", "GetMap");

  params.set(
    "LAYERS",
    layer || DEFAULT_LAYER
  );

  params.set("STYLES", "");

  params.set("SRS", "EPSG:4326");

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
    `${WMS}?${params.toString()}`;

  const response =
    await requestNowcast(url);

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  return {
    response,
    buffer
  };
}

/*
========================================================
VECTOR
========================================================
*/

async function vector({
  time,
  layer
}) {
  const params =
    new URLSearchParams();

  params.set(
    "time",
    time
  );

  params.set(
    "title",
    layer || DEFAULT_LAYER
  );

  const url =
    `${VECTOR}?${params.toString()}`;

  const response =
    await requestNowcast(url);

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw: text
    };
  }

  return {
    response,
    data
  };
}

/*
========================================================
HANDLER
========================================================
*/

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const action =
    req.query.action || "diagnostic";

  try {

    /*
    ----------------------------------------------
    TOKEN
    ----------------------------------------------
    */

    if (action === "token") {
      try {
        const result =
          await getToken();

        return json(
          res,
          200,
          {
            ok: true,
            source: "nowcast",
            tokenReceived: true,
            tokenLength:
              result.token.length
          }
        );

      } catch (e) {
        return json(
          res,
          502,
          {
            ok: false,
            source: "nowcast",
            error: e.message
          }
        );
      }
    }

    /*
    ----------------------------------------------
    TIMES
    ----------------------------------------------
    */

    if (action === "nowcast-times") {
      const result =
        await capabilities();

      if (!result.response.ok) {
        return json(
          res,
          result.response.status,
          {
            ok: false,
            source: "nowcast",
            status:
              result.response.status,
            error:
              "GetCapabilities failed",
            body:
              result.text.substring(0, 3000)
          }
        );
      }

      const times =
        extractTimes(result.text);

      return json(
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

    /*
    ----------------------------------------------
    IMAGE
    ----------------------------------------------
    */

    if (action === "nowcast-image") {
      const time =
        req.query.time;

      if (!time) {
        return json(
          res,
          400,
          {
            ok: false,
            error:
              "Не указан time"
          }
        );
      }

      const result =
        await radarImage({
          time,
          layer:
            req.query.layer ||
            DEFAULT_LAYER,
          width:
            Number(req.query.width) ||
            1200,
          height:
            Number(req.query.height) ||
            700,
          bbox:
            req.query.bbox ||
            "20,40,180,82"
        });

      if (!result.response.ok) {
        const body =
          result.buffer
            .toString("utf8")
            .substring(0, 3000);

        return json(
          res,
          result.response.status,
          {
            ok: false,
            source: "nowcast",
            status:
              result.response.status,
            error:
              "WMS GetMap failed",
            body
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

      res.end(result.buffer);

      return;
    }

    /*
    ----------------------------------------------
    VECTOR
    ----------------------------------------------
    */

    if (action === "nowcast") {
      const time =
        req.query.time;

      if (!time) {
        return json(
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
        DEFAULT_LAYER;

      const result =
        await vector({
          time,
          layer
        });

      if (!result.response.ok) {
        return json(
          res,
          result.response.status,
          {
            ok: false,
            source: "nowcast",
            status:
              result.response.status,
            data:
              result.data
          }
        );
      }

      return json(
        res,
        200,
        {
          ok: true,
          source: "nowcast",
          layer,
          time,
          status:
            result.response.status,
          data:
            result.data
        }
      );
    }

    /*
    ----------------------------------------------
    RAW CAPABILITIES
    ----------------------------------------------
    */

    if (action === "capabilities") {
      const result =
        await capabilities();

      cors(res);

      res.status(
        result.response.status
      );

      res.setHeader(
        "Content-Type",
        "application/xml; charset=utf-8"
      );

      res.end(result.text);

      return;
    }

    /*
    ----------------------------------------------
    DIAGNOSTIC
    ----------------------------------------------
    */

    if (action === "diagnostic") {
      const start =
        Date.now();

      const result = {
        ok: true,
        service:
          "CLOrad → Nowcast diagnostic v2",
        nowcast: NOWCAST,
        requests: []
      };

      /*
      homepage
      */

      const home =
        await fetch(
          `${NOWCAST}/`,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0"
            }
          }
        );

      result.requests.push({
        name: "homepage",
        status:
          home.status,
        ok:
          home.ok
      });

      /*
      demo
      */

      const demo =
        await fetch(
          DEMO,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0"
            }
          }
        );

      result.requests.push({
        name: "demo",
        status:
          demo.status,
        ok:
          demo.ok
      });

      /*
      token
      */

      try {
        const auth =
          await getToken();

        result.requests.push({
          name: "get_token",
          status: 200,
          ok: true,
          tokenReceived: true,
          tokenLength:
            auth.token.length
        });

        /*
        capabilities
        */

        const cap =
          await capabilities();

        result.requests.push({
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
            cap.text.substring(0, 1000)
        });

        /*
        Получаем настоящий timestamp,
        найденный в Capabilities.
        */

        const times =
          extractTimes(cap.text);

        const testTime =
          times.length
            ? times[times.length - 1]
            : null;

        result.requests.push({
          name:
            "latest_timestamp",
          ok:
            !!testTime,
          timestamp:
            testTime,
          totalTimes:
            times.length
        });

        /*
        vector с настоящим временем
        */

        if (testTime) {
          const v =
            await vector({
              time:
                testTime,
              layer:
                DEFAULT_LAYER
            });

          result.requests.push({
            name:
              "vector_with_real_timestamp",
            status:
              v.response.status,
            ok:
              v.response.ok,
            contentType:
              v.response.headers.get(
                "content-type"
              ),
            dataCount:
              Array.isArray(v.data)
                ? v.data.length
                : null
          });

          /*
          WMS image с настоящим временем
          */

          const img =
            await radarImage({
              time:
                testTime,
              layer:
                DEFAULT_LAYER,
              width: 800,
              height: 600,
              bbox:
                "20,40,180,82"
            });

          result.requests.push({
            name:
              "WMS_GetMap_real_timestamp",
            status:
              img.response.status,
            ok:
              img.response.ok,
            contentType:
              img.response.headers.get(
                "content-type"
              ),
            bytes:
              img.buffer.length
          });
        }

      } catch (e) {
        result.ok = false;

        result.requests.push({
          name:
            "authenticated_requests",
          ok: false,
          error:
            e.message
        });
      }

      result.summary = {
        durationMs:
          Date.now() - start,
        failedRequests:
          result.requests.filter(
            x => x.ok === false
          ).length
      };

      return json(
        res,
        result.ok ? 200 : 502,
        result
      );
    }

    /*
    ----------------------------------------------
    UNKNOWN
    ----------------------------------------------
    */

    return json(
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
          "nowcast-image",
          "nowcast",
          "capabilities"
        ]
      }
    );

  } catch (e) {
    return json(
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
