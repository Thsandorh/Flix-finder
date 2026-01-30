const DEFAULT_USER_AGENT = 'Flix-Finder-Debrid/1.0';

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Debrid request failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function resolveRealDebrid(magnet, token) {
  const baseUrl = 'https://api.real-debrid.com/rest/1.0';
  const authHeader = { Authorization: `Bearer ${token}` };

  const addResponse = await requestJson(
    `${baseUrl}/torrents/addMagnet`,
    {
      method: 'POST',
      headers: {
        ...authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ magnet })
    }
  );

  const torrentId = addResponse.id;
  await requestJson(`${baseUrl}/torrents/selectFiles/${torrentId}`, {
    method: 'POST',
    headers: {
      ...authHeader,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ files: 'all' })
  });

  const info = await requestJson(`${baseUrl}/torrents/info/${torrentId}`, {
    headers: authHeader
  });

  if (!info.links || !info.links.length) {
    throw new Error('Real-Debrid returned no links');
  }

  const unrestrict = await requestJson(
    `${baseUrl}/unrestrict/link?${new URLSearchParams({
      link: info.links[0]
    })}`,
    { headers: authHeader }
  );

  return {
    url: unrestrict.download,
    title: info.filename || unrestrict.filename || 'Real-Debrid stream',
    name: 'Real-Debrid'
  };
}

async function resolveTorbox(magnet, token) {
  const baseUrl = 'https://api.torbox.app/v1';
  const authHeader = { Authorization: `Bearer ${token}` };

  const addResponse = await requestJson(`${baseUrl}/torrents/add`, {
    method: 'POST',
    headers: {
      ...authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ magnet })
  });

  const torrentId = addResponse.id || (addResponse.data && addResponse.data.id);
  if (!torrentId) {
    throw new Error('Torbox add response missing id');
  }

  const info = await requestJson(`${baseUrl}/torrents/${torrentId}`, {
    headers: authHeader
  });

  const downloadUrl =
    info.download ||
    info.link ||
    (info.data && (info.data.download || info.data.link));

  if (!downloadUrl) {
    throw new Error('Torbox returned no download link');
  }

  return {
    url: downloadUrl,
    title: info.name || (info.data && info.data.name) || 'Torbox stream',
    name: 'Torbox'
  };
}

async function resolveDebridStreams(streams, config) {
  if (!config.debridService || config.debridService === 'none') {
    return streams;
  }

  if (!config.debridToken) {
    throw new Error('Debrid token is required');
  }

  const resolver =
    config.debridService === 'realdebrid'
      ? resolveRealDebrid
      : config.debridService === 'torbox'
        ? resolveTorbox
        : null;

  if (!resolver) {
    throw new Error(`Unsupported debrid service: ${config.debridService}`);
  }

  const resolved = [];
  for (const stream of streams) {
    const resolvedStream = await resolver(stream.url, config.debridToken);
    resolved.push({
      ...resolvedStream,
      title: `${resolvedStream.title} (${stream.title})`
    });
  }

  return resolved;
}

module.exports = {
  resolveDebridStreams
};
