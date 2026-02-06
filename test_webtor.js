const { resolveDebridStreams } = require('./lib/debrid');

(async () => {
  console.log('Testing Webtor resolver...');
  
  const streams = [
    {
      name: 'Test Stream',
      title: 'Test Movie',
      infoHash: 'a87d36a8efd2924e9fb607722de5b453c625884a'
    }
  ];
  
  const config = {
    debridService: 'webtor'
  };
  
  try {
    const resolved = await resolveDebridStreams(streams, config);
    console.log('Resolved streams:', JSON.stringify(resolved, null, 2));
  } catch (e) {
    console.error('Error:', e);
  }
})();
