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

async function resolveDebridStreams(streams, config) {
  if (!config.debridService || config.debridService === 'none') return streams;
  if (!config.debridToken) return streams;

  const resolver = config.debridService === 'realdebrid' ? realDebrid
    : config.debridService === 'torbox' ? torbox : null;

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
    let message = errors[0];
    if (/permission_denied/i.test(message) || /\(9\)/.test(message)) {
      message = `${message} (check RD subscription/token)`;
    }
    const first = streams[0];
    const fallbackMagnet = first?.infoHash ? `magnet:?xt=urn:btih:${first.infoHash}` : first?.url;
    return [
      {
        name: 'Flix-Finder',
        title: `🟣 [RD:error] ${message}`,
        url: fallbackMagnet || 'https://real-debrid.com'
      },
      ...streams
    ];
  }
  return streams;
}

module.exports = { resolveDebridStreams };
