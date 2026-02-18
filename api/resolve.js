const { resolveDebridUrl } = require('../lib/debrid');

async function unwrapTorboxUrl(url) {
  if (!/^https:\/\/api\.torbox\.app\/v1\/api\//i.test(String(url || ''))) {
    return url;
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'torrentio'
      }
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) return location;
    }

    const text = await res.text();
    if (text) {
      try {
        const data = JSON.parse(text);
        const direct = data?.data || data?.link || data?.url || data?.download;
        if (typeof direct === 'string' && direct.startsWith('http')) {
          return direct;
        }
      } catch {
        // ignore JSON parse failure, fallback to original url
      }
    }
  } catch {
    // fallback to original url
  }

  return url;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const service = String(req.query.service || '').trim();
  const infoHash = String(req.query.infoHash || '').trim().toLowerCase();
  const token = String(req.query.token || '').trim();

  if (!service || !infoHash || !token) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Bad Request');
    return;
  }

  try {
    const resolvedUrl = await resolveDebridUrl(service, infoHash, token);
    const url = service === 'torbox'
      ? await unwrapTorboxUrl(resolvedUrl)
      : resolvedUrl;
    res.statusCode = 302;
    res.setHeader('Location', url);
    res.end();
  } catch (err) {
    const message = String(err?.message || err || 'Resolve failed');
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Resolve failed: ${message}`);
  }
};
