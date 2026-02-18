function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function magnetFromInfoHash(infoHash) {
  if (!infoHash) return null;
  return `magnet:?xt=urn:btih:${String(infoHash).toLowerCase()}`;
}

function infoHashFromMagnet(magnet) {
  const match = String(magnet || '').match(/urn:btih:([a-fA-F0-9]{40})/i);
  return match ? match[1].toLowerCase() : null;
}

function isVideoName(name) {
  const lower = String(name || '').toLowerCase();
  return ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.wmv', '.ts', '.m2ts', '.webm'].some((ext) => lower.endsWith(ext));
}

function normalizeFiles(files) {
  return (Array.isArray(files) ? files : []).map((file) => {
    const name = String(file.name || file.file_name || file.short_name || file.filename || file.path || '').trim();
    const size = Number(file.size || file.bytes || file.length || file.filesize || 0);
    return {
      raw: file,
      id: file.id ?? file.file_id ?? file.fileId ?? file.torrent_file_id ?? file.torrentFileId,
      name,
      size: Number.isFinite(size) ? size : 0,
      url: file.url || file.link || file.download || file.downloadUrl || null
    };
  });
}

function pickBestVideo(files) {
  const normalized = normalizeFiles(files);
  if (!normalized.length) return null;
  const videos = normalized.filter((file) => isVideoName(file.name));
  const candidates = videos.length ? videos : normalized;
  return candidates.sort((a, b) => b.size - a.size)[0] || null;
}

async function requestJson(url, opts = {}, retry = {}) {
  const maxAttempts = Math.max(1, Number(retry.maxAttempts || 1));
  const baseDelayMs = Math.max(250, Number(retry.baseDelayMs || 1000));
  const timeoutMs = Math.max(1000, Number(retry.timeoutMs || 15000));

  const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

  let res;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(url, {
        ...opts,
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': browserUA,
          ...(opts.headers || {})
        }
      });
    } finally {
      clearTimeout(timer);
    }

    if (![429, 503].includes(res.status) || attempt >= maxAttempts - 1) {
      break;
    }

    const retryAfter = Number.parseInt(res.headers.get('retry-after') || '', 10);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : baseDelayMs * (attempt + 1);
    await sleep(waitMs);
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const detail = data?.error?.message || data?.error_description || data?.error || data?.message || data?.detail;
    throw new Error(detail || `HTTP ${res.status}`);
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const status = String(data.status || '').toLowerCase();
    if (data.success === false || ['error', 'failed', 'fail'].includes(status)) {
      const detail = data?.error?.message || data?.error_description || data?.error || data?.message || data?.detail || status;
      throw new Error(detail || 'API error');
    }
  }

  return data;
}

async function resolveRealDebrid(infoHash, token) {
  const magnet = magnetFromInfoHash(infoHash);
  const base = 'https://api.real-debrid.com/rest/1.0';
  const auth = { Authorization: `Bearer ${token}` };

  const withAuthToken = (path) => {
    const url = new URL(`${base}${path}`);
    url.searchParams.set('auth_token', token);
    return url.toString();
  };

  const add = await requestJson(withAuthToken('/torrents/addMagnet'), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ magnet })
  });

  await requestJson(withAuthToken(`/torrents/selectFiles/${add.id}`), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ files: 'all' })
  });

  let info = null;
  for (let i = 0; i < 10; i += 1) {
    info = await requestJson(withAuthToken(`/torrents/info/${add.id}`), { headers: auth });
    if (Array.isArray(info?.links) && info.links.length) break;
    if (['error', 'dead'].includes(String(info?.status || '').toLowerCase())) {
      throw new Error('Torrent failed');
    }
    await sleep(1000);
  }

  if (!Array.isArray(info?.links) || !info.links.length) throw new Error('No links');

  let link = info.links[0];
  if (Array.isArray(info.files) && info.files.length) {
    const selectedFiles = info.files.filter((file) => file.selected !== 0);
    const files = selectedFiles.length ? selectedFiles : info.files;
    const largest = files.reduce((max, file) => (Number(file.bytes || 0) > Number(max.bytes || 0) ? file : max), files[0]);
    const selectedIndex = files.indexOf(largest);
    if (selectedIndex >= 0 && info.links[selectedIndex]) link = info.links[selectedIndex];
  }

  const dl = await requestJson(withAuthToken('/unrestrict/link'), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ link })
  });

  if (!dl?.download) throw new Error('No RealDebrid url');
  return { url: dl.download, title: info.filename || dl.filename || 'RealDebrid stream' };
}

