const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const manifestHandler = require('./api/manifest');
const configManifestHandler = require('./api/config-manifest');
const configStreamHandler = require('./api/config-stream');
const streamHandler = require('./api/stream/[type]/[id]');
const resolveHandler = require('./api/resolve');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const APP_BASE_PATH = normalizeBasePath(process.env.APP_BASE_PATH || '');

function normalizeBasePath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

function stripBasePath(pathname) {
  if (!APP_BASE_PATH) return pathname;
  if (pathname === APP_BASE_PATH) return '/';
  if (pathname.startsWith(`${APP_BASE_PATH}/`)) {
    const stripped = pathname.slice(APP_BASE_PATH.length);
    return stripped || '/';
  }
  return pathname;
}

function withResponseHelpers(res) {
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };

  res.json = function json(payload) {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(payload));
  };

  return res;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseQuery(urlObject) {
  const query = {};
  for (const [key, value] of urlObject.searchParams.entries()) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = value;
      continue;
    }
    if (Array.isArray(query[key])) {
      query[key].push(value);
      continue;
    }
    query[key] = [query[key], value];
  }
  return query;
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not Found');
      return;
    }
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
    res.statusCode = 200;
    res.end(content);
  });
}

async function runHandler(handler, req, res, query) {
  req.query = query;
  try {
    await handler(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ streams: [] }));
  }
}

const server = http.createServer(async (req, res) => {
  withResponseHelpers(res);
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Method Not Allowed');
    return;
  }

  const urlObject = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = stripBasePath(urlObject.pathname);
  const baseQuery = parseQuery(urlObject);

  if (pathname === '/') {
    sendFile(res, path.join(PUBLIC_DIR, 'configure.html'), 'text/html; charset=utf-8');
    return;
  }

  if (pathname === '/configure' || pathname === '/configure.html') {
    sendFile(res, path.join(PUBLIC_DIR, 'configure.html'), 'text/html; charset=utf-8');
    return;
  }

  if (pathname === '/manifest.json' || pathname === '/api/manifest') {
    await runHandler(manifestHandler, req, res, baseQuery);
    return;
  }

  const configManifestMatch = pathname.match(/^\/([^/]+)\/manifest\.json$/);
  if (configManifestMatch) {
    const query = { ...baseQuery, config: decodeURIComponent(configManifestMatch[1]) };
    await runHandler(configManifestHandler, req, res, query);
    return;
  }

  const streamMatch = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\.json$/);
  if (streamMatch) {
    const query = {
      ...baseQuery,
      type: decodeURIComponent(streamMatch[1]),
      id: decodeURIComponent(streamMatch[2])
    };
    await runHandler(streamHandler, req, res, query);
    return;
  }

  const configStreamMatch = pathname.match(/^\/([^/]+)\/stream\/([^/]+)\/([^/]+)\.json$/);
  if (configStreamMatch) {
    const query = {
      ...baseQuery,
      config: decodeURIComponent(configStreamMatch[1]),
      type: decodeURIComponent(configStreamMatch[2]),
      id: decodeURIComponent(configStreamMatch[3])
    };
    await runHandler(configStreamHandler, req, res, query);
    return;
  }

  const apiStreamMatch = pathname.match(/^\/api\/stream\/([^/]+)\/([^/]+)$/);
  if (apiStreamMatch) {
    const query = {
      ...baseQuery,
      type: decodeURIComponent(apiStreamMatch[1]),
      id: decodeURIComponent(apiStreamMatch[2])
    };
    await runHandler(streamHandler, req, res, query);
    return;
  }

  if (pathname === '/api/config-manifest') {
    await runHandler(configManifestHandler, req, res, baseQuery);
    return;
  }

  if (pathname === '/api/config-stream') {
    await runHandler(configStreamHandler, req, res, baseQuery);
    return;
  }

  const resolveMatch = pathname.match(/^\/resolve\/([^/]+)\/([^/]+)(?:\/[^/]+)?$/);
  if (resolveMatch) {
    const query = {
      ...baseQuery,
      service: decodeURIComponent(resolveMatch[1]),
      infoHash: decodeURIComponent(resolveMatch[2])
    };
    await runHandler(resolveHandler, req, res, query);
    return;
  }

  // Prefix-tolerant fallback (mirrors nCore-style routing robustness):
  // handles requests like /flix-finder/resolve/:service/:infoHash when base path
  // is not stripped by the hosting layer.
  const prefixedResolveMatch = pathname.match(/^\/[^/]+\/resolve\/([^/]+)\/([^/]+)(?:\/[^/]+)?$/);
  if (prefixedResolveMatch) {
    const query = {
      ...baseQuery,
      service: decodeURIComponent(prefixedResolveMatch[1]),
      infoHash: decodeURIComponent(prefixedResolveMatch[2])
    };
    await runHandler(resolveHandler, req, res, query);
    return;
  }

  if (pathname === '/api/resolve') {
    await runHandler(resolveHandler, req, res, baseQuery);
    return;
  }

  // Prefix-tolerant fallback for /:prefix/api/resolve.
  if (/^\/[^/]+\/api\/resolve$/.test(pathname)) {
    await runHandler(resolveHandler, req, res, baseQuery);
    return;
  }

  if (pathname === '/logo.svg') {
    sendFile(res, path.join(__dirname, 'logo.svg'), 'image/svg+xml');
    return;
  }

  const staticPath = path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ''));
  if (staticPath.startsWith(PUBLIC_DIR) && fs.existsSync(staticPath)) {
    sendFile(res, staticPath);
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`Flix-Finder listening on http://${HOST}:${PORT}`);
});
