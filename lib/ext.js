const cheerio = require('cheerio');

const EXT_BASE_URL = 'https://ext.to';

function normalizeImdbId(rawId) {
  if (!rawId) {
    return null;
  }

  if (rawId.startsWith('tt')) {
    return rawId;
  }

  const match = rawId.match(/tt\d+/i);
  return match ? match[0] : null;
}

function extractTitle($link) {
  const fallback = $link.text().trim();
  const rowTitle = $link.closest('tr').find('td').first().text().trim();
  return rowTitle || fallback || 'Ext.to result';
}

async function fetchExtResults(imdbId) {
  const url = `${EXT_BASE_URL}/browse/?imdb_id=${encodeURIComponent(imdbId)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Stremio-Addon/1.0 (+https://vercel.com)'
    }
  });

  if (!response.ok) {
    throw new Error(`Ext.to request failed with status ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const links = $('a[href^="magnet:"]');
  const streams = [];

  links.each((_, element) => {
    const $link = $(element);
    const magnet = $link.attr('href');

    if (!magnet) {
      return;
    }

    const title = extractTitle($link);
    streams.push({
      title,
      url: magnet
    });
  });

  return streams;
}

module.exports = {
  normalizeImdbId,
  fetchExtResults
};
