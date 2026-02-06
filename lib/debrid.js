async function request(url, opts) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': 'Flix-Finder/2.0', ...(opts?.headers || {}) }
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? (() => {
    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  })() : null;
  if (!res.ok) {
    const detail = data?.error || data?.message || data?.detail;
    const code = data?.error_code ? ` (${data.error_code})` : '';
    throw new Error(detail ? `${detail}${code}` : `HTTP ${res.status}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
  for (let i = 0; i < 10; i++) {
    info = await request(withAuthToken(`/torrents/info/${add.id}`), { headers: auth });
    if (info.links?.length) break;
    if (info.status === 'error' || info.status === 'dead') throw new Error('Torrent failed');
    await sleep(1000);
  }

  if (!info?.links?.length) throw new Error('No links');

  let link = info.links[0];
  if (Array.isArray(info.files) && info.files.length) {
    const selectedFiles = info.files.filter(file => file.selected !== 0);
    const files = selectedFiles.length ? selectedFiles : info.files;
    const largest = files.reduce((max, file) => (file.bytes > max.bytes ? file : max), files[0]);
    const selectedIndex = (selectedFiles.length ? selectedFiles : info.files).indexOf(largest);
    if (selectedIndex >= 0 && info.links[selectedIndex]) {
      link = info.links[selectedIndex];
    }
  }

  const dl = await request(withAuthToken('/unrestrict/link'), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ link })
  });

  return { url: dl.download, title: info.filename || dl.filename, name: 'RD' };
}

async function torbox(magnet, token) {
  const base = 'https://api.torbox.app/v1/api';
  const auth = { Authorization: `Bearer ${token}` };

  const add = await request(`${base}/torrents/createtorrent`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnet })
  });

  if (!add.success) throw new Error(add.detail || 'Failed to add torrent');
  const id = add.data?.torrent_id;
  if (!id) throw new Error('No torrent id');

  let torrent;
  for (let i = 0; i < 10; i++) {
    const list = await request(`${base}/torrents/mylist?id=${id}`, { headers: auth });
    torrent = list.data;
    if (torrent?.download_finished && torrent?.files?.length) break;
    await sleep(1000);
  }

  if (!torrent?.files?.length) throw new Error('No files');

  const file = torrent.files.reduce((a, b) => (a.size > b.size ? a : b));
  const link = await request(
    `${base}/torrents/requestdl?token=${token}&torrent_id=${id}&file_id=${file.id}`,
    {}
  );

  if (!link.success) throw new Error('Failed to get download link');
  return { url: link.data, title: file.name || torrent.name, name: 'TB' };
}

async function webtor(magnet) {
  const base = 'https://webtor.io/api/v1/torrent';
  let info;
  try {
    info = await request(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnet })
    });
  } catch (e) {
    const url = `${base}?${new URLSearchParams({ magnet })}`;
    info = await request(url, {});
  }

  const hash = info?.hash || info?.infohash || info?.id;
  if (!info?.files?.length && hash) {
    info = await request(`${base}/${hash}`, {});
  }

  if (!info?.files?.length) throw new Error('No files');

  const fileSize = file => file?.size || file?.length || file?.bytes || 0;
  const file = info.files.reduce((a, b) => (fileSize(a) > fileSize(b) ? a : b));
  const fileId = file?.id ?? file?.index ?? file?.file_id ?? file?.fileIndex;
  const url = file?.url || file?.link || (hash && fileId != null
    ? `${base}/${hash}/file/${fileId}`
    : null);

  if (!url) throw new Error('No stream url');
  return { url, title: file.name || info.name, name: 'WT' };
}

async function resolveDebridStreams(streams, config) {
  if (!config.debridService || config.debridService === 'none') return streams;
  const requiresToken = ['realdebrid', 'torbox'].includes(config.debridService);
  if (requiresToken && !config.debridToken) return streams;

  const resolver = config.debridService === 'realdebrid' ? realDebrid
    : config.debridService === 'torbox' ? torbox
      : config.debridService === 'webtor' ? webtor : null;

  if (!resolver) return streams;

  const results = [];
  const errors = [];
  for (const stream of streams) {
    try {
      // Convert infoHash to magnet link for debrid services
      const magnet = stream.infoHash
        ? `magnet:?xt=urn:btih:${stream.infoHash}`
        : stream.url;
      if (!magnet) continue;

      const resolved = await resolver(magnet, config.debridToken);
      const badge = resolved.name === 'RD'
        ? '🟣 [RD:on]'
        : resolved.name === 'TB'
          ? '🔵 [TB:on]'
          : resolved.name === 'WT'
            ? '🟢 [WT:on]'
            : `[${resolved.name}]`;
      results.push({
        name: resolved.name,
        title: `${badge} ${resolved.title}`,
        url: resolved.url
      });
    } catch (e) {
      errors.push(e?.message || 'Debrid failed');
    }
  }

  if (results.length) return results;
  if (errors.length && streams.length) {
    const isRealDebrid = config.debridService === 'realdebrid';
    const isTorbox = config.debridService === 'torbox';
    const isWebtor = config.debridService === 'webtor';
    let message = errors[0];
    if (isRealDebrid && (/permission_denied/i.test(message) || /\(9\)/.test(message))) {
      message = `${message} (check RD subscription/token)`;
    }
    const first = streams[0];
    const fallbackMagnet = first?.infoHash ? `magnet:?xt=urn:btih:${first.infoHash}` : first?.url;
    const badge = isTorbox
      ? '🔵 [TB:error]'
      : isWebtor
        ? '🟢 [WT:error]'
        : '🟣 [RD:error]';
    const fallbackUrl = isTorbox
      ? 'https://torbox.app'
      : isWebtor
        ? 'https://webtor.io'
        : 'https://real-debrid.com';
    return [
      {
        name: 'Flix-Finder',
        title: `${badge} ${message}`,
        url: fallbackMagnet || fallbackUrl
      },
      ...streams
    ];
  }
  return streams;
}

module.exports = { resolveDebridStreams };
