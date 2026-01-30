const {
  fetchExtResults,
  normalizeImdbId,
  parseConfig,
  filterStreams
} = require('../../../lib/ext');
const { resolveDebridStreams } = require('../../../lib/debrid');

module.exports = async (req, res) => {
  const { id } = req.query;
  const imdbId = normalizeImdbId(id);

  if (!imdbId) {
    res.status(400).json({ streams: [] });
    return;
  }

  try {
    const config = parseConfig(req.query);
    const streams = await fetchExtResults(imdbId);
    const filtered = filterStreams(streams, config);
    const resolved = await resolveDebridStreams(filtered, config);
    res.status(200).json({ streams: resolved });
  } catch (error) {
    res.status(200).json({ streams: [], error: error.message });
  }
};
