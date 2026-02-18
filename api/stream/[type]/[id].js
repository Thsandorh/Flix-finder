const { fetchExtResults, normalizeImdbId, parseConfig, filterStreams } = require('../../../lib/ext');
const { resolveDebridStreams } = require('../../../lib/debrid');
const { withSupportLink } = require('../../../lib/support');

function resolveHost(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || 'http';
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || String(req.headers.host || '').trim() || 'localhost';
  const rawBasePath = String(process.env.APP_BASE_PATH || '').trim();
  const basePath = !rawBasePath || rawBasePath === '/'
    ? ''
    : `/${rawBasePath.replace(/^\/+|\/+$/g, '')}`;
  return `${proto}://${host}${basePath}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { type, id } = req.query;

  if (!normalizeImdbId(id)) {
    return res.status(200).json({ streams: [] });
  }

  try {
    const config = parseConfig(req.query);
    config.host = resolveHost(req);
    const streams = await fetchExtResults(id, { type, sources: config.sources });
    const filtered = filterStreams(streams, config);
    const resolved = await resolveDebridStreams(filtered, config);
    res.status(200).json({ streams: withSupportLink(resolved) });
  } catch (err) {
    res.status(200).json({ streams: [] });
  }
};
