const { fetchExtResults, parseId, filterStreams, parseConfig } = require('./lib/ext');

(async () => {
  console.log('Testing FlixNest scraper...\n');

  // Test parseId
  console.log('parseId("tt0111161"):', parseId('tt0111161'));
  console.log('parseId("tt0944947:1:5"):', parseId('tt0944947:1:5'));
  console.log('');

  // Test movie
  console.log('Movie search (Shawshank Redemption):');
  const movies = await fetchExtResults('tt0111161', { type: 'movie' });
  console.log(`Found ${movies.length} results`);
  if (movies[0]) console.log('First:', movies[0].title.split('\n')[0]);
  console.log('');

  // Test series
  console.log('Series search (Breaking Bad S01E01):');
  const series = await fetchExtResults('tt0903747:1:1', { type: 'series' });
  console.log(`Found ${series.length} results`);
  if (series[0]) console.log('First:', series[0].title.split('\n')[0]);
  console.log('');

  // Test filters
  console.log('Filter test (quality=1080p):');
  const config = parseConfig({ quality: '1080p' });
  const filtered = filterStreams(movies, config);
  console.log(`Filtered ${movies.length} -> ${filtered.length}`);

  console.log('\nDone.');
})();
