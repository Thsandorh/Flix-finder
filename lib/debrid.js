async function request(url, opts) {
  const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const res = await fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': browserUA,
      ...(opts?.headers || {})
    }
  });

  if (res.status === 204) return null;

  const text = await res.text();
  const data = text
    ? (() => {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    })()
    : null;

  if (!res.ok) {
    const detail = data?.error || data?.message || data?.detail || data?.error?.message;
    throw new Error(detail || `HTTP ${res.status}`);
  }

  // Some debrid APIs return business errors with HTTP 200.
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const statusText = String(data.status || '').toLowerCase();
    const hasErrorStatus = ['error', 'failed', 'fail'].includes(statusText);
    const hasSuccessFalse = data.success === false;
    if (hasErrorStatus || hasSuccessFalse) {
      const detail = data?.error?.message
        || data?.error_description
        || data?.error
        || data?.message
        || data?.detail
        || statusText
        || 'API error';
      throw new Error(String(detail));
    }
  }

  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function btihFromMagnet(magnet) {
  const match = String(magnet || '').match(/urn:btih:([a-f0-9]{40})/i);
  return match ? match[1].toLowerCase() : null;
}

function normalizeFile(file) {
  const name = String(file?.name || file?.filename || file?.file_name || file?.short_name || file?.path || '').trim();
  const size = Number(file?.size || file?.bytes || file?.length || file?.filesize || 0);
  const url = file?.url || file?.download || file?.downloadUrl || file?.link || null;
  return {
    ...file,
    __name: name,
    __nameLower: name.toLowerCase(),
    __size: Number.isFinite(size) ? size : 0,
    __url: url
  };
}

function pickLargestVideoFile(files) {
  if (!Array.isArray(files) || !files.length) return null;
  const videoExts = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.wmv', '.ts', '.m2ts', '.webm'];
  const normalized = files.map(normalizeFile);
  const videos = normalized.filter((file) => videoExts.some((ext) => file.__nameLower.endsWith(ext)));
  const candidates = videos.length ? videos : normalized;
  return candidates.reduce((largest, current) => (current.__size > largest.__size ? current : largest), candidates[0]);
}

async function requestFirst(calls) {
  let lastError = null;
  for (const call of calls) {
    try {
      const value = await call();
      if (value != null) return value;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error('No request succeeded');
}

async function realDebrid(magnet, token) {
  const base = 'https://api.real-debrid.com/rest/1.0';
  const auth = { Authorization: `Bearer ${token}` };
  const withAuthToken = (path) => {
    const url = new URL(`${base}${path}`);
    url.searchParams.set('auth_token', token);
    return url.toString();
  };

  const add = await request(withAuthToken('/torrents/addMagnet'), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ magnet })
  });

  await request(withAuthToken(`/torrents/selectFiles/${add.id}`), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ files: 'all' })
  });

  let info;
  for (let i = 0; i < 12; i += 1) {
    info = await request(withAuthToken(`/torrents/info/${add.id}`), { headers: auth });
    if (info?.links?.length) break;
    if (info?.status === 'error' || info?.status === 'dead') throw new Error('Torrent failed');
    await sleep(1000);
  }

  if (!info?.links?.length) throw new Error('No links');

  let link = info.links[0];
  if (Array.isArray(info.files) && info.files.length) {
    const selectedFiles = info.files.filter((file) => file.selected !== 0);
    const files = selectedFiles.length ? selectedFiles : info.files;
    const largest = files.reduce((max, file) => (file.bytes > max.bytes ? file : max), files[0]);
    const selectedIndex = files.indexOf(largest);
    if (selectedIndex >= 0 && info.links[selectedIndex]) {
      link = info.links[selectedIndex];
    }
  }

  const dl = await request(withAuthToken('/unrestrict/link'), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ link })
  });

  return { url: dl.download, title: info.filename || dl.filename || 'Real-Debrid stream', name: 'RD' };
}

