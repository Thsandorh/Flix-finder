const cheerio = require('cheerio');

const EXT_BASE_URL = 'https://ext.to';

function parseConfig(query = {}) {
  const quality = String(query.quality || 'any');
  const debridService = String(query.debrid || 'none').toLowerCase();
  const debridToken = String(query.debridToken || '').trim();
  const include = String(query.include || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const exclude = String(query.exclude || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const maxResults = Number.parseInt(query.maxResults, 10);

  return {
    quality,
    debridService,
    debridToken,
    include,
    exclude,
    maxResults: Number.isNaN(maxResults) ? 0 : Math.max(maxResults, 0)
  };
}

function normalizeImdbId(rawId) {
  if (!rawId) {
    return null;
  }

  const candidate = rawId.split(':')[0];
  if (candidate.startsWith('tt')) {
    return candidate;
  }

  const match = rawId.match(/tt\d+/i);
  return match ? match[0] : null;
}

function extractRowText($, $row) {
  return $row
    .find('td')
    .map((_, cell) => {
      const text = $(cell).text().trim();
      return text.replace(/\s+/g, ' ');
    })
    .get()
    .filter(Boolean)
    .join(' ');
}

function extractStreamMeta($, $link) {
  const $row = $link.closest('tr');
  const rowText = extractRowText($, $row);
  const fallbackTitle = $link.text().trim();
  const title = rowText || fallbackTitle || 'Ext.to result';
  return {
    name: 'Ext.to',
    title
  };
}

function matchesKeywordList(title, list) {
  const lower = title.toLowerCase();
  return list.every((keyword) => lower.includes(keyword.toLowerCase()));
}

function includesAnyKeyword(title, list) {
  const lower = title.toLowerCase();
  return list.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function filterStreams(streams, config) {
  let filtered = streams;

  if (config.quality && config.quality !== 'any') {
    filtered = filtered.filter((stream) =>
      stream.title.toLowerCase().includes(config.quality.toLowerCase())
    );
  }

  if (config.include.length) {
    filtered = filtered.filter((stream) =>
      matchesKeywordList(stream.title, config.include)
    );
  }

  if (config.exclude.length) {
    filtered = filtered.filter(
      (stream) => !includesAnyKeyword(stream.title, config.exclude)
    );
  }

  if (config.maxResults) {
    filtered = filtered.slice(0, config.maxResults);
  }

  return filtered;
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
  const seen = new Set();

  links.each((_, element) => {
    const $link = $(element);
    const magnet = $link.attr('href');

    if (!magnet || seen.has(magnet)) {
      return;
    }

    const meta = extractStreamMeta($, $link);
    streams.push({
      ...meta,
      url: magnet
    });
    seen.add(magnet);
  });

  return streams;
}

module.exports = {
  parseConfig,
  normalizeImdbId,
  fetchExtResults,
  filterStreams
};
