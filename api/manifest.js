const manifest = {
  id: 'com.flix-finder.knaben',
  version: '2.0.0',
  name: 'Flix Finder',
  description: 'Stremio addon that searches Knaben torrent database and returns magnet streams.',
  logo: 'https://knaben.org/favicon.ico',
  configurable: true,
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt']
};

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(manifest);
};
