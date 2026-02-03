const KNABEN_API = 'https://api.knaben.org/v1';
const EZTV_API = 'https://eztvx.to/api';
const YTS_API = 'https://yts.bz/api/v2';
const ANIMETOSHO_JSON = 'https://feed.animetosho.org/json';
const CINEMETA_API = 'https://v3-cinemeta.strem.io/meta';
const ALL_SOURCES = ['knaben', 'eztv', 'yts', 'animetosho'];

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
  const rawSources = query.sources;
  const normalizedSources = Array.isArray(rawSources)
    ? rawSources.map(source => String(source).toLowerCase().trim()).filter(Boolean)
    : String(rawSources || '').split(',').map(source => source.trim().toLowerCase()).filter(Boolean);
  const sources = rawSources == null ? ALL_SOURCES : normalizedSources.filter(source => ALL_SOURCES.includes(source));
  return {
    quality: String(query.quality || 'any'),
    debridService: String(query.debrid || 'none').toLowerCase(),
    debridToken: String(query.debridToken || '').trim(),
    include: String(query.include || '').split(',').map(s => s.trim()).filter(Boolean),
    exclude: String(query.exclude || '').split(',').map(s => s.trim()).filter(Boolean),
    maxResults: Math.max(parseInt(query.maxResults, 10) || 10, 0),
    sources
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

function extractInfoHash(value) {
  if (!value) return null;
  const match = String(value).match(/urn:btih:([a-fA-F0-9]{40})/i);
  return match ? match[1].toLowerCase() : null;
}

function findMagnetLink(item) {
  if (!item || typeof item !== 'object') return null;
  const candidates = [];

  if (typeof item.magnet === 'string') candidates.push(item.magnet);
  if (typeof item.link === 'string') candidates.push(item.link);
  if (typeof item.url === 'string') candidates.push(item.url);
  if (typeof item.guid === 'string') candidates.push(item.guid);
  if (typeof item.torrent === 'string') candidates.push(item.torrent);

  if (item.enclosure?.url) candidates.push(item.enclosure.url);
  if (Array.isArray(item.enclosures)) {
    for (const enclosure of item.enclosures) {
      if (enclosure?.url) candidates.push(enclosure.url);
    }
  }

  return candidates.find(candidate => String(candidate).startsWith('magnet:')) || null;
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

async function searchYts(id) {
  const parsed = parseId(id);
  if (!parsed?.imdbId) return [];

  try {
    const url = new URL(`${YTS_API}/list_movies.json`);
    url.searchParams.set('query_term', parsed.imdbId);
    url.searchParams.set('limit', '20');
    url.searchParams.set('sort_by', 'seeds');

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Flix-Finder/2.0' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data?.status !== 'ok') return [];

    const movies = data?.data?.movies || [];

    const streams = [];
    const seen = new Set();

    for (const movie of movies) {
      for (const torrent of movie.torrents || []) {
        let infoHash = torrent.hash;
        if (!infoHash || seen.has(infoHash)) continue;
        seen.add(infoHash);

        const size = formatBytes(torrent.size_bytes);
        const seeds = torrent.seeds || 0;
        const titleParts = [
          movie.title_long || movie.title,
          torrent.quality,
          torrent.type
        ].filter(Boolean);
        const displayTitle = titleParts.join(' ');

        streams.push({
          name: 'Flix-Finder',
          title: `${displayTitle}\n${size} | S:${seeds} | YTS`,
          infoHash
        });
      }
    }

    return streams;
  } catch (e) {
    return [];
  }
}

async function searchAnimetosho(query) {
  if (!query) return [];

  try {
    const url = new URL(ANIMETOSHO_JSON);
    url.searchParams.set('filter', query);

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Flix-Finder/2.0' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.items || data?.channel?.item || data?.channel?.items || [];

    const streams = [];
    const seen = new Set();

    for (const item of items) {
      const magnet = findMagnetLink(item);
      const infoHash = item?.info_hash || item?.infoHash || extractInfoHash(magnet);
      if (!infoHash || seen.has(infoHash)) continue;
      seen.add(infoHash);

      const title = item?.title || item?.name || 'Unknown';
      const size = formatBytes(item?.size || item?.content_length || item?.enclosure?.length);
      const seeds = item?.seeders || item?.seeds || 0;

      streams.push({
        name: 'Flix-Finder',
        title: `${title}\n${size} | S:${seeds} | AnimeTosho`,
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

function mergeRoundRobin(groups) {
  const merged = [];
  const max = Math.max(...groups.map(group => group.length));
  for (let i = 0; i < max; i += 1) {
    for (const group of groups) {
      if (group[i]) merged.push(group[i]);
    }
  }
  return merged;
}

async function searchTorrents(id, options) {
  const type = options?.type || 'movie';
  const sources = options?.sources || ALL_SOURCES;
  const parsed = parseId(id);
  if (!parsed) return [];

  const meta = await fetchMeta(parsed.imdbId, type);

  let query = null;
  if (meta?.name) {
    query = meta.name;
    if (type === 'movie' && meta.year) {
      query = `${meta.name} ${meta.year}`;
    } else if (type === 'series' && parsed.season != null && parsed.episode != null) {
      const s = String(parsed.season).padStart(2, '0');
      const e = String(parsed.episode).padStart(2, '0');
      query = `${meta.name} S${s}E${e}`;
    }
  }

  const [knabenResults, eztvResults, ytsResults] = await Promise.all([
    query && sources.includes('knaben') ? searchKnaben(query) : [],
    type === 'series' && sources.includes('eztv') ? searchEztv(id, { type }) : [],
    type === 'movie' && sources.includes('yts') ? searchYts(id) : []
  ]);

  const animetoshoResults = sources.includes('animetosho')
    ? await searchAnimetosho(query)
    : [];

  const merged = type === 'movie'
    ? mergeRoundRobin([knabenResults, ytsResults, animetoshoResults])
    : mergeRoundRobin([knabenResults, eztvResults, animetoshoResults]);
  return uniqueByInfoHash(merged);
}

module.exports = {
  parseConfig,
  parseId,
  normalizeImdbId,
  fetchExtResults: searchTorrents,
  filterStreams
};
