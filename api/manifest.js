const manifest = {
  id: 'com.stremio.flixnest',
  version: '2.0.0',
  name: 'FlixNest',
  description: 'Find and stream torrents from multiple sources',
  logo: 'https://i.imgur.com/qlfRst5.png',
  configurable: true,
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt'],
  behaviorHints: {
    configurable: true,
    configurationRequired: false
  }
};

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(manifest);
};
