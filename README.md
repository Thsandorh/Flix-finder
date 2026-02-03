# Flix-Finder

Stremio addon for torrent streaming. Searches multiple torrent indexers and returns streams directly to Stremio.

## Features

- Torrent search via Knaben aggregator (TPB, 1337x, RARBG, RuTracker, etc.)
- TV torrents via EZTV API
- Movie torrents via YTS API
- Torrent search via 1337x
- Movies and TV series support
- Quality filtering (4K, 1080p, 720p)
- Keyword filters (include/exclude)
- Real-Debrid and Torbox integration
- Results sorted by seeders

## Installation

### Hosted version
1. Go to the [configure page](https://your-domain.vercel.app/configure)
2. Set your preferences
3. Click "Install in Stremio"

### Self-host on Vercel
1. Fork this repo
2. Deploy to Vercel
3. Open `https://your-app.vercel.app/configure`

## Configuration

| Option | Description |
|--------|-------------|
| Quality | Filter by resolution (any/4K/1080p/720p) |
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

## Debrid Setup

1. Get API token from [Real-Debrid](https://real-debrid.com/apitoken) or [Torbox](https://torbox.app)
2. Select service in configuration
3. Paste token and install

Debrid converts torrents to direct HTTP streams for instant playback.

## Tech

- Vercel serverless functions
- Knaben torrent API
- Stremio addon protocol v3

## License

MIT
