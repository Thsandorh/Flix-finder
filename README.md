# Flix-Finder

Stremio addon for torrent streaming. Searches multiple torrent indexers and returns streams directly to Stremio.

## Features

- Torrent search via Knaben aggregator (TPB, 1337x, RARBG, RuTracker, etc.)
- TV torrents via EZTV API
- Movie torrents via YTS API
- Anime torrents via AnimeTosho
- Torrents via Nyaa search
- Torrents via TorrentsCSV search
- Movies and TV series support
- Quality filtering (4K, 1080p, 720p)
- Keyword filters (include/exclude)
- Real-Debrid and Torbox integration
- Flexible sorting (quality+seeders, quality+size, seeders, size)

## Installation

### Hosted version
1. Go to the [configure page](https://your-domain.vercel.app/configure)
2. Set your preferences
3. Click "Install in Stremio"

### Self-host on Node.js (regular hosting / cPanel)
1. Upload this project to your Node.js app root.
2. Use Node.js `18+` (required).
3. Run `npm install`.
4. Set startup file to `server.js`.
5. Start the app and open `https://your-domain/configure`.

cPanel Node.js app fields:
- `Application root`: folder where this repo is uploaded
- `Application URL`: your selected domain/subdomain
- `Application startup file`: `server.js`
- Optional env var for subpath deploy: `APP_BASE_PATH=/flix-finder` (if app runs under a path prefix)

## Configuration

| Option | Description |
|--------|-------------|
| Quality | Filter by resolution (any/4K/1080p/720p) |
| Sorting | Order results by quality/seeders/size priority |
| Max results | Limit number of streams |
| Required keywords | Only show results containing ALL keywords |
| Exclude keywords | Hide results containing ANY keyword |
| Debrid | Real-Debrid or Torbox for cached streaming |

## API Endpoints

```
GET /manifest.json          - Addon manifest
GET /configure              - Configuration page
GET /stream/:type/:id.json  - Stream results
```

Stream endpoint accepts query parameters for configuration:
```
/stream/movie/tt1234567.json?quality=1080p&maxResults=5
```

## Notes

- Series searches with season/episode IDs are narrowed to the exact episode (SxxEyy / 3x01 patterns).
- Knaben can be slow at times; requests are time-limited to keep the addon responsive. If Knaben times out, you may get fewer results from that source.
- AnimeTosho and Nyaa are only queried for anime metadata to reduce irrelevant non-anime matches.

## Debrid Setup

1. Get API token from [Real-Debrid](https://real-debrid.com/apitoken) or [Torbox](https://torbox.app)
2. Select service in configuration
3. Paste token if needed and install

Debrid converts torrents to direct HTTP streams for instant playback.

## Tech

- Plain Node.js HTTP server
- Knaben torrent API
- Stremio addon protocol v3

## License

MIT
