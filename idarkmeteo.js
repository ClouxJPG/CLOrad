// ============================================================
// CLOrad — Idarkmeteo client
// ============================================================

const IDARKMETEO_PROXY = "/api/idarkmeteo?path=";

// ------------------------------------------------------------
// Build proxy URL
// ------------------------------------------------------------

function idarkmeteoUrl(path) {
  return IDARKMETEO_PROXY + encodeURIComponent(path);
}

// ------------------------------------------------------------
// Load Idarkmeteo resource
// ------------------------------------------------------------

async function idarkmeteoFetch(path, options = {}) {
  const response = await fetch(idarkmeteoUrl(path), {
    cache: options.cache || "no-store"
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    try {
      const json = await response.json();

      if (json?.error) {
        message += `: ${json.error}`;
      }
    } catch {}

    throw new Error(message);
  }

  return response;
}

// ------------------------------------------------------------
// Load JSON
// ------------------------------------------------------------

async function idarkmeteoJSON(path) {
  const response = await idarkmeteoFetch(path);

  return response.json();
}

// ------------------------------------------------------------
// Load image
// ------------------------------------------------------------

async function idarkmeteoImage(path) {
  const response = await idarkmeteoFetch(path);

  const blob = await response.blob();

  return URL.createObjectURL(blob);
}

// ------------------------------------------------------------
// Radar image
// ------------------------------------------------------------

async function idarkmeteoRadar(path) {
  return idarkmeteoImage(path);
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

window.Idarkmeteo = {
  url: idarkmeteoUrl,
  fetch: idarkmeteoFetch,
  json: idarkmeteoJSON,
  image: idarkmeteoImage,
  radar: idarkmeteoRadar
};

// ------------------------------------------------------------
// Connection test
// ------------------------------------------------------------

async function testIdarkmeteo(path) {
  try {
    const response = await idarkmeteoFetch(path);

    console.log(
      "[CLOrad] Idarkmeteo connected:",
      response.status,
      response.headers.get("content-type")
    );

    return true;

  } catch (error) {
    console.error(
      "[CLOrad] Idarkmeteo connection failed:",
      error
    );

    return false;
  }
}

window.testIdarkmeteo = testIdarkmeteo;
