const { fetchExtResults, normalizeImdbId } = require('../../../lib/ext');

module.exports = async (req, res) => {
  const { id } = req.query;
  const imdbId = normalizeImdbId(id);

  if (!imdbId) {
    res.status(400).json({ streams: [] });
    return;
  }

  try {
    const streams = await fetchExtResults(imdbId);
    res.status(200).json({ streams });
  } catch (error) {
    res.status(200).json({ streams: [], error: error.message });
  }
};
