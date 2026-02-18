const KNABEN_API = 'https://api.knaben.org/v1';
const EZTV_API = 'https://eztvx.to/api';
const YTS_API = 'https://yts.bz/api/v2';
const ANIMETOSHO_SEARCH = 'https://animetosho.org/search';
const NYAA_SEARCH = 'https://nyaa.si/';
const TORRENTS_CSV_SEARCH = 'https://torrents-csv.com/search';
const CINEMETA_API = 'https://v3-cinemeta.strem.io/meta';
const ALL_SOURCES = ['knaben', 'eztv', 'yts', 'animetosho', 'nyaa', 'torrentscsv'];

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMeta(id, type) {
  const res = await fetch(`${CINEMETA_API}/${type}/${id}.json`);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json?.meta) return null;
  return {
    name: json.meta.name || null,
    year: json.meta.year || null,
    genres: Array.isArray(json.meta.genres) ? json.meta.genres : [],
    country: json.meta.country || null,
    countries: Array.isArray(json.meta.countries) ? json.meta.countries : []
  };
}

function isAnimeMeta(meta) {
  if (!meta) return false;
  const genres = (meta.genres || []).map((genre) => String(genre).toLowerCase());
  if (genres.includes('anime')) return true;

  const countries = [meta.country, ...(meta.countries || [])]
    .map((value) => String(value || '').toLowerCase())
    .filter(Boolean);

  return genres.includes('animation') && countries.some((country) => country.includes('japan'));
}

function parseConfig(query) {
  query = query || {};
  const resolveDebridToken = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!/manifest\.json$/i.test(raw)) return raw;
    try {
      const url = new URL(raw);
      const parts = url.pathname.split('/').filter(Boolean);
      const manifestIndex = parts.findIndex(part => part.toLowerCase() === 'manifest.json');
      if (manifestIndex <= 0) return raw;
      const encoded = parts[manifestIndex - 1];
      const normalized = encoded
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      const decoded = Buffer.from(normalized, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      const nestedToken = String(parsed?.debridToken || '').trim();
      return nestedToken || raw;
    } catch {
      return raw;
    }
  };
  const rawSources = query.sources;
  const normalizedSources = Array.isArray(rawSources)
    ? rawSources.map(source => String(source).toLowerCase().trim()).filter(Boolean)
    : String(rawSources || '').split(',').map(source => source.trim().toLowerCase()).filter(Boolean);
  const sources = rawSources == null ? ALL_SOURCES : normalizedSources.filter(source => ALL_SOURCES.includes(source));
  const rawQuality = query.quality;
  const normalizedQualities = Array.isArray(rawQuality)
    ? rawQuality.map(value => String(value).toLowerCase().trim()).filter(Boolean)
    : String(rawQuality || '').split(',').map(value => value.toLowerCase().trim()).filter(Boolean);
  const allowedQualities = ['2160p', '1080p', '720p'];
  const qualities = normalizedQualities.filter(value => allowedQualities.includes(value));
  const hasAllQualities = qualities.length === allowedQualities.length;
  const allowedSortModes = ['quality_seeders', 'quality_size', 'seeders', 'size'];
  const requestedSort = String(query.sort || 'quality_seeders').toLowerCase();
  const sort = allowedSortModes.includes(requestedSort) ? requestedSort : 'quality_seeders';

  return {
    quality: qualities.length && !hasAllQualities ? qualities.join(',') : 'any',
    qualities: hasAllQualities ? [] : qualities,
    debridService: String(query.debrid || 'none').toLowerCase(),
    debridToken: resolveDebridToken(query.debridToken),
    include: String(query.include || '').split(',').map(s => s.trim()).filter(Boolean),
    exclude: String(query.exclude || '').split(',').map(s => s.trim()).filter(Boolean),
    sort,
    maxResults: Math.max(parseInt(query.maxResults, 10) || 10, 0),
    sources
  };
}

