const KNABEN_API_URL = 'https://api.knaben.org/v1';
const CINEMETA_URL = 'https://v3-cinemeta.strem.io/meta';

async function getTitle(imdbId, type = 'movie') {
  try {
    const response = await fetch(`${CINEMETA_URL}/${type}/${imdbId}.json`);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.meta?.name || null;
  } catch {
    return null;
  }
}

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
    maxResults: Number.isNaN(maxResults) ? 10 : Math.max(maxResults, 0)
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

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
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

async function fetchExtResults(imdbId, options = {}) {
  const type = options.type || 'movie';

  // Get title from Cinemeta
  const title = await getTitle(imdbId, type);
  if (!title) {
    return [];
  }

  const requestBody = {
    search_field: 'title',
    query: title,
    order_by: 'seeders',
    order_direction: 'desc',
    from: 0,
    size: 10,
    hide_unsafe: true,
    hide_xxx: true
  };

  try {
    const response = await fetch(KNABEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const hits = data.hits || [];
    const streams = [];
    const seen = new Set();

    for (const hit of hits) {
      const magnet = hit.magnetUrl || hit.link;
      if (!magnet || !magnet.startsWith('magnet:') || seen.has(magnet)) {
        continue;
      }

      const size = formatSize(hit.bytes);
      const seeders = hit.seeders || 0;
      const source = hit.cachedOrigin || 'Knaben';
      const title = hit.title || 'Unknown';

      const streamTitle = [
        title,
        size ? `📦 ${size}` : '',
        `👥 ${seeders}`,
        `🔍 ${source}`
      ]
        .filter(Boolean)
        .join('\n');

      streams.push({
        name: 'Knaben',
        title: streamTitle,
        url: magnet
      });
      seen.add(magnet);
    }

    return streams;
  } catch {
    return [];
  }
}

module.exports = {
  parseConfig,
  normalizeImdbId,
  fetchExtResults,
  filterStreams
};
