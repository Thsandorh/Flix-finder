const manifest = {
  id: 'com.flix-finder.ext',
  version: '1.0.0',
  name: 'Flix Finder Ext.to',
  description: 'Stremio addon that searches ext.to by IMDb ID and returns magnet streams.',
  logo: 'https://ext.to/img/logo.png',
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