async function torboxCheckCached(infoHashes, token) {
  const hashes = [...new Set((infoHashes || []).map((hash) => String(hash || '').toLowerCase()).filter((hash) => /^[a-f0-9]{40}$/.test(hash)))];
  if (!hashes.length) return new Set();

  const base = 'https://api.torbox.app/v1';
  const headers = { Authorization: `Bearer ${token}` };
  const params = new URLSearchParams({ format: 'list', list_files: 'true' });

  const data = await requestJson(`${base}/api/torrents/checkcached?${params.toString()}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes })
  }, { maxAttempts: 4, baseDelayMs: 1200, timeoutMs: 20000 });

  const cached = new Set();
  for (const entry of (Array.isArray(data?.data) ? data.data : [])) {
    const hash = String(entry?.hash || '').toLowerCase();
    if (hash) cached.add(hash);
  }

  return cached;
}

async function torboxGetTorrentList(token, id) {
  const base = 'https://api.torbox.app/v1';
  const headers = { Authorization: `Bearer ${token}` };
  const params = new URLSearchParams();
  if (id != null) params.set('id', String(id));
  params.set('bypass_cache', 'true');

  const data = await requestJson(`${base}/api/torrents/mylist?${params.toString()}`, {
    headers
  }, { maxAttempts: 3, baseDelayMs: 1000, timeoutMs: 15000 });

  const payload = data?.data;
  return Array.isArray(payload) ? payload : (payload ? [payload] : []);
}

async function torboxCreateTorrent(token, magnet) {
  const base = 'https://api.torbox.app/v1';
  const headers = { Authorization: `Bearer ${token}` };
  const body = new URLSearchParams({ magnet, allow_zip: 'false' });

  const data = await requestJson(`${base}/api/torrents/createtorrent`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  }, { maxAttempts: 4, baseDelayMs: 1200, timeoutMs: 20000 });

  return data?.data || data;
}

async function torboxControl(token, torrentId, operation) {
  const base = 'https://api.torbox.app/v1';
  const headers = { Authorization: `Bearer ${token}` };
  const data = await requestJson(`${base}/api/torrents/controltorrent`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ torrent_id: torrentId, operation })
  }, { maxAttempts: 2, baseDelayMs: 1000, timeoutMs: 10000 });
  return data?.data || data;
}

function torboxStatusReady(torrent) {
  return Boolean(torrent?.download_present);
}

function torboxStatusError(torrent) {
  const state = String(torrent?.download_state || '').toLowerCase();
  return ((!torrent?.active && !torrent?.download_finished) || state === 'error');
}

function torboxStatusDownloading(torrent) {
  return (!torboxStatusReady(torrent) && !torboxStatusError(torrent)) || Boolean(torrent?.queued_id);
}

function torboxGetFiles(torrent) {
  const candidates = [
    torrent?.files,
    torrent?.download_files,
    torrent?.data?.files,
    torrent?.data?.download_files
  ];

  for (const list of candidates) {
    if (Array.isArray(list) && list.length) return list;
  }
  return [];
}

async function torboxCreateOrFindTorrent(token, infoHash) {
  const torrents = await torboxGetTorrentList(token);
  const found = torrents.filter((torrent) => String(torrent?.hash || '').toLowerCase() === String(infoHash).toLowerCase());
  const nonFailed = found.find((torrent) => !torboxStatusError(torrent));
  if (nonFailed) return nonFailed;
  if (found[0]) return found[0];

  let attempts = 1;
  while (attempts >= 0) {
    const created = await torboxCreateTorrent(token, magnetFromInfoHash(infoHash));
    if (created?.torrent_id) {
      const list = await torboxGetTorrentList(token, created.torrent_id);
      return list[0] || created;
    }

    if (created?.queued_id) {
      for (let i = 0; i < 10; i += 1) {
        await sleep(1000);
        const list = await torboxGetTorrentList(token);
        const byHash = list.find((torrent) => String(torrent?.hash || '').toLowerCase() === String(infoHash).toLowerCase());
        if (byHash) return byHash;
      }
      return { ...created, download_state: 'metaDL' };
    }

    if (created?.error === 'ACTIVE_LIMIT' && attempts > 0) {
      const all = await torboxGetTorrentList(token);
      const seeding = all.filter((torrent) => ['seeding', 'uploading', 'uploading (no peers)'].includes(String(torrent?.download_state || '').toLowerCase())).pop();
      if (seeding?.id) {
        await torboxControl(token, seeding.id, 'stop_seeding');
      } else {
        const downloading = all.filter((torrent) => torboxStatusDownloading(torrent)).pop();
        if (downloading?.id) await torboxControl(token, downloading.id, 'delete');
      }
      attempts -= 1;
      continue;
    }

    throw new Error(`Unexpected TorBox create response: ${JSON.stringify(created)}`);
  }

  throw new Error('TorBox create failed');
}

function torboxDownloadLink(token, type, rootId, fileId) {
  const idKey = { torrents: 'torrent_id', usenet: 'usenet_id', webdl: 'web_id' }[type] || 'torrent_id';
  const params = new URLSearchParams({ token, [idKey]: String(rootId), file_id: String(fileId), redirect: 'true' });
  return `https://api.torbox.app/v1/api/${type}/requestdl?${params.toString()}`;
}

async function resolveTorbox(infoHash, token) {
  if (String(infoHash).includes('-')) {
    const [type, rootId, fileId] = String(infoHash).split('-');
    return { url: torboxDownloadLink(token, type, rootId, fileId), title: `TorBox ${type}` };
  }

  let torrent = await torboxCreateOrFindTorrent(token, infoHash);
  if (torrent && torboxStatusError(torrent) && torrent.id) {
    await torboxControl(token, torrent.id, 'delete').catch(() => undefined);
    torrent = await torboxCreateOrFindTorrent(token, infoHash);
  }

  if (!torrent || torboxStatusDownloading(torrent)) {
    for (let i = 0; i < 10; i += 1) {
      await sleep(1000);
      const refreshed = await torboxGetTorrentList(token);
      const byHash = refreshed.find((item) => String(item?.hash || '').toLowerCase() === String(infoHash).toLowerCase());
      if (byHash) {
        torrent = byHash;
        if (!torboxStatusDownloading(torrent)) break;
      }
    }
  }

  let files = torboxGetFiles(torrent);
  if (!files.length) {
    const refreshed = torrent?.id ? await torboxGetTorrentList(token, torrent.id) : [];
    torrent = refreshed[0] || torrent;
    files = torboxGetFiles(torrent);
  }

  const target = pickBestVideo(files);
  if (target?.id == null) {
    throw new Error('No TorBox playable file');
  }

  const url = torboxDownloadLink(token, 'torrents', torrent.id, target.id);
  return { url, title: target.name || torrent.name || 'TorBox stream' };
}

async function resolveAllDebrid(infoHash, token) {
  const base = 'https://api.alldebrid.com/v4';
  const params = new URLSearchParams({ apikey: token, agent: 'torrentio' });

  const upload = await requestJson(`${base}/magnet/upload?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ magnets: magnetFromInfoHash(infoHash) })
  });

  let torrent = upload?.data?.magnets?.[0] || null;
  const id = torrent?.id;
  if (!id) throw new Error('No AllDebrid torrent id');

  for (let i = 0; i < 15; i += 1) {
    const statusRes = await requestJson(`${base}/magnet/status?${params.toString()}&id=${encodeURIComponent(id)}`);
    torrent = statusRes?.data?.magnets || statusRes?.data;
    const code = Number(torrent?.statusCode);
    if (code === 4) break;
    if ([5, 6, 7, 8, 9, 10, 11].includes(code)) throw new Error(torrent?.status || 'AllDebrid error');
    await sleep(1000);
  }

  const filesRes = await requestJson(`${base}/magnet/files?${params.toString()}&id=${encodeURIComponent(id)}`);
  const nested = filesRes?.data?.magnets?.[0]?.files || [];
  const flatten = (entries) => entries.flatMap((entry) => Array.isArray(entry?.e) ? flatten(entry.e) : [entry]);
  const files = flatten(nested).map((entry) => ({ name: entry?.n, size: Number(entry?.s || 0), url: entry?.l }));

  const target = pickBestVideo(files);
  if (!target?.url) throw new Error('No AllDebrid links');

  const unlocked = await requestJson(`${base}/link/unlock?${params.toString()}&link=${encodeURIComponent(target.url)}`);
  const finalUrl = unlocked?.data?.link || unlocked?.data?.download || unlocked?.link;
  if (!finalUrl) throw new Error('AllDebrid unlock failed');

  return { url: finalUrl, title: target.name || torrent?.filename || 'AllDebrid stream' };
}

async function resolveDebridLink(infoHash, token) {
  const base = 'https://debrid-link.com/api/v2';
  const headers = { Authorization: `Bearer ${token}` };

  await requestJson(`${base}/seedbox/add`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: magnetFromInfoHash(infoHash), async: true })
  });

  let torrent = null;
  for (let i = 0; i < 15; i += 1) {
    const listed = await requestJson(`${base}/seedbox/list`, { headers });
    const values = Array.isArray(listed?.value) ? listed.value : [];
    torrent = values.find((item) => String(item?.hashString || '').toLowerCase() === String(infoHash).toLowerCase()) || null;
    if (torrent && Number(torrent.downloadPercent) === 100) break;
    await sleep(1000);
  }

  const target = pickBestVideo((torrent?.files || []).map((file) => ({ name: file?.name, size: file?.size, url: file?.downloadUrl })));
  if (!target?.url) throw new Error('No DebridLink links');

  return { url: target.url, title: target.name || torrent?.name || 'DebridLink stream' };
}

async function resolvePremiumize(infoHash, token) {
  const base = 'https://www.premiumize.me/api';

  const direct = await requestJson(`${base}/transfer/directdl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ apikey: token, src: magnetFromInfoHash(infoHash) })
  });

  const target = pickBestVideo((direct?.content || []).map((file) => ({ name: file?.path || file?.name, size: file?.size, url: file?.link || file?.stream_link })));
  if (!target?.url) throw new Error('No Premiumize cached link');

  return { url: target.url, title: target.name || 'Premiumize stream' };
}

