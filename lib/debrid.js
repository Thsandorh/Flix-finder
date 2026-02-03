async function request(url, opts) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': 'Flix-Finder/2.0', ...(opts?.headers || {}) }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function realDebrid(magnet, token) {
  const base = 'https://api.real-debrid.com/rest/1.0';
  const auth = { Authorization: `Bearer ${token}` };

  const add = await request(`${base}/torrents/addMagnet`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ magnet })
  });

  await request(`${base}/torrents/selectFiles/${add.id}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ files: 'all' })
  });

  let info;
  for (let i = 0; i < 10; i++) {
    info = await request(`${base}/torrents/info/${add.id}`, { headers: auth });
    if (info.status === 'downloaded' && info.links?.length) break;
    if (info.status === 'error' || info.status === 'dead') throw new Error('Torrent failed');
    await sleep(1000);
  }

  if (!info?.links?.length) throw new Error('No links');

  const dl = await request(`${base}/unrestrict/link`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ link: info.links[0] })
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
      // skip failed
    }
  }

  return results.length ? results : streams;
}

module.exports = { resolveDebridStreams };
