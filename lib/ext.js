const KNABEN_API = 'https://api.knaben.org/v1';
const CINEMETA_API = 'https://v3-cinemeta.strem.io/meta';

async function fetchMeta(imdbId, type) {
  const res = await fetch(`${CINEMETA_API}/${type}/${imdbId}.json`);
  if (!res.ok) return null;
  const json = await res.json();
  return json?.meta?.name || null;
}

function parseConfig(query) {
  query = query || {};
  return {
    quality: String(query.quality || 'any'),
    debridService: String(query.debrid || 'none').toLowerCase(),
    debridToken: String(query.debridToken || '').trim(),
    include: String(query.include || '').split(',').map(s => s.trim()).filter(Boolean),
    exclude: String(query.exclude || '').split(',').map(s => s.trim()).filter(Boolean),
    maxResults: Math.max(parseInt(query.maxResults, 10) || 10, 0)
  };
}

function parseId(id) {
  if (!id) return null;
  const parts = id.split(':');
  const imdbId = parts[0].startsWith('tt') ? parts[0] : (id.match(/tt\d+/i) || [])[0];
  if (!imdbId) return null;
  return {
    imdbId,
    season: parts[1] ? parseInt(parts[1], 10) : null,
    episode: parts[2] ? parseInt(parts[2], 10) : null
  };
}

function normalizeImdbId(id) {
  const p = parseId(id);
  return p ? p.imdbId : null;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function filterStreams(streams, config) {
  let result = streams;

  if (config.quality !== 'any') {
    const q = config.quality.toLowerCase();
    result = result.filter(s => s.title.toLowerCase().includes(q));
  }

  if (config.include.length) {
    result = result.filter(s => {
      const t = s.title.toLowerCase();
      return config.include.every(kw => t.includes(kw.toLowerCase()));
    });
  }

  if (config.exclude.length) {
    result = result.filter(s => {
      const t = s.title.toLowerCase();
      return !config.exclude.some(kw => t.includes(kw.toLowerCase()));
    });
  }

  return config.maxResults ? result.slice(0, config.maxResults) : result;
}

async function searchTorrents(id, options) {
  const type = options?.type || 'movie';
  const parsed = parseId(id);
  if (!parsed) return [];

  const title = await fetchMeta(parsed.imdbId, type);
  if (!title) return [];

  let query = title;
  if (type === 'series' && parsed.season != null && parsed.episode != null) {
    const s = String(parsed.season).padStart(2, '0');
    const e = String(parsed.episode).padStart(2, '0');
    query = `${title} S${s}E${e}`;
  }

  try {
    const res = await fetch(KNABEN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search_field: 'title',
        query,
        order_by: 'seeders',
        order_direction: 'desc',
        from: 0,
        size: 10,
        hide_unsafe: true,
        hide_xxx: true
      })
    });

    if (!res.ok) return [];
    const data = await res.json();

    const streams = [];
    const seen = new Set();

    for (const hit of (data.hits || [])) {
      const magnet = hit.magnetUrl || hit.link;
      if (!magnet || !magnet.startsWith('magnet:') || seen.has(magnet)) continue;
      seen.add(magnet);

      const size = formatBytes(hit.bytes);
      const seeds = hit.seeders || 0;
      const src = hit.cachedOrigin || 'Unknown';

      streams.push({
        name: 'Flix-Finder',
        title: `${hit.title || 'Unknown'}\n${size} | S:${seeds} | ${src}`,
        url: magnet
      });
    }

    return streams;
  } catch (e) {
    return [];
  }
}

module.exports = {
  parseConfig,
  parseId,
  normalizeImdbId,
  fetchExtResults: searchTorrents,
  filterStreams
};