async function resolveOffcloud(infoHash, token) {
  const base = 'https://offcloud.com/api';
  const magnet = magnetFromInfoHash(infoHash);

  await requestJson(`${base}/cloud`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ key: token, url: magnet })
  });

  const history = await requestJson(`${base}/cloud/history?key=${encodeURIComponent(token)}`);
  const torrents = Array.isArray(history) ? history : [];
  const entry = torrents.find((torrent) => String(torrent?.originalLink || '').toLowerCase().includes(String(infoHash).toLowerCase()));
  if (!entry?.requestId) throw new Error('Offcloud entry not found');

  const explored = await requestJson(`${base}/cloud/explore/${encodeURIComponent(entry.requestId)}?key=${encodeURIComponent(token)}`);
  const urls = Array.isArray(explored) ? explored : [];
  const target = pickBestVideo(urls.map((url) => ({ name: decodeURIComponent(String(url).split('/').pop() || ''), url })));
  if (!target?.url) throw new Error('No Offcloud links');

  return { url: target.url, title: target.name || entry.fileName || 'Offcloud stream' };
}

function normalizePutioToken(raw) {
  const token = String(raw || '').trim();
  if (!token) return token;
  const at = token.lastIndexOf('@');
  return at >= 0 ? token.slice(at + 1) : token;
}

