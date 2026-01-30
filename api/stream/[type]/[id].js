const {
  fetchExtResults,
  normalizeImdbId,
  parseConfig,
  filterStreams
} = require('../../../lib/ext');
const { resolveDebridStreams } = require('../../../lib/debrid');

module.exports = async (req, res) => {
  const { type, id } = req.query;

  if (!normalizeImdbId(id)) {
    res.status(400).json({ streams: [] });
    return;
  }

  try {
    const config = parseConfig(req.query);
    // Pass full id (e.g., tt1234567:1:5) so fetchExtResults can parse season/episode
    const streams = await fetchExtResults(id, { type });
    const filtered = filterStreams(streams, config);
    const resolved = await resolveDebridStreams(filtered, config);
    res.status(200).json({ streams: resolved });
  } catch (error) {
    res.status(200).json({ streams: [], error: error.message });
  }
};
