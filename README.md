# Cache Machine Extension


**Scoped server-side cache for Wappler Server Connect** — cache per user, per IP, per tenant, or any key you define inside your API.

[![License: Mr Cheese Extension v1.0](https://img.shields.io/badge/License-Mr%20Cheese%20Extension%20v1.0-blue.svg)](https://www.mrcheese.co.uk/extension-license)
![Wappler](https://img.shields.io/badge/Wappler-Server%20Connect-teal)
![Version](https://img.shields.io/badge/version-1%2E1%2E12-green)

Built by **[Mr Cheese](https://www.mrcheese.co.uk)** · Wappler extensions & custom modules

---

## What it does

Wappler route **TTL** caches by **URL only** (`erc:{url}`). That breaks user-specific APIs like `/api/user/notifications` — every user gets the same cached response.

Cache Machine adds **scoped** get/set/clear steps inside Server Connect:

| Step | Purpose |
|------|---------|
| **Cache Machine Get** | Read cache — `{{cacheGet.hit}}`, `{{cacheGet.data}}` |
| **Cache Machine Set** | Store step output with TTL |
| **Cache Machine Clear** | Delete one key or wipe a namespace |

**Works with or without Redis** — uses Redis when Wappler has `global.redisClient`; otherwise an in-memory store (fine for local dev / single instance).

### Caching in plain English (the waiter analogy)

Imagine a busy café:

- **Without cache** — every time someone asks “What’s Steve’s order?” the waiter runs to the kitchen and looks it up in the big book. **That’s your database on every API call.**
- **With cache** — the waiter writes Steve’s order on a **sticky note**. The next time Steve asks within a few minutes, they read the note — **no trip to the kitchen.**

**Cache Machine Get** = “Do we have a sticky note?”  
**Cache Machine Set** = “Write the sticky note (with an expiry time).”  
**Cache Machine Clear** = “Throw the sticky note away.”

Wappler’s built-in route TTL is like **one sticky note per table number (URL)** — fine when everyone gets the same answer, dangerous when the answer depends on **who is logged in**.

Cache Machine lets you label the note **per user** (`{{identity}}`), **per IP**, or any binding you choose — and **namespace** is which pile of notes to clear when something changes (e.g. all `notifications` notes).

| Analogy | Cache Machine |
|---------|----------------|
| Kitchen | Database |
| Sticky note | Cached API result |
| Note expiry | TTL (seconds) |
| “Steve’s order” on the note | Scoped **cache key** |
| Which pile of notes | **Namespace** preset |
| Waiter’s counter | **Memory** store (this server only) |
| Shared notice board | **Redis** (all servers read the same notes) |

---

## Install

Pick **one** install path and follow it completely:

| Path | Best for |
|------|----------|
| **Git** (recommended) | Most reliable; uses `git clone` + copy from the repo |
| **npm** | You already use Wappler Project Settings → Extensions |

Both paths copy files into `extensions/` and `lib/modules/`. The npm path also requires verifying `node_modules/wappler-cache-machine` exists **before** you run any copy commands.

### Git install — Extension Installer (recommended)

This repo ships **`wappler-install.json`** at the root. Use the **[Mr Cheese Extension Installer](https://www.mrcheese.co.uk/extensions/install)** — select **Cache Machine**, keep **Use wappler-install.json from the repository** enabled, and run the generated script in your terminal.

### Manual install

Run from your **Wappler project root** (the folder that contains `package.json`). Skip `git clone` if you already have this repo cloned alongside your project.

```bash
git clone https://github.com/MrCheeseGit/Wappler-Cache-Machine-Extension.git ../Wappler-Cache-Machine-Extension

cp ../Wappler-Cache-Machine-Extension/server_connect/modules/cachemachine_get.hjson extensions/server_connect/modules/
cp ../Wappler-Cache-Machine-Extension/server_connect/modules/cachemachine_set.hjson extensions/server_connect/modules/
cp ../Wappler-Cache-Machine-Extension/server_connect/modules/cachemachine_clear.hjson extensions/server_connect/modules/
cp ../Wappler-Cache-Machine-Extension/server_connect/modules/cachemachine.js lib/modules/
```

Wappler may also load `cachemachine.js` from `extensions/server_connect/modules/` (npm / deploy). The module is **self-contained** — no second file required.

Quit Wappler completely and restart.


### npm install (Wappler Project Settings)

1. **Wappler** → Project Settings → Extensions → Add → `wappler-cache-machine`
2. From your project root: `npm install`
3. **Quit Wappler completely** and reopen your project.

#### Local `file:` development (optional)

```json
"devDependencies": {
  "wappler-cache-machine": "file:../path/to/this-extension"
}
```

After you change extension source, run `npm install` again, then Project Updater if needed, and restart Wappler.

## Quick start

Typical flow for `/api/user/notifications`:

1. `auth.restrict` (if the API is protected)
2. **Cache Machine Get** — cache key `{{identity}}`, namespace `notifications`
3. **Condition** — if `{{cacheGet.hit}}`, return `{{cacheGet.data}}`
4. Database query (or other expensive logic)
5. **Cache Machine Set** — data `{{yourQuery}}`, TTL `120`, same key + namespace
6. Return fresh data

See [examples/notifications-cached.json](examples/notifications-cached.json).

---

## Cache key presets

Each step includes a **Cache key preset** droplist:

- **Per user** — `{{identity}}`
- **Per IP** — `{{$_SERVER.REMOTE_ADDR}}`
- **Per user + URI** — `{{identity}}:{{$_SERVER.REQUEST_URI}}`
- **Custom** — bind any expression in the field below (e.g. `{{yourProvider.identity}}` when the security provider has a name)

Use the **same** cache key on Get and Set. Named security providers often need **Custom** with `{{providerName.identity}}`, not the generic Per user preset.

If a binding is missing from the picker, add it under API **Input** (native Wappler) or type the expression manually.

## Namespace presets

**Namespace** groups related cache entries (mainly for **Clear**). Pick a preset on Get, Set, and Clear — or **Custom** for your own name (e.g. `adminProfile`, `vendorQuotes`).

| Preset | Typical use |
|--------|-------------|
| `userProfile` | Account / profile data |
| `userSettings` | Preferences, toggles |
| `notifications` | Alerts, inbox |
| `dashboard` | Summary / home widgets |
| `list` | Tables, paginated lists |
| `detail` | Single record view |
| `search` | Search results |
| `lookup` | Reference / dropdown data |
| `content` | CMS pages, blocks |
| `report` | Slow reports, aggregates |

Leave **Custom** empty if you do not need a namespace. Use the **same** preset (or custom value) on Get, Set, and Clear in that API.

Get and Set also return **`namespace`** in their output — bind `{{cacheGet.namespace}}` on Clear if you prefer.

### Preset vs custom (important)

On **Get**, **Set**, and **Clear**, runtime resolution is:

1. **Preset dropdown** — if a preset is selected (non-empty), that value is used.
2. **Custom field** — only when preset is **Custom** / **none** (empty dropdown value).

If someone switches from Custom to a preset, the preset **wins** even if Wappler left old text in the custom field in the saved API JSON. Stale custom values cannot override a preset choice.

---

## Clear cache

| Mode | Use when |
|------|----------|
| **Exact key** | Same namespace + cache key as Get/Set (e.g. after profile update) |
| **Namespace** | Wipe all keys under `cm:{namespace}:` (e.g. flush all notification caches) |

---

## Bypass cache (Get)

Append **`?nocache=1`** to the API URL when you need a fresh read (testing, after an update).

Get returns `bypassed: true` and `hit: false`. Set is not bypassed — it still writes when the miss branch runs.

Browser `Cache-Control` headers on App Connect / XHR requests are **ignored** on purpose; they would otherwise bypass every portal load while Set still cached.

---

## Storage backends

| Backend | When | Notes |
|---------|------|-------|
| **redis** | Wappler Redis configured | Shared across instances; use in production |
| **memory** | No Redis | Per-process; lost on restart; max ~500 entries |

Step output includes `store: 'redis' | 'memory'` so you know which path ran.

### Not a Redis replacement

Cache Machine is **scoped API caching**, not a general Redis alternative. It does not provide pub/sub, queues, or Wappler rate-limiter storage.

---

## Safety

- **Require non-empty cache key** defaults to **on** — prevents accidental global cache on user-specific endpoints.
- **Wrong cache key = data leak** — always include `{{identity}}` on authenticated APIs.
- Only **JSON-serializable** data can be cached.
- Max TTL: **7 days** (604800 seconds).
- **Do not** enable route-level TTL on the same API — native URL cache can still leak across users.

---

## Actions reference

### Cache Machine Get

Returns: `{ success, hit, data, key, namespace, store, bypassed?, error? }`

### Cache Machine Set

Returns: `{ success, key, namespace, store, ttl, error? }`

### Cache Machine Clear

Returns: `{ success, removed, key?, namespace?, prefix?, store, error? }`

---

## Examples

[examples/](examples/) — generic notification API pattern.

---

## Compatibility

Standalone extension. For shared patterns (Redirect-IT step order, PuSH-IT, optional pairs), see [Mr Cheese extension docs](https://github.com/MrCheeseGit/Wappler-Extension-Docs/blob/main/extension-compatibility.md).

## License

[Mr Cheese Extension License v1.0](https://www.mrcheese.co.uk/extension-license) — see [LICENSE](LICENSE). © [Mr Cheese](https://www.mrcheese.co.uk)