async function resolvePutio(infoHash, rawToken) {
  const token = normalizePutioToken(rawToken);
  const base = 'https://api.put.io/v2';
  const headers = { Authorization: `Bearer ${token}` };

  await requestJson(`${base}/transfers/add`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ url: magnetFromInfoHash(infoHash) })
  });

  let transfer = null;
  for (let i = 0; i < 12; i += 1) {
    const list = await requestJson(`${base}/transfers/list`, { headers });
    transfer = (list?.transfers || []).find((item) => String(item?.source || '').toLowerCase().includes(String(infoHash).toLowerCase())) || null;
    if (transfer && ['COMPLETED', 'SEEDING'].includes(String(transfer.status || '').toUpperCase())) break;
    await sleep(1000);
  }

  if (!transfer?.file_id) throw new Error('Put.io transfer not found');

  const filesRes = await requestJson(`${base}/files/list?parent_id=${encodeURIComponent(transfer.file_id)}`, { headers });
  const videos = (filesRes?.files || []).filter((file) => String(file?.file_type || '').toUpperCase() === 'VIDEO');
  const target = pickBestVideo(videos.map((file) => ({ id: file?.id, name: file?.name, size: file?.size })));
  if (!target?.id) throw new Error('No Put.io video');

  const urlRes = await requestJson(`${base}/files/url?file_id=${encodeURIComponent(target.id)}`, { headers });
  const url = urlRes?.url || urlRes?.link;
  if (!url) throw new Error('No Put.io URL');

  return { url, title: target.name || transfer.name || 'Put.io stream' };
}