async function torbox(magnet, token) {
  const base = 'https://api.torbox.app/v1/api';
  const auth = { Authorization: `Bearer ${token}` };

  const add = await request(`${base}/torrents/createtorrent`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ magnet, allow_zip: 'false' })
  });

  if (!add?.success) throw new Error(add?.detail || add?.message || 'Failed to add torrent');

  const id = add?.data?.torrent_id || add?.data?.id || add?.torrent_id || add?.id;
  if (!id) throw new Error('No torrent id');

  let torrent;
  for (let i = 0; i < 18; i += 1) {
    const list = await request(`${base}/torrents/mylist?id=${encodeURIComponent(id)}&bypass_cache=true`, { headers: auth });
    const current = Array.isArray(list?.data) ? list.data[0] : list?.data;
    if (current) torrent = current;

    const files = torrent?.files || [];
    const state = String(torrent?.download_state || '').toLowerCase();
    const ready = Boolean(torrent?.download_present || torrent?.download_finished || torrent?.cached || state.includes('complete') || state.includes('finished'));

    if (ready && files.length) break;
    await sleep(1000);
  }

  if (!torrent?.files?.length) throw new Error('No files available in TorBox torrent');

  const file = pickLargestVideoFile(torrent.files);
  const fileId = file?.id || file?.file_id;
  if (!fileId) throw new Error('No playable file');

  const link = await request(
    `${base}/torrents/requestdl?torrent_id=${encodeURIComponent(id)}&file_id=${encodeURIComponent(fileId)}&redirect=true`,
    { headers: auth }
  );

  if (!link?.success) throw new Error(link?.detail || link?.message || 'Failed to get download link');

  const downloadUrl = typeof link.data === 'string'
    ? link.data
    : link?.data?.url || link?.data?.download || link?.url || link?.download;

  if (!downloadUrl) throw new Error('No download url from TorBox');

  const state = String(torrent?.download_state || '').toLowerCase();
  const cached = Boolean(torrent?.cached || torrent?.download_present || torrent?.download_finished || state.includes('complete') || state.includes('finished'));

  return {
    url: downloadUrl,
    title: file.__name || torrent?.name || 'TorBox stream',
    name: cached ? 'TB+' : 'TB'
  };
}

async function allDebrid(magnet, token) {
  const base = 'https://api.alldebrid.com/v4';
  const params = new URLSearchParams({ apikey: token, agent: 'flixfinder' });

  const upload = await requestFirst([
    () => request(`${base}/magnet/upload?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ magnets: magnet })
    }),
    () => request(`${base}/magnet/upload?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'magnets[]': magnet })
    })
  ]);

  const magnetItem = upload?.data?.magnets?.[0] || upload?.data || upload;
  const id = magnetItem?.id || magnetItem?.magnet || magnetItem?.magnetId;
  if (!id) throw new Error('AllDebrid: no torrent id');

  let status;
  for (let i = 0; i < 18; i += 1) {
    const data = await request(`${base}/magnet/status?${params.toString()}&id=${encodeURIComponent(id)}`);
    status = data?.data?.magnets || data?.data || data;
    const statusCode = Number(status?.statusCode);
    if (statusCode === 4) break;
    if ([5, 6, 7, 8, 9, 10, 11].includes(statusCode)) throw new Error(status?.status || 'AllDebrid torrent failed');
    await sleep(1000);
  }

  const links = Array.isArray(status?.links) ? status.links : [];
  const file = pickLargestVideoFile(links.map((link) => ({ ...link, name: link?.filename, url: link?.link })));
  if (!file?.__url) throw new Error('AllDebrid: no downloadable link');

  const unlocked = await request(`${base}/link/unlock?${params.toString()}&link=${encodeURIComponent(file.__url)}`);
  const url = unlocked?.data?.link || unlocked?.data?.download || unlocked?.link;
  if (!url) throw new Error('AllDebrid: unlock failed');

  return { url, title: file.__name || status?.filename || 'AllDebrid stream', name: 'AD' };
}

async function debridLink(magnet, token) {
  const base = 'https://debrid-link.com/api/v2';
  const auth = { Authorization: `Bearer ${token}` };
  const hash = btihFromMagnet(magnet);

  await request(`${base}/seedbox/add`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: magnet, async: true })
  });

  let torrent;
  for (let i = 0; i < 18; i += 1) {
    const list = await request(`${base}/seedbox/list`, { headers: auth });
    const values = Array.isArray(list?.value) ? list.value : [];
    torrent = values.find((item) => String(item?.hashString || '').toLowerCase() === hash) || values[0];
    if (!torrent) {
      await sleep(1000);
      continue;
    }
    if (Number(torrent.downloadPercent) === 100) break;
    await sleep(1000);
  }

  const files = Array.isArray(torrent?.files) ? torrent.files : [];
  const file = pickLargestVideoFile(files.map((f) => ({ ...f, name: f?.name, size: f?.size, url: f?.downloadUrl })));
  if (!file?.__url) throw new Error('DebridLink: no downloadable file');

  return { url: file.__url, title: file.__name || torrent?.name || 'DebridLink stream', name: 'DL' };
}

