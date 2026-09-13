const NOWCAST = "https://www.nowcast.ru";
const WMS_URL = NOWCAST + "/baltrad_wsgi";
const TOKEN_URL = NOWCAST + "/get_token";

const DEFAULT_LAYER =
  "bufr_dbz1,bufr_novosib_dbz1,bufr_vlad_dbz1";

let tokenCache = null;
let tokenExpires = 0;


/* =====================================================
   TOKEN
===================================================== */

async function getToken(){

  const now = Date.now();

  if(
    tokenCache &&
    now < tokenExpires
  ){

    return tokenCache;

  }

  const response =
    await fetch(
      TOKEN_URL,
      {
        method:"GET",
        cache:"no-store"
      }
    );

  if(!response.ok){

    throw new Error(
      "Nowcast token HTTP " +
      response.status
    );

  }

  const text =
    (await response.text()).trim();

  if(!text){

    throw new Error(
      "Nowcast не вернул token"
    );

  }

  tokenCache = text;

  /*
    Токен действителен дольше,
    но обновляем его заранее.
  */

  tokenExpires =
    now + 25000;

  return tokenCache;

}


/* =====================================================
   GETCAPABILITIES
===================================================== */

async function getCapabilities(){

  const token =
    await getToken();

  const url =
    new URL(WMS_URL);

  url.searchParams.set(
    "SERVICE",
    "WMS"
  );

  url.searchParams.set(
    "VERSION",
    "1.1.1"
  );

  url.searchParams.set(
    "REQUEST",
    "GetCapabilities"
  );

  url.searchParams.set(
    "token",
    token
  );

  const response =
    await fetch(
      url.toString(),
      {
        method:"GET",
        cache:"no-store"
      }
    );

  if(!response.ok){

    throw new Error(
      "GetCapabilities HTTP " +
      response.status
    );

  }

  return await response.text();

}


/* =====================================================
   TIME EXTRACTION
===================================================== */

function extractTimes(xml){

  const result = [];

  if(
    typeof xml !== "string" ||
    !xml
  ){

    return result;

  }

  /*
    Ищем Dimension/Extent TIME.
  */

  const blocks = [

    /<Dimension[^>]*name=["']time["'][^>]*>([\s\S]*?)<\/Dimension>/gi,

    /<Extent[^>]*name=["']time["'][^>]*>([\s\S]*?)<\/Extent>/gi,

    /<Dimension[^>]*name=["']TIME["'][^>]*>([\s\S]*?)<\/Dimension>/gi,

    /<Extent[^>]*name=["']TIME["'][^>]*>([\s\S]*?)<\/Extent>/gi

  ];

  for(
    const regex of blocks
  ){

    let match;

    while(
      (match = regex.exec(xml))
    ){

      const text =
        match[1];

      const found =
        text.match(
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+\-]\d{2}:\d{2})/g
        );

      if(found){

        result.push(
          ...found
        );

      }

    }

  }

  /*
    Fallback:
    если XML устроен иначе,
    ищем ISO timestamps по всему XML.
  */

  if(!result.length){

    const found =
      xml.match(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+\-]\d{2}:\d{2})/g
      );

    if(found){

      result.push(
        ...found
      );

    }

  }

  const unique =
    new Map();

  for(
    const value of result
  ){

    const date =
      new Date(value);

    if(
      Number.isNaN(
        date.getTime()
      )
    ){

      continue;

    }

    date.setSeconds(0,0);

    date.setMinutes(
      Math.floor(
        date.getMinutes()/10
      ) * 10
    );

    const iso =
      date.toISOString();

    unique.set(
      iso,
      iso
    );

  }

  return [
    ...unique.values()
  ].sort(
    (a,b)=>
      new Date(a) -
      new Date(b)
  );

}


/* =====================================================
   CURRENT TIME
===================================================== */

