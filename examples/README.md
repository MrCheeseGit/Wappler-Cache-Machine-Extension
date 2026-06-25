# Cache Machine examples

## notifications-cached.json

Generic pattern for `/api/user/notifications` (or similar):

1. **Cache Machine Get** — `cacheKey`: `{{identity}}`, `namespace`: `notifications`
2. **Condition** — if `{{cacheGet.hit}}`, return `{{cacheGet.data}}`
3. Otherwise run your query, **Cache Machine Set**, return fresh data

Replace:

- `yourSecurityProvider` — your Wappler Security Provider name (or remove restrict from settings)
- `yourConnection` — your database connection
- Table/column names — match your schema

**Do not** enable route-level TTL on this API — native Wappler cache keys by URL only and would leak data across users.

## Testing cache bypass

Append `?nocache=1` to the API URL to force a fresh read on Get.
