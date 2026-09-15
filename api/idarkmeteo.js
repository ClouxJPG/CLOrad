module.exports = async function handler(req, res) {
  const UPSTREAM = "https://idarkmeteo.host/api/v1/";
  const key = process.env.IDARKMETEO_KEY;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-API-Key"
  );

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  res.setHeader("Pragma", "no-cache");

  // OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // API KEY
  if (!key) {
    console.error("CLOrad: IDARKMETEO_KEY is missing");

    return res.status(500).json({
      ok: false,
      error: "IDARKMETEO_KEY is not configured"
    });
  }

  // PATH
  const path = req.query?.path;

  if (!path || typeof path !== "string") {
    return res.status(400).json({
      ok: false,
      error: "Missing path"
    });
  }

  // SECURITY
  if (
    path.startsWith("/") ||
    path.includes("..") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return res.status(400).json({
      ok: false,
      error: "Invalid Idarkmeteo path",
      path
    });
  }

  // ALLOWED PATHS

  const isFrameJson =
    /^frames\/[a-z]+\/[a-z0-9_-]+\.json$/i.test(path);

  const isPng =
    /^(data|latest|archive|day)\/[a-z]+\/[a-z0-9_-]+\/.+\.png$/i.test(path);

  const isRdr =
    /^data\/[a-z]+\/[a-z0-9_-]+\/\d{8}\/\d{4}\.rdr$/i.test(path);

  if (!isFrameJson && !isPng && !isRdr) {
    return res.status(400).json({
      ok: false,
      error: "Invalid Idarkmeteo path",
      path
    });
  }

  const target = UPSTREAM + path;

  console.log("CLOrad Idarkmeteo request:", target);

  let response;

  try {
    response = await fetch(target, {
      method: "GET",

      headers: {
        "X-API-Key": key,
        "Accept": isFrameJson
          ? "application/json"
          : "*/*"
      }
    });
  } catch (error) {
    console.error(
      "CLOrad Idarkmeteo fetch error:",
      error
    );

    return res.status(502).json({
      ok: false,
      error: "Upstream fetch failed",
      path,
      message: error?.message || String(error)
    });
  }

  // UPSTREAM ERROR

  if (!response.ok) {
    let body = "";

    try {
      body = await response.text();
    } catch (_) {
      body = "";
    }

    console.error(
      "CLOrad Idarkmeteo upstream error:",
      response.status,
      path,
      body
    );

    return res.status(response.status).json({
      ok: false,
      error: "Idarkmeteo upstream error",
      status: response.status,
      path,
      message: body || `HTTP ${response.status}`
    });
  }

  // CONTENT TYPE

  const contentType =
    response.headers.get("content-type") ||
    (
      isFrameJson
        ? "application/json"
        : "application/octet-stream"
    );

  res.setHeader(
    "Content-Type",
    contentType
  );

  // JSON

  if (isFrameJson) {
    const text = await response.text();

    return res.status(200).send(text);
  }

  // BINARY: PNG / RDR

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  return res.status(200).send(buffer);
};