function chooseCurrentTime(times){

  if(!times.length){

    return null;

  }

  const now =
    Date.now();

  /*
    Берём последний timestamp,
    который не слишком сильно находится
    в будущем.
  */

  let selected =
    null;

  for(
    const value of times
  ){

    const t =
      new Date(value)
        .getTime();

    if(
      t <= now + 15 * 60 * 1000
    ){

      selected =
        value;

    }

  }

  return (
    selected ||
    times[times.length - 1]
  );

}


/* =====================================================
   QUERY PARAM
===================================================== */

function getParam(
  query,
  name
){

  if(
    query[name] !== undefined
  ){

    return query[name];

  }

  const lower =
    name.toLowerCase();

  if(
    query[lower] !== undefined
  ){

    return query[lower];

  }

  return null;

}


/* =====================================================
   WMS PROXY
===================================================== */

async function proxyWms(
  req,
  res
){

  const token =
    await getToken();

  const incoming =
    req.query || {};

  const url =
    new URL(WMS_URL);

  /*
    ВАЖНО:
    эти параметры создаёт Leaflet.

    Поэтому BBOX НЕ захардкожен.
  */

  const allowed = [

    "SERVICE",
    "VERSION",
    "REQUEST",
    "LAYERS",
    "STYLES",
    "SRS",
    "CRS",
    "BBOX",
    "WIDTH",
    "HEIGHT",
    "FORMAT",
    "TRANSPARENT",
    "TIME",
    "EXCEPTIONS",
    "DPI",
    "FORMAT_OPTIONS"

  ];

  for(
    const key of allowed
  ){

    const value =
      getParam(
        incoming,
        key
      );

    if(
      value !== null &&
      value !== undefined &&
      value !== ""
    ){

      url.searchParams.set(
        key,
        value
      );

    }

  }

  /*
    Для CLOrad всегда используем
    реальную составную отражаемость
    из оригинального demo Nowcast.
  */

  url.searchParams.set(
    "LAYERS",
    DEFAULT_LAYER
  );

  url.searchParams.set(
    "TRANSPARENT",
    "TRUE"
  );

  url.searchParams.set(
    "token",
    token
  );

  const response =
    await fetch(
      url.toString(),
      {
        method:"GET",
        cache:"no-store"
      }
    );

  const contentType =
    response.headers.get(
      "content-type"
    ) ||
    "image/png";

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  res.status(
    response.status
  );

  res.setHeader(
    "Content-Type",
    contentType
  );

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.send(buffer);

}


/* =====================================================
   HANDLER
===================================================== */

module.exports =
  async function handler(
    req,
    res
  ){

    try{

      const action =
        getParam(
          req.query || {},
          "action"
        );

      /*
        /api/radar?action=times
      */

      if(
        action === "times"
      ){

        const xml =
          await getCapabilities();

        const times =
          extractTimes(xml);

        return res.status(200).json({
          ok:true,
          times,
          count:times.length
        });

      }


      /*
        /api/radar?action=time
      */

      if(
        action === "time"
      ){

        const xml =
          await getCapabilities();

        const times =
          extractTimes(xml);

        const current =
          chooseCurrentTime(
            times
          );

        return res.status(200).json({
          ok:true,
          time:current,
          count:times.length
        });

      }


      /*
        /api/radar?action=capabilities
      */

      if(
        action === "capabilities"
      ){

        const xml =
          await getCapabilities();

        res.status(200);

        res.setHeader(
          "Content-Type",
          "application/xml; charset=utf-8"
        );

        res.setHeader(
          "Cache-Control",
          "no-store"
        );

        return res.send(xml);

      }


      /*
        /api/radar?action=wms
      */

      if(
        action === "wms"
      ){

        return await proxyWms(
          req,
          res
        );

      }


      /*
        Если action не указан —
        тоже считаем запрос WMS.
      */

      return await proxyWms(
        req,
        res
      );

    }catch(error){

      console.error(
        "CLOrad radar API:",
        error
      );

      return res.status(500).json({
        ok:false,
        error:
          error &&
          error.message
            ? error.message
            : String(error)
      });

    }

  };
