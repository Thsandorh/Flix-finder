const { fetchExtResults, normalizeImdbId, parseConfig, filterStreams } = require('../../../lib/ext');
const { resolveDebridStreams } = require('../../../lib/debrid');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { type, id } = req.query;

  if (!normalizeImdbId(id)) {
    return res.status(200).json({ streams: [] });
  }

  try {
    const config = parseConfig(req.query);
    const streams = await fetchExtResults(id, { type });
    const filtered = filterStreams(streams, config);
    const resolved = await resolveDebridStreams(filtered, config);
    res.status(200).json({ streams: resolved });
  } catch (err) {
    res.status(200).json({ streams: [] });
  }
};