async function premiumize(magnet, token) {
  const base = 'https://www.premiumize.me/api';

  const resolveDirect = async () => {
    const direct = await request(`${base}/transfer/directdl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ apikey: token, src: magnet })
    });

    const content = Array.isArray(direct?.content) ? direct.content : [];
    const file = pickLargestVideoFile(content.map((entry) => ({
      ...entry,
      name: entry?.path || entry?.filename || entry?.name,
      size: entry?.size,
      url: entry?.link || entry?.stream_link
    })));

    return file?.__url
      ? { url: file.__url, title: file.__name || 'Premiumize stream', name: 'PM' }
      : null;
  };

  const cached = await resolveDirect();
  if (cached) return cached;

  await request(`${base}/transfer/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ apikey: token, src: magnet })
  });

  for (let i = 0; i < 20; i += 1) {
    const next = await resolveDirect();
    if (next) return next;
    await sleep(1200);
  }

  throw new Error('Premiumize: torrent not ready');
}

async function offcloud(magnet, token) {
  const base = 'https://offcloud.com/api';
  const hash = btihFromMagnet(magnet);

  const findExisting = async () => {
    const history = await request(`${base}/cloud/history?key=${encodeURIComponent(token)}`);
    const list = Array.isArray(history) ? history : history?.history || [];
    return list.find((item) => String(item?.originalLink || '').toLowerCase().includes(hash));
  };

  let torrent = await findExisting();
  if (!torrent) {
    await request(`${base}/cloud`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: token, url: magnet })
    });
  }

  for (let i = 0; i < 18; i += 1) {
    torrent = await findExisting();
    if (!torrent) {
      await sleep(1000);
      continue;
    }
    if (String(torrent.status || '').toLowerCase() === 'downloaded') break;
    if (['error', 'canceled'].includes(String(torrent.status || '').toLowerCase())) {
      throw new Error(`Offcloud: ${torrent.status}`);
    }
    await sleep(1000);
  }

  if (!torrent?.requestId) throw new Error('Offcloud: no request id');

  const explored = await request(`${base}/cloud/explore/${encodeURIComponent(torrent.requestId)}?key=${encodeURIComponent(token)}`);
  const urls = Array.isArray(explored) ? explored : Array.isArray(explored?.links) ? explored.links : [];
  const file = pickLargestVideoFile(urls.map((url) => ({ name: decodeURIComponent(String(url).split('/').pop() || ''), url })));
  if (!file?.__url) throw new Error('Offcloud: no downloadable file');

  return { url: file.__url, title: file.__name || torrent?.fileName || 'Offcloud stream', name: 'OC' };
}

function parsePutioToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return '';
  const at = token.lastIndexOf('@');
  return at >= 0 ? token.slice(at + 1) : token;
}

async function putio(magnet, rawToken) {
  const token = parsePutioToken(rawToken);
  const base = 'https://api.put.io/v2';
  const auth = { Authorization: `Bearer ${token}` };
  const hash = btihFromMagnet(magnet);

  const findTransfer = async () => {
    const list = await request(`${base}/transfers/list`, { headers: auth });
    const items = Array.isArray(list?.transfers) ? list.transfers : [];
    return items.find((item) => String(item?.source || '').toLowerCase().includes(hash)) || null;
  };

  let transfer = await findTransfer();
  if (!transfer) {
    await request(`${base}/transfers/add`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url: magnet })
    });
  }

  for (let i = 0; i < 25; i += 1) {
    transfer = await findTransfer();
    const status = String(transfer?.status || '').toUpperCase();
    if (['COMPLETED', 'SEEDING'].includes(status)) break;
    if (status === 'ERROR') throw new Error('Put.io transfer failed');
    await sleep(1000);
  }

  if (!transfer?.file_id) throw new Error('Put.io: no file id');

  const collectVideos = async (parentId) => {
    const stack = [parentId];
    const videos = [];

    while (stack.length) {
      const currentId = stack.pop();
      const list = await request(`${base}/files/list?parent_id=${encodeURIComponent(currentId)}`, { headers: auth });
      const files = Array.isArray(list?.files) ? list.files : [];

      for (const file of files) {
        if (file?.file_type === 'VIDEO') videos.push(file);
        if (file?.file_type === 'FOLDER') stack.push(file.id);
      }
    }

    return videos;
  };

  const videos = await collectVideos(transfer.file_id);
  const file = pickLargestVideoFile(videos.map((f) => ({ ...f, name: f?.name, size: f?.size, id: f?.id })));
  if (!file?.id) throw new Error('Put.io: no video file');

  const linkData = await request(`${base}/files/url?file_id=${encodeURIComponent(file.id)}`, { headers: auth });
  const url = linkData?.url || linkData?.link;
  if (!url) throw new Error('Put.io: no download url');

  return { url, title: file.__name || transfer?.name || 'Put.io stream', name: 'PUT' };
}

