const manifest = {
  id: 'com.stremio.flixfinder',
  version: '2.0.0',
  name: 'Flix-Finder',
  description: 'Find and stream torrents from multiple sources',
  logo: 'https://raw.githubusercontent.com/Thsandorh/Flix-finder/main/logo.svg',
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
