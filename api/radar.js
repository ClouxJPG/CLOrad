// api/radar.js

const NOWCAST = "https://www.nowcast.ru";
const WMS = `${NOWCAST}/baltrad_wsgi`;
const TOKEN = `${NOWCAST}/get_token`;

const LAYER = "bufr_dbz1,bufr_novosib_dbz1,bufr_vlad_dbz1";

const headers = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  "Referer": "https://www.nowcast.ru/demo/demo.html",
  "Origin": "https://www.nowcast.ru"
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

async function getToken() {
  const r = await fetch(TOKEN, {
    headers: {
      ...headers,
      Accept: "application/json"
    }
  });

  if (!r.ok) {
    throw new Error(`Token HTTP ${r.status}`);
  }

  const j = await r.json();

  if (!j.token) {
    throw new Error("Nowcast token отсутствует");
  }

  return j.token;
}

async function nowcast(url) {
  let token = await getToken();

  let r = await fetch(
    url + (url.includes("?") ? "&" : "?") +
    "token=" + encodeURIComponent(token),
    {
      headers,
      redirect: "follow"
    }
  );

  if (r.status === 403) {
    token = await getToken();

    r = await fetch(
      url + (url.includes("?") ? "&" : "?") +
      "token=" + encodeURIComponent(token),
      {
        headers,
        redirect: "follow"
      }
    );
  }

  return r;
}


/*
=========================================================
Получаем список времени WMS
=========================================================
*/

async function getTimes() {

  const url =
    WMS +
    "?SERVICE=WMS" +
    "&VERSION=1.1.1" +
    "&REQUEST=GetCapabilities";

  const r = await nowcast(url);

  const xml = await r.text();

  if (!r.ok) {
    throw new Error(
      `GetCapabilities HTTP ${r.status}`
    );
  }

  const matches =
    xml.match(
      /20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
    ) || [];

  return [...new Set(matches)].sort();
}


/*
=========================================================
Берём время максимально близкое к текущему.
Без vector-запросов.
=========================================================
*/

async function getBestTime() {

  const times = await getTimes();

  if (!times.length) {
    throw new Error("В WMS нет временных меток");
  }

  const now = Date.now();

  let best = null;
  let bestDiff = Infinity;

  for (const t of times) {

    const ms = Date.parse(t);

    if (!Number.isFinite(ms)) continue;

    /*
     * Не берём слишком далёкое будущее.
     * Небольшой запас оставляем из-за часов сервера.
     */

    if (ms > now + 20 * 60 * 1000) {
      continue;
    }

    const diff = Math.abs(now - ms);

    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }

  /*
   * Если часы Nowcast сильно впереди —
   * просто используем последний timestamp.
   */

  if (!best) {
    best = times[times.length - 1];
  }

  return best;
}


/*
=========================================================
WMS IMAGE
=========================================================
*/

async function getImage(time, req) {

  /*
   * Россия + европейская часть.
   * Координаты именно WGS84.
   */

  const bbox =
    req.query.bbox ||
    "20,40,180,82";

  const width =
    Number(req.query.width) || 1400;

  const height =
    Number(req.query.height) || 800;


  const p = new URLSearchParams();

  p.set("SERVICE", "WMS");
  p.set("VERSION", "1.1.1");
  p.set("REQUEST", "GetMap");

  p.set(
    "LAYERS",
    LAYER
  );

  p.set("STYLES", "");

  p.set(
    "SRS",
    "EPSG:4326"
  );

  p.set(
    "BBOX",
    bbox
  );

  p.set(
    "WIDTH",
    String(width)
  );

  p.set(
    "HEIGHT",
    String(height)
  );

  p.set(
    "FORMAT",
    "image/png"
  );

  p.set(
    "TRANSPARENT",
    "TRUE"
  );

  p.set(
    "TIME",
    time
  );


  const url =
    WMS + "?" + p.toString();


  return await nowcast(url);
}


/*
=========================================================
HANDLER
=========================================================
*/

export default async function handler(req, res) {

  cors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {

    const action =
      req.query.action || "nowcast-image";


    /*
    -----------------------------------------------------
    ВРЕМЯ
    -----------------------------------------------------
    */

    if (action === "nowcast-time") {

      const time =
        await getBestTime();

      res.status(200);

      res.setHeader(
        "Content-Type",
        "application/json"
      );

      res.end(
        JSON.stringify({
          ok: true,
          time,
          layer: LAYER
        })
      );

      return;
    }


    /*
    -----------------------------------------------------
    ВРЕМЕНА
    -----------------------------------------------------
    */

    if (action === "nowcast-times") {

      const times =
        await getTimes();

      res.status(200);

      res.setHeader(
        "Content-Type",
        "application/json"
      );

      res.end(
        JSON.stringify({
          ok: true,
          count: times.length,
          times
        })
      );

      return;
    }


    /*
    -----------------------------------------------------
    РАДАРНАЯ КАРТИНКА
    -----------------------------------------------------
    */

    if (action === "nowcast-image") {

      let time =
        req.query.time;

      if (!time) {
        time =
          await getBestTime();
      }


      const r =
        await getImage(
          time,
          req
        );


      const contentType =
        r.headers.get(
          "content-type"
        ) || "";


      if (!r.ok) {

        const text =
          await r.text();

        res.status(r.status);

        res.setHeader(
          "Content-Type",
          "application/json"
        );

        res.end(
          JSON.stringify({
            ok: false,
            error:
              `Nowcast WMS HTTP ${r.status}`,
            body:
              text.slice(0, 1000)
          })
        );

        return;
      }


      const buffer =
        Buffer.from(
          await r.arrayBuffer()
        );


      res.status(200);

      res.setHeader(
        "Content-Type",
        contentType ||
        "image/png"
      );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      res.setHeader(
        "X-Radar-Time",
        time
      );

      res.end(buffer);

      return;
    }


    /*
    -----------------------------------------------------
    INFO
    -----------------------------------------------------
    */

    res.status(200);

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    res.end(
      JSON.stringify({
        ok: true,
        service: "CLOrad Nowcast WMS",
        layer: LAYER,
        actions: [
          "nowcast-time",
          "nowcast-times",
          "nowcast-image"
        ]
      })
    );

  } catch (e) {

    console.error(e);

    res.status(500);

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    res.end(
      JSON.stringify({
        ok: false,
        error:
          e.message || String(e)
      })
    );
  }
}
