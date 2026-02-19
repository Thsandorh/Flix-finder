const KNABEN_API = 'https://api.knaben.org/v1';
const EZTV_API = 'https://eztvx.to/api';
const YTS_API = 'https://yts.bz/api/v2';
const BITSEARCH_API = 'https://bitsearch.to/api/v1/search';
const ANIMETOSHO_SEARCH = 'https://animetosho.org/search';
const NYAA_SEARCH = 'https://nyaa.si/';
const TORRENTS_CSV_SEARCH = 'https://torrents-csv.com/search';
const CINEMETA_API = 'https://v3-cinemeta.strem.io/meta';
const ANILIST_API = 'https://graphql.anilist.co';
const ALL_SOURCES = ['knaben', 'bitsearch', 'eztv', 'yts', 'animetosho', 'nyaa', 'torrentscsv'];

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
  const extractAnimeProviderAndNumericId = () => {
    const raw = String(id || '').trim();
    const providerMatch = raw.match(/\b(kitsu|anilist|animekitsu)\b/i);
    if (!providerMatch) return null;
    const numberMatch = raw.match(/(\d+)/);
    if (!numberMatch) return null;
    const provider = providerMatch[1].toLowerCase() === 'animekitsu' ? 'kitsu' : providerMatch[1].toLowerCase();
    return { provider, numericId: numberMatch[1] };
  };

  const fetchAniListMetaByNumericId = async (numericId) => {
    if (!numericId) return null;
    try {
      const res = await fetchWithTimeout(ANILIST_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Flix-Finder/2.0'
        },
        body: JSON.stringify({
          query: 'query ($id: Int) { Media(id: $id, type: ANIME) { title { romaji english native } startDate { year } format episodes countryOfOrigin genres } }',
          variables: { id: Number(numericId) }
        })
      }, 5000);
      if (!res.ok) return null;
      const json = await res.json();
      const media = json?.data?.Media;
      if (!media) return null;
      const title = media?.title || {};
      const format = String(media?.format || '').toUpperCase();
      const subtype = format === 'MOVIE' ? 'movie' : null;
      const country = String(media?.countryOfOrigin || '').toUpperCase() === 'JP' ? 'Japan' : null;

      return {
        name: title.english || title.romaji || title.native || null,
        year: Number.isFinite(Number(media?.startDate?.year)) ? Number(media.startDate.year) : null,
        subtype,
        episodeCount: Number.isFinite(Number(media?.episodes)) ? Number(media.episodes) : null,
        genres: ['anime', ...(Array.isArray(media?.genres) ? media.genres : [])],
        country,
        countries: country ? [country] : []
      };
    } catch {
      return null;
    }
  };

  if (/\b(kitsu|anilist|animekitsu)\b/i.test(String(id || '').trim())) {
    const parsedAnimeId = extractAnimeProviderAndNumericId();
    if (!parsedAnimeId) return null;
    const { provider, numericId } = parsedAnimeId;

    if (provider === 'kitsu') {
      try {
        const kitsuRes = await fetchWithTimeout(`https://kitsu.io/api/edge/anime/${numericId}`, {
          headers: { 'User-Agent': 'Flix-Finder/2.0' }
        }, 5000);
        if (kitsuRes.ok) {
          const kitsuJson = await kitsuRes.json();
          const attrs = kitsuJson?.data?.attributes || {};
          const titles = attrs.titles || {};
          const name = attrs.canonicalTitle || titles.en || titles.en_jp || titles.ja_jp || null;
          const year = parseInt(String(attrs.startDate || '').slice(0, 4), 10);

          return {
            name: name || null,
            year: Number.isFinite(year) ? year : null,
            subtype: attrs.subtype || null,
            episodeCount: Number.isFinite(Number(attrs.episodeCount)) ? Number(attrs.episodeCount) : null,
            genres: ['anime'],
            country: 'Japan',
            countries: ['Japan']
          };
        }
      } catch {
        // Fallback to AniList below.
      }
    }

    return await fetchAniListMetaByNumericId(numericId);
  }

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

  const hasJapanCountry = countries.some((country) => {
    const compact = country.replace(/[^a-z]/g, '');
    return compact.includes('japan') || compact === 'jp' || compact === 'jpn';
  });

  return genres.includes('animation') && hasJapanCountry;
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
    bitsearchApiKey: String(query.bitsearchApiKey || '').trim(),
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
  const parseIndex = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  let baseId = null;
  let season = null;
  let episode = null;

  if (/^tt\d+$/i.test(parts[0])) {
    baseId = parts[0];
    season = parseIndex(parts[1]);
    episode = parseIndex(parts[2]);
  } else if (parts.length >= 2 && /^[a-z]+$/i.test(parts[0]) && /^\d+$/.test(parts[1])) {
    // Supports ids like kitsu:15117 and kitsu:15117:1:3
    const provider = /^animekitsu$/i.test(parts[0]) ? 'kitsu' : String(parts[0]).toLowerCase();
    baseId = `${provider}:${parts[1]}`;
    if (/^(kitsu|anilist)$/i.test(provider) && parts.length === 3) {
      // AnimeKitsu convention: kitsu:{id}:{episode}
      // Do not force season=1 because sequel entries are separate IDs.
      season = null;
      episode = parseIndex(parts[2]);
    } else {
      season = parseIndex(parts[2]);
      episode = parseIndex(parts[3]);
    }
  } else if (/\b(kitsu|anilist|animekitsu)\b/i.test(raw)) {
    // Handles loose variants like kitsu:anime:42765:2 or animekitsu:42765:2
    const providerMatch = raw.match(/\b(kitsu|anilist|animekitsu)\b/i);
    const numbers = raw.match(/\d+/g) || [];
    if (providerMatch && numbers.length) {
      const provider = providerMatch[1].toLowerCase() === 'animekitsu' ? 'kitsu' : providerMatch[1].toLowerCase();
      baseId = `${provider}:${numbers[0]}`;
      if (numbers.length === 2) {
        season = null;
        episode = parseIndex(numbers[1]);
      } else if (numbers.length >= 3) {
        season = parseIndex(numbers[1]);
        episode = parseIndex(numbers[2]);
      }
    }
  } else {
    const imdbMatch = raw.match(/tt\d+/i);
    baseId = imdbMatch ? imdbMatch[0] : parts[0];
    season = parseIndex(parts[1]);
    episode = parseIndex(parts[2]);
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

function buildSearchVariants(query) {
  const primary = String(query || '').trim().replace(/\s+/g, ' ');
  if (!primary) return [];

  const ascii = primary
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return [...new Set([primary, ascii].filter(Boolean))];
}

function extractVideoCodec(text) {
  const line = String(text || '').toLowerCase();
  if (/\b(hevc|x265|h\.?265)\b/i.test(line)) return 'HEVC';
  if (/\b(av1)\b/i.test(line)) return 'AV1';
  if (/\b(x264|h\.?264|avc)\b/i.test(line)) return 'H.264';
  return '';
}

function buildStreamTitle(displayTitle, meta = {}) {
  const title = String(displayTitle || 'Unknown').trim();
  const parts = [];

  if (meta.size) parts.push(`💾 ${meta.size}`);
  if (meta.seeds != null && meta.seeds !== '') parts.push(`👥 S:${meta.seeds}`);
  if (meta.source) parts.push(`🌐 ${meta.source}`);

  const codec = extractVideoCodec(title);
  if (codec) parts.push(`🎞 ${codec}`);

  return parts.length ? `${title}\n${parts.join(' ')}` : title;
}

function filterStreams(streams, config) {
  let result = streams;
  const streamMetaLine = (stream) => String(stream?.title || '').split('\n').slice(1).join(' ');
  const isNyaaStream = (stream) => /\bnyaa(?:\.si)?\b/i.test(streamMetaLine(stream));
  const isRuTrackerStream = (stream) => /\brutracker(?:\.org)?\b/i.test(streamMetaLine(stream));

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
  // Keep Nyaa entries at the top only for anime requests.
  if (String(config?.type || '').toLowerCase() === 'anime') {
    result = [...result].sort((a, b) => {
      const aNyaa = isNyaaStream(a) ? 1 : 0;
      const bNyaa = isNyaaStream(b) ? 1 : 0;
      return bNyaa - aNyaa;
    });
  }

  // For non-anime movie/series browsing, keep RuTracker entries at the end.
  const isMovieOrSeries = ['movie', 'series'].includes(String(config?.type || '').toLowerCase());
  if (['movie', 'series'].includes(String(config?.type || '').toLowerCase())) {
    result = [...result].sort((a, b) => {
      const aRu = isRuTrackerStream(a) ? 1 : 0;
      const bRu = isRuTrackerStream(b) ? 1 : 0;
      return aRu - bRu;
    });
  }

  const maxResults = Math.max(parseInt(config?.maxResults, 10) || 0, 0);
  if (!maxResults) return result;

  if (!isMovieOrSeries) {
    return result.slice(0, maxResults);
  }

  const nonRu = result.filter((stream) => !isRuTrackerStream(stream));
  const ru = result.filter((stream) => isRuTrackerStream(stream));
  const ruCap = Math.min(2, Math.max(1, Math.floor(maxResults / 5)));
  const pickedNonRu = nonRu.slice(0, maxResults - ruCap);
  const pickedRu = ru.slice(0, Math.max(0, Math.min(ruCap, maxResults - pickedNonRu.length)));

  return [...pickedNonRu, ...pickedRu];
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
        title: buildStreamTitle(displayTitle, { size, seeds, source: src }),
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
        title: buildStreamTitle(displayTitle, { size, seeds, source: 'EZTV' }),
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
          title: buildStreamTitle(displayTitle, { size, seeds, source: 'YTS' }),
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

      streams.push({
        name: 'Flix-Finder',
        title: buildStreamTitle(title, { size, seeds, source: 'AnimeTosho' }),
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
    const variants = buildSearchVariants(query);
    if (!variants.length) return [];
    const headers = { 'User-Agent': 'Flix-Finder/2.0' };
    const cleanText = (value) =>
      decodeHtmlEntities(value)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Primary path: RSS is far more stable than scraping Nyaa HTML markup.
    for (const normalizedQuery of variants) {
      const rssUrl = new URL(NYAA_SEARCH);
      rssUrl.searchParams.set('page', 'rss');
      rssUrl.searchParams.set('q', normalizedQuery);
      rssUrl.searchParams.set('f', '0');
      rssUrl.searchParams.set('c', '0_0');

      const rssRes = await fetch(rssUrl.toString(), { headers });
      if (!rssRes.ok) continue;
      const xml = await rssRes.text();
      const rssStreams = [];
      const seen = new Set();
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;

      let itemMatch;
      while ((itemMatch = itemRegex.exec(xml)) !== null) {
        const item = itemMatch[1];
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
        const infoHashMatch = item.match(/<nyaa:infoHash>([a-fA-F0-9]{40})<\/nyaa:infoHash>/i);
        if (!titleMatch || !infoHashMatch) continue;

        const infoHash = String(infoHashMatch[1]).toLowerCase();
        if (seen.has(infoHash)) continue;
        seen.add(infoHash);

        const title = cleanText(titleMatch[1]);
        if (!title) continue;

        const sizeMatch = item.match(/<nyaa:size>([\s\S]*?)<\/nyaa:size>/i);
        const seedsMatch = item.match(/<nyaa:seeders>(\d+)<\/nyaa:seeders>/i);

        rssStreams.push({
          name: 'Flix-Finder',
          title: buildStreamTitle(title, {
            size: sizeMatch ? cleanText(sizeMatch[1]) : '',
            seeds: seedsMatch ? seedsMatch[1] : '',
            source: 'Nyaa'
          }),
          infoHash
        });
      }

      if (rssStreams.length) return rssStreams;
    }

    return [];
  } catch (e) {
    return [];
  }
}

async function searchBitsearch(query, options = {}) {
  const apiKey = String(options?.apiKey || '').trim();
  if (!query) return [];

  try {
    const url = new URL(BITSEARCH_API);
    const normalizedQuery = String(query).trim().replace(/\s+/g, ' ');
    if (!normalizedQuery) return [];

    url.searchParams.set('q', normalizedQuery);
    url.searchParams.set('sort', 'seeders');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('limit', String(Math.max(1, Math.min(100, Number(options?.limit) || 20))));

    const category = Number(options?.category);
    if (Number.isFinite(category) && category > 0) {
      url.searchParams.set('category', String(category));
    }

    const subCategory = Number(options?.subCategory);
    if (Number.isFinite(subCategory) && subCategory > 0) {
      url.searchParams.set('subCategory', String(subCategory));
    }

    const headers = { 'User-Agent': 'Flix-Finder/2.0' };
    if (apiKey) headers['x-api-key'] = apiKey;

    const res = await fetchWithTimeout(url.toString(), { headers }, 3000);
    if (!res.ok) return [];

    const data = await res.json().catch(() => null);
    if (!data?.success || !Array.isArray(data?.results)) return [];

    const streams = [];
    const seen = new Set();
    for (const result of data.results) {
      const infoHash = String(result?.infohash || result?.infoHash || '').trim().toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(infoHash) || seen.has(infoHash)) continue;
      seen.add(infoHash);

      const title = String(result?.title || 'Unknown').trim();
      const size = formatBytes(Number(result?.size || 0));
      const seeds = Number.isFinite(Number(result?.seeders)) ? Number(result.seeders) : 0;

      streams.push({
        name: 'Flix-Finder',
        title: buildStreamTitle(title, { size, seeds, source: 'BitSearch' }),
        infoHash
      });
    }
    return streams;
  } catch {
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

      streams.push({
        name: 'Flix-Finder',
        title: buildStreamTitle(title, { size, source: 'TorrentsCSV' }),
        infoHash
      });
    }

    return streams;
  } catch (e) {
    return [];
  }
}



