const { fetchExtResults, normalizeImdbId, parseConfig, filterStreams } = require('../../../lib/ext');
const { resolveDebridStreams } = require('../../../lib/debrid');
const { withSupportLink } = require('../../../lib/support');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { type, id } = req.query;

  if (!normalizeImdbId(id)) {
    return res.status(200).json({ streams: [] });
  }

  try {
    const config = parseConfig(req.query);
    const streams = await fetchExtResults(id, { type, sources: config.sources });
    const filtered = filterStreams(streams, config);
    const resolved = await resolveDebridStreams(filtered, config);
    res.status(200).json({ streams: withSupportLink(resolved) });
  } catch (err) {
    res.status(200).json({ streams: [] });
  }
};
