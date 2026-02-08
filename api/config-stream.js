const { fetchExtResults, normalizeImdbId, parseConfig, filterStreams } = require('../lib/ext');
const { resolveDebridStreams } = require('../lib/debrid');

const SUPPORT_URL = 'https://ko-fi.com/sandortoth';

function decodeConfig(configStr) {
  if (!configStr) return {};
  try {
    const raw = String(configStr).replace(/ /g, '+');
    const normalized = raw
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(raw.length / 4) * 4, '=');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

function withSupportLink(streams) {
  return [
    ...streams,
    {
      name: 'Flix-Finder',
      title: '☕ Support me\nIf Flix-Finder helped you, buy me a coffee',
      externalUrl: SUPPORT_URL
    }
  ];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { type, id } = req.query;

  if (!normalizeImdbId(id)) {
    return res.status(200).json({ streams: [] });
  }

  try {
    // Decode config from URL path (passed as query param by vercel rewrite)
    const decodedConfig = decodeConfig(req.query.config);
    const config = parseConfig(decodedConfig);
    const streams = await fetchExtResults(id, { type, sources: config.sources });
    const filtered = filterStreams(streams, config);
    const resolved = await resolveDebridStreams(filtered, config);
    res.status(200).json({ streams: withSupportLink(resolved) });
  } catch (err) {
    res.status(200).json({ streams: [] });
  }
};