async function resolveEasyDebrid(infoHash, token) {
  const base = 'https://easydebrid.com/api/v1';
  const headers = { Authorization: `Bearer ${token}` };

  const response = await requestJson(`${base}/link/generate`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: magnetFromInfoHash(infoHash) })
  });

  const target = pickBestVideo((response?.files || response?.data?.files || []).map((file) => ({
    name: file?.path || file?.filename || file?.name,
    size: file?.size,
    url: file?.url || file?.link
  })));

  if (!target?.url) throw new Error('No EasyDebrid URL');
  return { url: target.url, title: target.name || 'EasyDebrid stream' };
}

const PROVIDERS = {
  realdebrid: { badge: 'RD', resolver: resolveRealDebrid },
  torbox: { badge: 'TB', resolver: resolveTorbox },
  alldebrid: { badge: 'AD', resolver: resolveAllDebrid },
  debridlink: { badge: 'DL', resolver: resolveDebridLink },
  premiumize: { badge: 'PM', resolver: resolvePremiumize },
  offcloud: { badge: 'OC', resolver: resolveOffcloud },
  putio: { badge: 'PUT', resolver: resolvePutio },
  easydebrid: { badge: 'ED', resolver: resolveEasyDebrid }
};

function buildResolveUrl(host, service, infoHash, token) {
  const safeHost = String(host || '').replace(/\/+$/, '');
  return `${safeHost}/resolve/${encodeURIComponent(service)}/${encodeURIComponent(infoHash)}?token=${encodeURIComponent(token)}`;
}

async function resolveDebridUrl(service, infoHash, token) {
  const provider = PROVIDERS[String(service || '').toLowerCase()];
  if (!provider) throw new Error('Unsupported debrid service');
  if (!token) throw new Error('Missing debrid token');
  if (!infoHash) throw new Error('Missing infoHash');
  const resolved = await provider.resolver(infoHash, token);
  if (!resolved?.url) throw new Error('No debrid url');
  return resolved.url;
}

async function resolveDebridStreams(streams, config) {
  const service = String(config?.debridService || '').toLowerCase();
  if (!service || service === 'none') return streams;

  const provider = PROVIDERS[service];
  if (!provider) return streams;

  const token = String(config?.debridToken || '').trim();
  if (!token) return streams;

  const host = String(config?.host || '').trim();
  if (!host) return streams;

  // Torrentio-style behavior for list endpoint: provide resolver links, resolve on play.
  return streams.map((stream) => {
    if (!stream?.infoHash) return stream;
    const firstLine = String(stream.title || '').split('\n')[0] || 'Debrid stream';
    const resolveUrl = buildResolveUrl(host, service, stream.infoHash, token);
    return {
      name: 'Flix-Finder',
      title: `[${provider.badge}] ${firstLine}`,
      url: resolveUrl
    };
  });
}

module.exports = { resolveDebridStreams, resolveDebridUrl };