async function easyDebrid(magnet, token) {
  const base = 'https://easydebrid.com/api/v1';
  const auth = { Authorization: `Bearer ${token}` };

  const response = await requestFirst([
    () => request(`${base}/link/generate`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: magnet })
    }),
    () => request(`${base}/link/generate`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url: magnet })
    }),
    () => request(`${base}/link/generate`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnet })
    })
  ]);

  const files = Array.isArray(response?.files) ? response.files : Array.isArray(response?.data?.files) ? response.data.files : [];
  const file = pickLargestVideoFile(files.map((entry) => ({
    ...entry,
    name: entry?.path || entry?.filename || entry?.name,
    size: entry?.size,
    url: entry?.url || entry?.link
  })));

  if (!file?.__url) throw new Error('EasyDebrid: no downloadable file');
  return { url: file.__url, title: file.__name || 'EasyDebrid stream', name: 'ED' };
}

const RESOLVERS = {
  realdebrid: realDebrid,
  torbox,
  alldebrid: allDebrid,
  debridlink: debridLink,
  premiumize,
  offcloud,
  putio,
  easydebrid: easyDebrid
};

const BADGES = {
  realdebrid: 'RD',
  torbox: 'TB',
  alldebrid: 'AD',
  debridlink: 'DL',
  premiumize: 'PM',
  offcloud: 'OC',
  putio: 'PUT',
  easydebrid: 'ED'
};

const HOME_URLS = {
  realdebrid: 'https://real-debrid.com',
  torbox: 'https://torbox.app',
  alldebrid: 'https://alldebrid.com',
  debridlink: 'https://debrid-link.com',
  premiumize: 'https://premiumize.me',
  offcloud: 'https://offcloud.com',
  putio: 'https://put.io',
  easydebrid: 'https://easydebrid.com'
};

async function resolveDebridStreams(streams, config) {
  const service = String(config?.debridService || 'none').toLowerCase();
  if (!service || service === 'none') return streams;

  const resolver = RESOLVERS[service];
  if (!resolver) return streams;
  if (!config?.debridToken) return streams;

  const results = [];
  const errors = [];

  for (const stream of streams) {
    try {
      const magnet = stream.infoHash
        ? `magnet:?xt=urn:btih:${stream.infoHash}`
        : stream.url;

      if (!magnet || !/^magnet:\?/i.test(magnet)) continue;

      const resolved = await resolver(magnet, config.debridToken);
      const serviceBadge = BADGES[service] || resolved.name || service.toUpperCase();
      const isCached = /\+$/.test(String(resolved.name || ''));
      const badge = isCached ? `[${serviceBadge}+]` : `[${serviceBadge}]`;

      results.push({
        name: 'Flix-Finder',
        title: `${badge} ${resolved.title}`,
        url: resolved.url
      });
    } catch (error) {
      errors.push(error?.message || 'Debrid failed');
    }
  }

  if (results.length) return results;

  if (errors.length && streams.length) {
    const first = streams[0];
    const fallbackMagnet = first?.infoHash ? `magnet:?xt=urn:btih:${first.infoHash}` : first?.url;
    const badge = `[${(BADGES[service] || service.toUpperCase())}:error]`;
    const fallbackUrl = HOME_URLS[service] || 'https://strem.io';

    return [
      {
        name: 'Flix-Finder',
        title: `${badge} ${errors[0]}`,
        externalUrl: fallbackUrl,
        ...(fallbackMagnet ? { url: fallbackMagnet } : {})
      },
      ...streams
    ];
  }

  return streams;
}

module.exports = { resolveDebridStreams };