function parseId(id) {
  if (!id) return null;
  const raw = String(id).trim();
  if (!raw) return null;

  const parts = raw.split(':');
  const toIntOrNull = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  let baseId = null;
  let season = null;
  let episode = null;

  if (/^tt\d+$/i.test(parts[0])) {
    baseId = parts[0];
    season = toIntOrNull(parts[1]);
    episode = toIntOrNull(parts[2]);
  } else if (parts.length >= 2 && /^[a-z]+$/i.test(parts[0]) && /^\d+$/.test(parts[1])) {
    // Supports ids like kitsu:123 and kitsu:123:1:2.
    baseId = `${parts[0]}:${parts[1]}`;
    season = toIntOrNull(parts[2]);
    episode = toIntOrNull(parts[3]);
  } else {
    const imdbMatch = raw.match(/tt\d+/i);
    baseId = imdbMatch ? imdbMatch[0] : parts[0];
    season = toIntOrNull(parts[1]);
    episode = toIntOrNull(parts[2]);
  }

  if (!baseId) return null;
  const imdbId = (String(baseId).match(/tt\d+/i) || [])[0] || null;

  return {
    baseId,
    imdbId,
    season,
    episode
  };
}

function normalizeImdbId(id) {
  const p = parseId(id);
  return p ? (p.imdbId || p.baseId) : null;
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

  const qualityFilters = Array.isArray(config.qualities)
    ? config.qualities
    : String(config.quality || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);

  if (qualityFilters.length) {
    result = result.filter((stream) => {
      const title = stream.title.toLowerCase();
      return qualityFilters.some((quality) => title.includes(quality));
    });
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

  result = sortStreams(result, config.sort);

  return config.maxResults ? result.slice(0, config.maxResults) : result;
}

function extractSeedsFromTitle(title) {
  const match = String(title || '').match(/\bS:(\d+)\b/i);
  return match ? parseInt(match[1], 10) : 0;
}

function parseSizeToBytes(text) {
  const match = String(text || '').match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB|TiB|GiB|MiB|KiB)\b/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;

  const unit = match[2].toLowerCase();
  const factors = {
    kib: 1024,
    kb: 1000,
    mib: 1024 ** 2,
    mb: 1000 ** 2,
    gib: 1024 ** 3,
    gb: 1000 ** 3,
    tib: 1024 ** 4,
    tb: 1000 ** 4
  };

  return Math.round(value * (factors[unit] || 1));
}

function extractQualityRank(title) {
  const line = String(title || '').split('\n')[0].toLowerCase();
  if (line.includes('2160p') || line.includes('4k')) return 4;
  if (line.includes('1080p')) return 3;
  if (line.includes('720p')) return 2;
  if (line.includes('480p')) return 1;
  return 0;
}

function sortStreams(streams, sortMode = 'quality_seeders') {
  const mode = String(sortMode || 'quality_seeders').toLowerCase();
  const mapped = streams.map((stream) => ({
    stream,
    qualityRank: extractQualityRank(stream.title),
    seeds: extractSeedsFromTitle(stream.title),
    sizeBytes: parseSizeToBytes(stream.title)
  }));

  mapped.sort((a, b) => {
    if (mode === 'quality_size') {
      return (b.qualityRank - a.qualityRank) || (b.sizeBytes - a.sizeBytes) || (b.seeds - a.seeds);
    }

    if (mode === 'seeders') {
      return (b.seeds - a.seeds) || (b.qualityRank - a.qualityRank) || (b.sizeBytes - a.sizeBytes);
    }

    if (mode === 'size') {
      return (b.sizeBytes - a.sizeBytes) || (b.qualityRank - a.qualityRank) || (b.seeds - a.seeds);
    }

    return (b.qualityRank - a.qualityRank) || (b.seeds - a.seeds) || (b.sizeBytes - a.sizeBytes);
  });

  return mapped.map((item) => item.stream);
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

async function searchNyaa(query) {
  if (!query) return [];

  try {
    const url = new URL(NYAA_SEARCH);
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');
    if (!normalizedQuery) return [];
    url.searchParams.set('q', normalizedQuery);
    url.searchParams.set('f', '0');
    url.searchParams.set('c', '0_0');

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Flix-Finder/2.0' }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const streams = [];
    const seen = new Set();

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const magnetRegex = /href="(magnet:\?xt=urn:btih:(?:[a-fA-F0-9]{40}|[A-Z2-7]{32})[^"\s<]*)"/i;
    const titleRegex = /<a[^>]+href="\/view\/\d+"[^>]*>([\s\S]*?)<\/a>/i;
    const sizeRegex = /<td[^>]+class="[^\"]*text-center[^\"]*"[^>]*>(\d+(?:\.\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB))<\/td>/i;
    const seedsRegex = /<td[^>]+class="[^\"]*text-center[^\"]*"[^>]*>(\d+)<\/td>\s*<td[^>]+class="[^\"]*text-center[^\"]*"[^>]*>\d+<\/td>\s*<td[^>]+class="[^\"]*text-center[^\"]*"[^>]*>\d+<\/td>/i;

    const cleanText = (value) =>
      decodeHtmlEntities(value)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const row = rowMatch[1];
      const magnetMatch = row.match(magnetRegex);
      if (!magnetMatch) continue;

      const infoHash = extractInfoHash(decodeHtmlEntities(magnetMatch[1]));
      if (!infoHash || seen.has(infoHash)) continue;

      const titleMatch = row.match(titleRegex);
      const title = titleMatch ? cleanText(titleMatch[1]) : '';
      if (!title) continue;

      seen.add(infoHash);

      const sizeMatch = row.match(sizeRegex);
      const seedsMatch = row.match(seedsRegex);
      const size = sizeMatch ? cleanText(sizeMatch[1]) : '';
      const seeds = seedsMatch ? seedsMatch[1] : '';
      const meta = [size, seeds ? `S:${seeds}` : null, 'Nyaa'].filter(Boolean).join(' | ');

      streams.push({
        name: 'Flix-Finder',
        title: `${title}\n${meta}`,
        infoHash
      });
    }

    return streams;
  } catch (e) {
    return [];
  }
}

