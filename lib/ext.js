const KNABEN_API = 'https://api.knaben.org/v1';
const EZTV_API = 'https://eztvx.to/api';
const CINEMETA_API = 'https://v3-cinemeta.strem.io/meta';

async function fetchMeta(imdbId, type) {
  const res = await fetch(`${CINEMETA_API}/${type}/${imdbId}.json`);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json?.meta) return null;
  return {
    name: json.meta.name || null,
    year: json.meta.year || null
  };
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

async function searchKnaben(query) {
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
        size: 20,
        hide_unsafe: true,
        hide_xxx: true
      })
    });

    if (!res.ok) return [];
    const data = await res.json();

    const streams = [];
    const seen = new Set();

    for (const hit of (data.hits || [])) {
      let infoHash = hit.hash;
      const magnet = [hit.magnetUrl, hit.magnetLink]
        .find(value => typeof value === 'string' && value.startsWith('magnet:'));

      if (!infoHash && magnet) {
        const match = magnet.match(/urn:btih:([a-fA-F0-9]{40})/i);
        if (match) infoHash = match[1].toLowerCase();
      }

      if (!infoHash || seen.has(infoHash)) continue;
      seen.add(infoHash);

      const size = formatBytes(hit.bytes);
      const seeds = hit.seeders || 0;
      const src = hit.cachedOrigin || 'Knaben';
      const displayTitle = hit.title || 'Unknown';

      streams.push({
        name: 'Flix-Finder',
        title: `${displayTitle}\n${size} | S:${seeds} | ${src}`,
        infoHash
      });
    }

    return streams;
  } catch (e) {
    return [];
  }
}

async function searchEztv(id, options) {
  const parsed = parseId(id);
  if (!parsed?.imdbId) return [];
  const imdbNumeric = parsed.imdbId.replace(/^tt/i, '');
  if (!/^\d+$/.test(imdbNumeric)) return [];

  const url = new URL(`${EZTV_API}/get-torrents`);
  url.searchParams.set('imdb_id', imdbNumeric);
  url.searchParams.set('limit', '20');
  url.searchParams.set('page', '1');

  if (options?.type === 'series' && parsed.season != null && parsed.episode != null) {
    url.searchParams.set('season', String(parsed.season));
    url.searchParams.set('episode', String(parsed.episode));
  }

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Flix-Finder/2.0' }
    });
    if (!res.ok) return [];
    const data = await res.json();

    const streams = [];
    const seen = new Set();

    for (const item of (data.torrents || [])) {
      let infoHash = item.hash || item.info_hash;
      const magnet = item.magnet_url || item.magnetUrl || item.magnet;

      if (!infoHash && magnet) {
        const match = String(magnet).match(/urn:btih:([a-fA-F0-9]{40})/i);
        if (match) infoHash = match[1].toLowerCase();
      }

      if (!infoHash || seen.has(infoHash)) continue;
      seen.add(infoHash);

      const size = formatBytes(item.size_bytes || item.size);
      const seeds = item.seeds || item.seeders || 0;
      const displayTitle = item.title || item.filename || 'Unknown';

      streams.push({
        name: 'Flix-Finder',
        title: `${displayTitle}\n${size} | S:${seeds} | EZTV`,
        infoHash
      });
    }

    return streams;
  } catch (e) {
    return [];
  }
}

function uniqueByInfoHash(streams) {
  const seen = new Set();
  return streams.filter(stream => {
    if (!stream.infoHash) return false;
    if (seen.has(stream.infoHash)) return false;
    seen.add(stream.infoHash);
    return true;
  });
}

async function searchTorrents(id, options) {
  const type = options?.type || 'movie';
  const parsed = parseId(id);
  if (!parsed) return [];

  const meta = await fetchMeta(parsed.imdbId, type);
  if (!meta?.name) return [];

  let query = meta.name;
  if (type === 'movie' && meta.year) {
    query = `${meta.name} ${meta.year}`;
  } else if (type === 'series' && parsed.season != null && parsed.episode != null) {
    const s = String(parsed.season).padStart(2, '0');
    const e = String(parsed.episode).padStart(2, '0');
    query = `${meta.name} S${s}E${e}`;
  }

  const [knabenResults, eztvResults] = await Promise.all([
    searchKnaben(query),
    type === 'series' ? searchEztv(id, { type }) : []
  ]);

  return uniqueByInfoHash([...knabenResults, ...eztvResults]);
}

module.exports = {
  parseConfig,
  parseId,
  normalizeImdbId,
  fetchExtResults: searchTorrents,
  filterStreams
};
