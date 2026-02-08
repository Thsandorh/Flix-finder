const SUPPORT_URL = 'https://ko-fi.com/sandortoth';

function createSupportStream() {
  return {
    name: 'Flix-Finder',
    title: '🤝 Support Flix-Finder\n☕ Buy me a coffee on Ko-fi',
    externalUrl: SUPPORT_URL,
    behaviorHints: {
      notWebReady: true
    }
  };
}

function withSupportLink(streams) {
  return [...streams, createSupportStream()];
}

module.exports = { SUPPORT_URL, createSupportStream, withSupportLink };
