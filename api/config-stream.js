const { fetchExtResults, normalizeImdbId, parseConfig, filterStreams } = require('../lib/ext');
const { resolveDebridStreams } = require('../lib/debrid');

function decodeConfig(configStr) {
  if (!configStr) return {};
  try {
    const decoded = Buffer.from(configStr, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return {};
  }
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
    const streams = await fetchExtResults(id, { type, providers: config.providers });
    const filtered = filterStreams(streams, config);
    const resolved = await resolveDebridStreams(filtered, config);
    res.status(200).json({ streams: resolved });
  } catch (err) {
    res.status(200).json({ streams: [] });
  }
};
