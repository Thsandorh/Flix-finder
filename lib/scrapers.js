const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const defaultHeaders = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

function extractInfoHash(magnet) {
  if (!magnet) return null;
  const match = magnet.match(/urn:btih:([a-fA-F0-9]{40})/i);
  if (match) return match[1].toLowerCase();
  // Handle base32 encoded info hash
  const base32Match = magnet.match(/urn:btih:([a-zA-Z2-7]{32})/i);
  if (base32Match) return base32Match[1].toLowerCase();
  return null;
}

function formatBytes(sizeStr) {
  // Already formatted, just return it
  return sizeStr || '';
}

// 1337x Scraper
async function search1337x(query) {
  const baseUrl = 'https://1337x.to';
  const searchUrl = `${baseUrl}/search/${encodeURIComponent(query)}/1/`;

  try {
    const response = await fetch(searchUrl, { headers: defaultHeaders });
    if (!response.ok) return [];

    const html = await response.text();
    const $ = cheerio.load(html);
    const streams = [];
    const seen = new Set();

    const rows = $('.table-list tbody tr');

    // Process rows (limit to avoid too many requests)
    const rowsToProcess = rows.slice(0, 10);

    for (let i = 0; i < rowsToProcess.length; i++) {
      const tr = rowsToProcess[i];
      try {
        const name = $(tr).find('.coll-1.name a').last().text().trim();
        const detailPath = $(tr).find('.coll-1.name a').last().attr('href');
        const seeders = parseInt($(tr).find('.coll-2.seeds').text().trim(), 10) || 0;
        const leechers = parseInt($(tr).find('.coll-3.leeches').text().trim(), 10) || 0;
        const size = $(tr).find('.coll-4.size').text().trim().replace(/\d+$/, '').trim();

        if (!detailPath || !name) continue;

        // Fetch detail page for magnet link
        const detailUrl = `${baseUrl}${detailPath}`;
        const detailResponse = await fetch(detailUrl, { headers: defaultHeaders });
        if (!detailResponse.ok) continue;

        const detailHtml = await detailResponse.text();
        const detail$ = cheerio.load(detailHtml);
        const magnet = detail$('a[href^="magnet:?xt=urn:btih"]').attr('href');

        const infoHash = extractInfoHash(magnet);
        if (!infoHash || seen.has(infoHash)) continue;
        seen.add(infoHash);

        streams.push({
          name: 'Flix-Finder',
          title: `${name}\n${size} | S:${seeders} L:${leechers} | 1337x`,
          infoHash,
          seeders,
          source: '1337x'
        });
      } catch (e) {
        // Skip failed items
        continue;
      }
    }

    return streams;
  } catch (e) {
    console.error('1337x scraper error:', e.message);
    return [];
  }
}

// TorrentGalaxy Scraper
async function searchTorrentGalaxy(query) {
  const baseUrl = 'https://torrentgalaxy.to';
  const searchUrl = `${baseUrl}/torrents.php?search=${encodeURIComponent(query)}&lang=0&nox=2`;

  try {
    const response = await fetch(searchUrl, { headers: defaultHeaders });
    if (!response.ok) return [];

    const html = await response.text();
    const $ = cheerio.load(html);
    const streams = [];
    const seen = new Set();

    const rows = $('.tgxtablerow');

    rows.each((i, row) => {
      if (i >= 15) return false; // Limit results

      try {
        const name = $(row).find('a[href^="/torrent/"]').attr('title') ||
                     $(row).find('a[href^="/torrent/"]').text().trim();
        const magnet = $(row).find('a[href^="magnet:"]').attr('href');
        const sizeEl = $(row).find('span.badge-secondary').first();
        const size = sizeEl.text().trim();

        // Find seeders/leechers
        const slCell = $(row).find('span[title="Seeders/Leechers"]').parent();
        const seedText = $(row).find('span[style*="color:green"], font[color="green"]').first().text().trim();
        const leechText = $(row).find('span[style*="color:#ff0000"], font[color="#ff0000"]').first().text().trim();
        const seeders = parseInt(seedText, 10) || 0;
        const leechers = parseInt(leechText, 10) || 0;

        const infoHash = extractInfoHash(magnet);
        if (!infoHash || seen.has(infoHash) || !name) return;
        seen.add(infoHash);

        streams.push({
          name: 'Flix-Finder',
          title: `${name}\n${size} | S:${seeders} L:${leechers} | TGx`,
          infoHash,
          seeders,
          source: 'torrentgalaxy'
        });
      } catch (e) {
        // Skip failed items
      }
    });

    return streams;
  } catch (e) {
    console.error('TorrentGalaxy scraper error:', e.message);
    return [];
  }
}

// Export all scrapers
module.exports = {
  search1337x,
  searchTorrentGalaxy,

  // Combined search function
  async searchAll(query, providers = ['knaben', '1337x', 'torrentgalaxy']) {
    const results = [];
    const searches = [];

    if (providers.includes('1337x')) {
      searches.push(search1337x(query).then(r => results.push(...r)));
    }
    if (providers.includes('torrentgalaxy')) {
      searches.push(searchTorrentGalaxy(query).then(r => results.push(...r)));
    }

    await Promise.allSettled(searches);

    // Sort by seeders
    results.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));

    return results;
  }
};
