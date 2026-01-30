# Flix Finder Ext.to Stremio Addon

This Stremio addon searches ext.to by IMDb ID and returns magnet links as streams.

## Deploy to Vercel

1. Deploy the repository to Vercel.
2. Open the addon manifest:
   - `https://<your-vercel-domain>/manifest.json`
3. Optionally open the configuration page:
   - `https://<your-vercel-domain>/configure`
3. Add the addon to Stremio using the manifest URL.

## Endpoint behavior

- `GET /manifest.json` returns the addon manifest.
- `GET /stream/{type}/{imdbId}.json` returns magnet streams scraped from:
  `https://ext.to/browse/?imdb_id={imdbId}`
- `GET /configure` shows a configuration page with quality, keyword, and debrid filters.

Example:
```
/stream/movie/tt1234567.json
```

## Notes

- The addon only accepts IMDb IDs (e.g. `tt1234567`) and ignores any season/episode suffixes.
- Use the configuration page to set quality, include/exclude keywords, max results, and debrid settings.
- Debrid options require an API token in the manifest query string.
- If ext.to blocks requests with a 403 or returns no magnets, the addon retries through a text proxy and alternate host (search.extto.com).
- Some titles require visiting the detail page to extract magnets; the addon fetches those pages as needed.
- If ext.to responds with no results or fails, an empty stream list is returned.