async function searchTorrentsCsv(query) {
  if (!query) return [];

  try {
    const url = new URL(TORRENTS_CSV_SEARCH);
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');
    if (!normalizedQuery) return [];
    url.searchParams.set('q', normalizedQuery);

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Flix-Finder/2.0' }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const streams = [];
    const seen = new Set();

    const cardRegex = /<div[^>]+class="[^"]*card-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    const magnetRegex = /href="(magnet:\?xt=urn:btih:(?:[a-fA-F0-9]{40}|[A-Z2-7]{32})[^"<]*)"/i;
    const titleRegex = /class="[^"]*card-title[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
    const sizeRegex = /<span[^>]*>(\d+(?:\.\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB))<\/span>/i;

    const cleanText = (value) => decodeHtmlEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    let cardMatch;
    while ((cardMatch = cardRegex.exec(html)) !== null) {
      const card = cardMatch[1];
      const magnetMatch = card.match(magnetRegex);
      if (!magnetMatch) continue;

      const magnet = decodeHtmlEntities(magnetMatch[1]);
      const infoHash = extractInfoHash(magnet);
      if (!infoHash || seen.has(infoHash)) continue;

      const titleMatch = card.match(titleRegex);
      const title = titleMatch ? cleanText(titleMatch[1]) : '';
      if (!title) continue;

      seen.add(infoHash);
      const sizeMatch = card.match(sizeRegex);
      const size = sizeMatch ? cleanText(sizeMatch[1]) : '';
      const meta = [size, 'TorrentsCSV'].filter(Boolean).join(' | ');

      streams.push({
        name: 'Flix-Finder',
        title: `${title}\n${meta}`,
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

  const meta = await fetchMeta(parsed.baseId, type);
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

  const animeEligible = isAnimeMeta(meta);

  const [animetoshoResults, nyaaResults, torrentsCsvResults] = await Promise.all([
    animeEligible && sources.includes('animetosho') ? searchAnimetosho(query || baseTitle) : [],
    animeEligible && sources.includes('nyaa') ? searchNyaa(query || baseTitle) : [],
    sources.includes('torrentscsv') ? searchTorrentsCsv(query || baseTitle) : []
  ]);

  const merged = type === 'movie'
    ? mergeRoundRobin([knabenResults, ytsResults, animetoshoResults, nyaaResults, torrentsCsvResults])
    : mergeRoundRobin([knabenResults, eztvResults, animetoshoResults, nyaaResults, torrentsCsvResults]);
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
