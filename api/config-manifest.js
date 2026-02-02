function decodeConfig(configStr) {
  if (!configStr) return {};
  try {
    const decoded = Buffer.from(configStr, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

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

  // Parse config from URL path (passed as query param by vercel rewrite)
  const config = decodeConfig(req.query.config);

  // Create a personalized manifest name if config has settings
  const manifestCopy = { ...manifest };
  if (config.quality && config.quality !== 'any') {
    manifestCopy.name = `Flix-Finder (${config.quality})`;
  }

  res.status(200).json(manifestCopy);
};
