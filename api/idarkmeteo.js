// CLOrad — Idarkmeteo proxy
const UPSTREAM="https://idarkmeteo.host/api/v1/";

const ALLOWED=[
 /^frames\/(rain|cloudphase|smoke|satrain)\/(wide|fine|swath|coarse)\.json$/,
 /^data\/(rain|cloudphase|smoke|satrain)\/(wide|fine|swath|coarse)\/[0-9]{8}\/[0-9]{4}\.(png|rdr)$/,
 /^latest\/(rain|cloudphase|smoke|satrain)\/(wide|fine|swath|coarse)\.png$/,
 /^palettes\.json$/
];

export default async function handler(req,res){

 try{

  if(req.method!=="GET"){
   return res
    .status(405)
    .setHeader("Allow","GET")
    .json({
     ok:false,
     error:"Method not allowed"
    });
  }

  const u=new URL(
   req.url,
   "http://localhost"
  );

  const path=(
   u.searchParams.get("path")||""
  ).replace(/^\/+/,"");

  if(!ALLOWED.some(
   r=>r.test(path)
  )){
   return res
    .status(400)
    .json({
     ok:false,
     error:"Invalid Idarkmeteo path"
    });
  }

  const key=
   process.env.IDARKMETEO_API_KEY;

  if(!key){
   return res
    .status(500)
    .json({
     ok:false,
     error:"IDARKMETEO_API_KEY is not configured"
    });
  }

  async function get(p){

   return fetch(
    UPSTREAM+p,
    {
     headers:{
      "X-API-Key":key,
      "Accept":
       p.endsWith(".json")
        ? "application/json"
        : "*/*"
     },
     cache:"no-store"
    }
   );

  }

  let upstream=
   await get(path);

  let actualPath=
   path;

  /*
   Живой API сейчас иногда пишет .rdr,
   хотя документированный формат — .png.
   Поэтому пробуем и PNG-вариант.
  */

  if(
   !upstream.ok &&
   path.endsWith(".rdr")
  ){

   const pngPath=
    path.slice(0,-4)+".png";

   const fallback=
    await get(pngPath);

   if(fallback.ok){

    upstream=
     fallback;

    actualPath=
     pngPath;

   }

  }

  if(!upstream.ok){

   await upstream.arrayBuffer();

   return res
    .status(upstream.status)
    .json({
     ok:false,
     error:
      "Idarkmeteo upstream error",
     status:
      upstream.status,
     path:
      actualPath
    });

  }

  const type=
   (
    upstream.headers
     .get("content-type")||""
   ).toLowerCase();

  const data=
   Buffer.from(
    await upstream.arrayBuffer()
   );

  /*
   JSON
  */

  if(
   actualPath.endsWith(".json")
  ){

   return res
    .status(200)
    .setHeader(
     "Content-Type",
     "application/json; charset=utf-8"
    )
    .setHeader(
     "Cache-Control",
     "no-store"
    )
    .send(data);

  }

  /*
   Проверяем PNG по сигнатуре.
  */

  const png=
   data.length>=8 &&
   data[0]===0x89 &&
   data[1]===0x50 &&
   data[2]===0x4e &&
   data[3]===0x47 &&
   data[4]===0x0d &&
   data[5]===0x0a &&
   data[6]===0x1a &&
   data[7]===0x0a;

  /*
   Если это изображение — отдаём как изображение.
  */

  if(
   type.startsWith("image/")||
   png
  ){

   return res
    .status(200)
    .setHeader(
     "Content-Type",
     png
      ? "image/png"
      : (
       type.split(";")[0]||
       "application/octet-stream"
      )
    )
    .setHeader(
     "Content-Length",
     String(data.length)
    )
    .setHeader(
     "Cache-Control",
     "public, max-age=300, s-maxage=300"
    )
    .send(data);

  }

  /*
   Если .rdr действительно бинарный формат,
   пока просто передаём его дальше.
  */

  return res
   .status(200)
   .setHeader(
    "Content-Type",
    type||
    "application/octet-stream"
   )
   .setHeader(
    "Content-Length",
    String(data.length)
   )
   .setHeader(
    "Cache-Control",
    "public, max-age=300, s-maxage=300"
   )
   .send(data);

 }catch(e){

  console.error(
   "Idarkmeteo proxy error",
   e
  );

  return res
   .status(500)
   .json({
    ok:false,
    error:
     "Idarkmeteo proxy error"
   });

 }

}
