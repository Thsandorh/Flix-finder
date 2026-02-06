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
    const startTime = Date.now();
    const resolved = await resolveDebridStreams(streams, config);
    const endTime = Date.now();
    
    res.status(200).json({ 
      success: true,
      message: 'Webtor test results',
      executionTime: `${endTime - startTime}ms`,
      results: resolved 
    });
  } catch (e) {
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
};
