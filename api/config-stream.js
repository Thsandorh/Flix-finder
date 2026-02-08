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

function withSupportLink(streams, maxResults) {
  const supportStream = {
    name: 'Flix-Finder',
    title: '🤝 Support Flix-Finder\n☕ Buy me a coffee on Ko-fi',
    url: SUPPORT_URL,
    externalUrl: SUPPORT_URL
  };

  if (!Number.isFinite(maxResults) || maxResults <= 1) {
    return [...streams, supportStream];
  }

  const insertAt = Math.min(Math.max(maxResults - 1, 0), streams.length);
  return [
    ...streams.slice(0, insertAt),
    supportStream,
    ...streams.slice(insertAt)
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
    res.status(200).json({ streams: withSupportLink(resolved, config.maxResults) });
  } catch (err) {
    res.status(200).json({ streams: [] });
  }
};
