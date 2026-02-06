const { resolveDebridStreams } = require('../lib/debrid');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const streams = [
    {
      name: 'Test Stream',
      title: 'Jurassic World Rebirth',
      infoHash: 'a87d36a8efd2924e9fb607722de5b453c625884a'
    }
  ];
  
  const config = {
    debridService: 'webtor'
  };
  
  try {
    const resolved = await resolveDebridStreams(streams, config);
    res.status(200).json({ 
      success: true,
      message: 'Webtor test results',
      results: resolved 
    });
  } catch (e) {
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
};
