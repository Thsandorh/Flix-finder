const KNABEN_API = 'https://api.knaben.org/v1';
const EZTV_API = 'https://eztvx.to/api';
const YTS_API = 'https://yts.bz/api/v2';
const ANIMETOSHO_SEARCH = 'https://animetosho.org/search';
const CINEMETA_API = 'https://v3-cinemeta.strem.io/meta';
const ALL_SOURCES = ['knaben', 'eztv', 'yts', 'animetosho'];

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

function base32ToHex(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of value.toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) return null;
    bits += idx.toString(2).padStart(5, '0');
  }
  const hex = [];
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    const chunk = bits.slice(i, i + 4);
    hex.push(parseInt(chunk, 2).toString(16));
  }
  return hex.join('');
}

function extractInfoHash(value) {
  if (!value) return null;
  const match = String(value).match(/urn:btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
  if (!match) return null;
  const raw = match[1];
  if (/^[a-fA-F0-9]{40}$/.test(raw)) {
    return raw.toLowerCase();
  }
  const converted = base32ToHex(raw);
  return converted ? converted.toLowerCase() : null;
}

function decodeHtmlEntities(value) {
  if (!value) return '';
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
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
    const res = await fetchWithTimeout(KNABEN_API, {
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
    }, 5000);

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
    const url = new URL(ANIMETOSHO_SEARCH);
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');
    const encodedQuery = encodeURIComponent(normalizedQuery).replace(/%20/g, '+');
    if (!encodedQuery || encodedQuery === '+') return [];
    url.search = `?q=${encodedQuery}`;

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Flix-Finder/2.0' }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const streams = [];
    const seen = new Set();

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const magnetRegex = /(magnet:\?xt=urn:btih:(?:[a-fA-F0-9]{40}|[A-Z2-7]{32})[^"'\\s<]*)/i;
    const titleRegexes = [
      /<a[^>]+class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      /<div[^>]+class="[^"]*link[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i,
      /<a[^>]+href="[^"]*\/view\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i
    ];
    const sizeRegex = /<td[^>]+class="[^"]*size[^"]*"[^>]*>([\s\S]*?)<\/td>/i;
    const seedCellRegex = /<td[^>]+class="[^"]*seed[^"]*"[^>]*>([\s\S]*?)<\/td>/i;

    const cleanText = (value) =>
      decodeHtmlEntities(value)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const extractTitle = (block) => {
      for (const regex of titleRegexes) {
        const match = block.match(regex);
        if (match) return cleanText(match[1]);
      }
      return '';
    };

    const extractSize = (block) => {
      const sizeMatch = block.match(sizeRegex);
      if (sizeMatch) return cleanText(sizeMatch[1]);
      const looseMatch = block.match(/(\d+(?:\.\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB))/i);
      return looseMatch ? cleanText(looseMatch[1]) : '';
    };

    const extractSeeds = (block) => {
      const titleMatch = block.match(/Seeders:\s*(\d+)/i);
      if (titleMatch) return titleMatch[1];
      const seedCell = block.match(seedCellRegex);
      if (seedCell) return cleanText(seedCell[1]);
      const bracketMatch = block.match(/\[(\d+)\s*\u2191/);
      return bracketMatch ? bracketMatch[1] : '';
    };

    const pushStreamFromBlock = (block, magnetMatch) => {
      if (!magnetMatch) return;
      const magnet = decodeHtmlEntities(magnetMatch[1]);
      const infoHash = extractInfoHash(magnet);
      if (!infoHash || seen.has(infoHash)) return;

      const title = extractTitle(block);
      if (!title) return;

      seen.add(infoHash);
      const size = extractSize(block);
      const seeds = extractSeeds(block);
      const meta = [size, seeds ? `S:${seeds}` : null, 'AnimeTosho'].filter(Boolean).join(' | ');

      streams.push({
        name: 'Flix-Finder',
        title: `${title}\n${meta}`,
        infoHash
      });
    };

    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const row = rowMatch[1];
      const magnetMatch = row.match(magnetRegex);
      if (!magnetMatch) continue;
      pushStreamFromBlock(row, magnetMatch);
    }

    if (!streams.length) {
      const magnetMatches = [...html.matchAll(new RegExp(magnetRegex.source, 'gi'))];
      for (const magnetMatch of magnetMatches) {
        const startIndex = magnetMatch.index ?? 0;
        const sliceStart = Math.max(0, startIndex - 4000);
        const sliceEnd = startIndex + 4000;
        const slice = html.slice(sliceStart, sliceEnd);
        pushStreamFromBlock(slice, magnetMatch);
      }
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

function isExactEpisodeMatch(title, season, episode) {
  const line = String(title || '').split('\n')[0];
  if (!line) return false;
  const s = Number(season);
  const e = Number(episode);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return true;

  const sPattern = `0*${s}`;
  const ePattern = `0*${e}`;

  const basePatterns = [
    new RegExp(`\\bS${sPattern}\\s*[\\.\\-_ ]?\\s*E${ePattern}\\b`, 'i'),
    new RegExp(`\\b${s}\\s*[xX]\\s*0*${e}\\b`, 'i'),
    new RegExp(`\\bSeason\\s*${sPattern}\\s*(?:Episode|Ep|E)\\s*${ePattern}\\b`, 'i')
  ];

  const isMatch = basePatterns.some((re) => re.test(line));
  if (!isMatch) return false;

  const rangePatterns = [
    new RegExp(`\\bS${sPattern}\\s*[\\.\\-_ ]?\\s*E${ePattern}\\s*[-\\u2013]\\s*E?0*\\d+\\b`, 'i'),
    new RegExp(`\\bS${sPattern}\\s*[\\.\\-_ ]?\\s*E${ePattern}\\s*[-\\u2013]\\s*0*\\d+\\b`, 'i'),
    new RegExp(`\\bS${sPattern}\\s*[\\.\\-_ ]?\\s*E${ePattern}\\s*E0*\\d+\\b`, 'i'),
    new RegExp(`\\b${s}\\s*[xX]\\s*0*${e}\\s*[-\\u2013]\\s*0*\\d+\\b`, 'i')
  ];

  if (rangePatterns.some((re) => re.test(line))) return false;
  return true;
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
  const baseTitle = meta?.name ? meta.name.trim() : null;

  let query = null;
  if (baseTitle) {
    query = baseTitle;
    if (type === 'movie' && meta.year) {
      query = `${baseTitle} ${meta.year}`;
    } else if (type === 'series' && parsed.season != null && parsed.episode != null) {
      const s = String(parsed.season).padStart(2, '0');
      const e = String(parsed.episode).padStart(2, '0');
      query = `${baseTitle} S${s}E${e}`;
    }
  }

  const [knabenResults, eztvResults, ytsResults] = await Promise.all([
    query && sources.includes('knaben') ? searchKnaben(query) : [],
    type === 'series' && sources.includes('eztv') ? searchEztv(id, { type }) : [],
    type === 'movie' && sources.includes('yts') ? searchYts(id) : []
  ]);

  const animetoshoResults = sources.includes('animetosho')
    ? await searchAnimetosho(query || baseTitle)
    : [];

  const merged = type === 'movie'
    ? mergeRoundRobin([knabenResults, ytsResults, animetoshoResults])
    : mergeRoundRobin([knabenResults, eztvResults, animetoshoResults]);
  const unique = uniqueByInfoHash(merged);
  if (type === 'series' && parsed.season != null && parsed.episode != null) {
    return unique.filter(stream => isExactEpisodeMatch(stream.title, parsed.season, parsed.episode));
  }
  return unique;
}

module.exports = {
  parseConfig,
  parseId,
  normalizeImdbId,
  fetchExtResults: searchTorrents,
  filterStreams
};



