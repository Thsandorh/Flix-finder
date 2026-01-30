const cheerio = require('cheerio');

const EXT_BASE_URL = 'https://ext.to';
const EXT_BASE_URLS = [EXT_BASE_URL, 'https://search.extto.com'];

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

function getDetailLinks($, baseUrl) {
  const links = new Set();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) {
      return;
    }

    const isInternal = href.startsWith('/');
    const isExtTo = href.startsWith(baseUrl);
    if (!isInternal && !isExtTo) {
      return;
    }

    if (
      href.includes('/browse') ||
      href.includes('/search') ||
      href.includes('#') ||
      href.includes('?')
    ) {
      return;
    }

    links.add(isExtTo ? href.replace(baseUrl, '') : href);
  });

  return Array.from(links);
}

async function fetchDetailMagnets(detailUrl, baseUrl) {
  const parseMagnets = (html) =>
    html.match(/magnet:\?[^"'\\s<]+/gi) || [];

  const response = await fetch(detailUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: EXT_BASE_URL
    }
  });

  if (response.ok) {
    const html = await response.text();
    const matches = parseMagnets(html);
    if (matches.length > 0) {
      return matches;
    }
  } else if (response.status !== 403) {
    return [];
  }

  const proxyPath = detailUrl.replace(baseUrl, '');
  const proxyUrl = `https://r.jina.ai/http://${baseUrl.replace(
    'https://',
    ''
  )}${proxyPath}`;
  const proxyResponse = await fetch(proxyUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  if (!proxyResponse.ok) {
    return [];
  }

  const proxyHtml = await proxyResponse.text();
  return parseMagnets(proxyHtml);
}

async function fetchExtResults(imdbId, options = {}) {
  const maxDetails = Math.max(options.maxDetails || 20, 0);

  const extractStreams = (html) => {
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

    if (streams.length === 0) {
      const magnetMatches = html.match(/magnet:\?[^"'\\s<]+/gi) || [];
      magnetMatches.forEach((magnet) => {
        if (seen.has(magnet)) {
          return;
        }

        streams.push({
          name: 'Ext.to',
          title: 'Ext.to result',
          url: magnet
        });
        seen.add(magnet);
      });
    }

    return { streams, $ };
  };

  const scrapeDetailStreams = async (detailLinks, baseUrl) => {
    const streams = [];
    const seen = new Set();

    for (const path of detailLinks) {
      const detailUrl = path.startsWith('http')
        ? path
        : `${baseUrl}${path}`;
      const magnets = await fetchDetailMagnets(detailUrl, baseUrl);

      magnets.forEach((magnet) => {
        if (seen.has(magnet)) {
          return;
        }

        streams.push({
          name: 'Ext.to',
          title: detailUrl,
          url: magnet
        });
        seen.add(magnet);
      });
    }

    return streams;
  };

  for (const baseUrl of EXT_BASE_URLS) {
    const url = `${baseUrl}/browse/?imdb_id=${encodeURIComponent(imdbId)}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: baseUrl
        }
      });

      if (response.ok) {
        const html = await response.text();
        const { streams, $ } = extractStreams(html);
        if (streams.length > 0) {
          return streams;
        }

        const detailLinks = getDetailLinks($, baseUrl).slice(0, maxDetails);
        if (detailLinks.length) {
          const detailStreams = await scrapeDetailStreams(detailLinks, baseUrl);
          if (detailStreams.length > 0) {
            return detailStreams;
          }
        }
      } else if (response.status === 403) {
        // Try proxy fallback for 403 Forbidden
        const proxyUrl = `https://r.jina.ai/http://${baseUrl.replace(
          'https://',
          ''
        )}/browse/?imdb_id=${encodeURIComponent(imdbId)}`;
        const proxyResponse = await fetch(proxyUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (proxyResponse.ok) {
          const html = await proxyResponse.text();
          const { streams, $ } = extractStreams(html);
          if (streams.length > 0) {
            return streams;
          }

          const detailLinks = getDetailLinks($, baseUrl).slice(0, maxDetails);
          if (detailLinks.length) {
            const detailStreams = await scrapeDetailStreams(
              detailLinks,
              baseUrl
            );
            if (detailStreams.length > 0) {
              return detailStreams;
            }
          }
        }
      }
      // If not ok and not 403, try next base URL
    } catch {
      // Network error, try next base URL
      continue;
    }
  }

  return [];
}

module.exports = {
  parseConfig,
  normalizeImdbId,
  fetchExtResults,
  filterStreams
};
