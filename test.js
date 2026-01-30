const { fetchExtResults, parseId } = require('./lib/ext');

async function test() {
  console.log('=== Flix Finder Scraper Test ===\n');

  // Test 1: parseId function
  console.log('1. Testing parseId():');
  console.log('   Movie: tt0111161 =>', parseId('tt0111161'));
  console.log('   Series: tt0944947:1:5 =>', parseId('tt0944947:1:5'));
  console.log('');

  // Test 2: Movie search (The Shawshank Redemption)
  console.log('2. Testing movie search (tt0111161 - The Shawshank Redemption):');
  try {
    const movieStreams = await fetchExtResults('tt0111161', { type: 'movie' });
    console.log(`   Found ${movieStreams.length} streams`);
    if (movieStreams.length > 0) {
      console.log('   First result:', movieStreams[0].title.split('\n')[0]);
    }
  } catch (err) {
    console.log('   Error:', err.message);
  }
  console.log('');

  // Test 3: Series search (Game of Thrones S01E01)
  console.log('3. Testing series search (tt0944947:1:1 - Game of Thrones S01E01):');
  try {
    const seriesStreams = await fetchExtResults('tt0944947:1:1', { type: 'series' });
    console.log(`   Found ${seriesStreams.length} streams`);
    if (seriesStreams.length > 0) {
      console.log('   First result:', seriesStreams[0].title.split('\n')[0]);
    }
  } catch (err) {
    console.log('   Error:', err.message);
  }
  console.log('');

  console.log('=== Test Complete ===');
}

test();