function uniqueByInfoHash(streams) {
  const grouped = new Map();

  streams.forEach((stream, index) => {
    const hash = String(stream?.infoHash || '').trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(hash)) return;
    const list = grouped.get(hash) || [];
    list.push({ stream, index });
    grouped.set(hash, list);
  });

  const isNyaa = (stream) => /\bNyaa\b/i.test(String(stream?.title || '')) || /\bNyaa\b/i.test(String(stream?.source || ''));
  const isAnimeTosho = (stream) => /\bAnimeTosho\b/i.test(String(stream?.title || '')) || /\bAnimeTosho\b/i.test(String(stream?.source || ''));

  return [...grouped.values()]
    .map((entries) => {
      const nyaaEntry = entries.find((entry) => isNyaa(entry.stream));
      if (nyaaEntry) return nyaaEntry;

      const animeToshoEntry = entries.find((entry) => isAnimeTosho(entry.stream));
      if (animeToshoEntry) return animeToshoEntry;

      return entries[0];
    })
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.stream);
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

function isAnimeEpisodeMatch(title, episode) {
  const line = String(title || '').split('\n')[0];
  if (!line) return false;
  const e = Number(episode);
  if (!Number.isFinite(e)) return true;

  const ePattern = `0*${e}`;
  const basePatterns = [
    new RegExp(`\\bS\\d{1,2}\\s*[\\.\\-_ ]?\\s*E${ePattern}\\b`, 'i'),
    new RegExp(`\\b\\d{1,2}\\s*[xX]\\s*0*${e}\\b`, 'i'),
    new RegExp(`\\b-\\s*${ePattern}\\b`, 'i'),
    new RegExp(`\\bEpisode\\s*${ePattern}\\b`, 'i'),
    new RegExp(`\\bEp\\.?\\s*${ePattern}\\b`, 'i'),
    new RegExp(`\\bE${ePattern}\\b`, 'i'),
    new RegExp(`\\b${ePattern}v\\d+\\b`, 'i')
  ];

  if (!basePatterns.some((re) => re.test(line))) return false;

  const rangePatterns = [
    new RegExp(`\\b-\\s*${ePattern}\\s*[-\\u2013]\\s*0*\\d+\\b`, 'i'),
    new RegExp(`\\bEpisode\\s*${ePattern}\\s*[-\\u2013]\\s*0*\\d+\\b`, 'i'),
    new RegExp(`\\bEp\\.?\\s*${ePattern}\\s*[-\\u2013]\\s*0*\\d+\\b`, 'i')
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

async function searchWithFallbackQueries(searchFn, queries) {
  const normalized = [...new Set((queries || [])
    .map((value) => String(value || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean))];

  if (!normalized.length) return [];

  const groups = [];
  for (const query of normalized) {
    const results = await searchFn(query);
    if (Array.isArray(results) && results.length) {
      groups.push(results);
    }
  }

  if (!groups.length) return [];
  return uniqueByInfoHash(mergeRoundRobin(groups));
}

async function searchTorrents(id, options) {
  const requestedType = String(options?.type || 'movie').toLowerCase();
  const sources = options?.sources || ALL_SOURCES;
  const parsed = parseId(id);
  if (!parsed) return [];

  let movieMeta = null;
  let seriesMeta = null;

  if (requestedType === 'anime' && parsed.imdbId) {
    [movieMeta, seriesMeta] = await Promise.all([
      fetchMeta(parsed.baseId, 'movie'),
      fetchMeta(parsed.baseId, 'series')
    ]);
  }

  const metaTypeHint = requestedType === 'movie' ? 'movie' : 'series';
  const meta = movieMeta || seriesMeta || await fetchMeta(parsed.baseId, metaTypeHint);
  let type = requestedType === 'movie' ? 'movie' : 'series';

  if (requestedType === 'anime') {
    const explicitEpisode = parsed.season != null || parsed.episode != null;
    const subtype = String(meta?.subtype || '').toLowerCase();
    const episodeCount = Number(meta?.episodeCount || 0);
    const looksLikeMovie = subtype === 'movie' || episodeCount === 1;
    if (explicitEpisode) {
      type = 'series';
    } else if (movieMeta && !seriesMeta) {
      type = 'movie';
    } else if (seriesMeta && !movieMeta) {
      type = 'series';
    } else {
      type = looksLikeMovie ? 'movie' : 'series';
    }
  }

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
    } else if (type === 'series' && parsed.episode != null) {
      const e = String(parsed.episode).padStart(2, '0');
      query = `${baseTitle} E${e}`;
    }
  }

  const animeEligible = isAnimeMeta(meta);

  const bitsearchCategory = (() => {
    if (type === 'movie') return 2;
    if (type === 'series') return animeEligible ? 4 : 3;
    return undefined;
  })();

  const [knabenResults, bitsearchResults, eztvResults, ytsResults] = await Promise.all([
    query && sources.includes('knaben') ? searchKnaben(query) : [],
    query && sources.includes('bitsearch')
      ? searchBitsearch(query, {
        apiKey: options?.bitsearchApiKey,
        category: bitsearchCategory,
        sort: 'seeders',
        order: 'desc',
        limit: 20
      })
      : [],
    type === 'series' && sources.includes('eztv') ? searchEztv(id, { type }) : [],
    type === 'movie' && sources.includes('yts') ? searchYts(id) : []
  ]);

  const animeQueries = [baseTitle, query];

  const [animetoshoResults, nyaaResults, torrentsCsvResults] = await Promise.all([
    animeEligible && sources.includes('animetosho') ? searchWithFallbackQueries(searchAnimetosho, animeQueries) : [],
    animeEligible && sources.includes('nyaa') ? searchWithFallbackQueries(searchNyaa, [baseTitle]) : [],
    sources.includes('torrentscsv') ? searchTorrentsCsv(query || baseTitle) : []
  ]);

  const merged = type === 'movie'
    ? mergeRoundRobin([knabenResults, bitsearchResults, ytsResults, nyaaResults, animetoshoResults, torrentsCsvResults])
    : mergeRoundRobin([knabenResults, bitsearchResults, eztvResults, nyaaResults, animetoshoResults, torrentsCsvResults]);
  const unique = uniqueByInfoHash(merged);
  if (type === 'series' && parsed.episode != null) {
    if (animeEligible) {
      return unique.filter(stream => isAnimeEpisodeMatch(stream.title, parsed.episode));
    }

    if (parsed.season != null) {
      return unique.filter(stream => isExactEpisodeMatch(stream.title, parsed.season, parsed.episode));
    }
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
