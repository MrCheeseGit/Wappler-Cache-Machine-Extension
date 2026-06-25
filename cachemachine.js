/**
 * Cache Machine — scoped server-side cache for Wappler Server Connect (Node).
 * Redis when global.redisClient is available; in-memory fallback otherwise.
 *
 * Single-file module (Wappler may load from extensions/server_connect/modules/ or lib/modules/).
 */

const crypto = require('crypto');

const KEY_PREFIX = 'cm:';
const MAX_TTL_SECONDS = 86400 * 7; // 7 days
const MAX_MEMORY_ENTRIES = 500;

/** @type {Map<string, { value: unknown, expiresAt: number | null }>} */
const memoryCache = new Map();

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeScopeKey(raw) {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'object') {
        try {
            return JSON.stringify(raw);
        } catch {
            return '';
        }
    }
    return String(raw).trim();
}

/**
 * @param {string} segment
 * @returns {string}
 */
function sanitizeSegment(segment) {
    return String(segment || '')
        .trim()
        .replace(/[^a-zA-Z0-9._\-/]/g, '_')
        .slice(0, 120);
}

/**
 * @param {{ namespace?: string, scopePart: string, apiPath?: string }} opts
 * @returns {string}
 */
function buildCacheKey(opts) {
    const scopePart = normalizeScopeKey(opts.scopePart);
    const hash = crypto.createHash('sha256').update(scopePart).digest('hex').slice(0, 32);
    const ns = opts.namespace ? sanitizeSegment(opts.namespace) : '';
    const path = opts.apiPath ? sanitizeSegment(opts.apiPath) : '';

    if (ns && path) return `${KEY_PREFIX}${ns}:${path}:${hash}`;
    if (ns) return `${KEY_PREFIX}${ns}:${hash}`;
    if (path) return `${KEY_PREFIX}${path}:${hash}`;
    return `${KEY_PREFIX}${hash}`;
}

/**
 * @param {string} namespace
 * @returns {string}
 */
function buildNamespacePrefix(namespace) {
    const ns = sanitizeSegment(namespace);
    if (!ns) return KEY_PREFIX;
    return `${KEY_PREFIX}${ns}:`;
}

/**
 * @param {unknown} raw
 * @returns {number}
 */
function parseTtlSeconds(raw) {
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1) {
        throw new Error('cachemachine: ttl must be a positive number of seconds.');
    }
    return Math.min(MAX_TTL_SECONDS, n);
}

/**
 * @param {import('express').Request | undefined} req
 * @returns {boolean}
 */
function shouldBypassCache(req) {
    if (!req) return false;

    // Intentional bypass only. Do not honor browser Cache-Control on XHR/fetch —
    // App Connect and devtools often send no-cache on every API call, which would
    // defeat server-side cache while Set still writes.
    return !!(req.query && (req.query.nocache || req.query.noCache));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function serializeValue(value) {
    try {
        return JSON.stringify(value);
    } catch (error) {
        throw new Error(`cachemachine: data must be JSON-serializable (${error.message}).`);
    }
}

/**
 * @param {string} raw
 * @returns {unknown}
 */
function deserializeValue(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

function evictMemoryIfNeeded() {
    if (memoryCache.size <= MAX_MEMORY_ENTRIES) return;
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
}

/**
 * @param {string} key
 * @returns {{ value: unknown } | null}
 */
function memoryGet(key) {
    const entry = memoryCache.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        memoryCache.delete(key);
        return null;
    }

    return { value: entry.value };
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlSeconds
 */
function memorySet(key, value, ttlSeconds) {
    evictMemoryIfNeeded();

    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    memoryCache.set(key, { value, expiresAt });

    if (ttlSeconds > 0) {
        const timer = setTimeout(() => memoryCache.delete(key), ttlSeconds * 1000);
        if (typeof timer.unref === 'function') timer.unref();
    }
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function memoryDelete(key) {
    return memoryCache.delete(key);
}

/**
 * @param {string} prefix
 * @returns {number}
 */
function memoryDeleteByPrefix(prefix) {
    let removed = 0;
    for (const key of memoryCache.keys()) {
        if (key.startsWith(prefix)) {
            memoryCache.delete(key);
            removed++;
        }
    }
    return removed;
}

/**
 * @returns {boolean}
 */
function hasRedis() {
    return !!(global.redisClient && typeof global.redisClient.get === 'function');
}

/**
 * @returns {'redis' | 'memory'}
 */
function activeStore() {
    return hasRedis() ? 'redis' : 'memory';
}

/**
 * @param {string} key
 * @returns {Promise<{ value: unknown } | null>}
 */
async function storeGet(key) {
    if (hasRedis()) {
        const raw = await global.redisClient.get(key);
        if (raw === null || raw === undefined) return null;
        return { value: deserializeValue(raw) };
    }
    return memoryGet(key);
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlSeconds
 * @returns {Promise<void>}
 */
async function storeSet(key, value, ttlSeconds) {
    if (hasRedis()) {
        const payload = serializeValue(value);
        await global.redisClient.set(key, payload, 'EX', ttlSeconds);
        return;
    }
    memorySet(key, value, ttlSeconds);
}

/**
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function storeDelete(key) {
    if (hasRedis()) {
        const n = await global.redisClient.del(key);
        return n > 0;
    }
    return memoryDelete(key);
}

/**
 * @param {string} prefix
 * @returns {Promise<number>}
 */
async function storeDeleteByPrefix(prefix) {
    if (hasRedis()) {
        let removed = 0;
        let cursor = '0';

        do {
            const result = await global.redisClient.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
            cursor = result[0];
            const keys = result[1];
            if (keys && keys.length) {
                removed += await global.redisClient.del(keys);
            }
        } while (cursor !== '0');

        return removed;
    }

    return memoryDeleteByPrefix(prefix);
}

/**
 * Preset droplist and custom text field use different optionNames in HJSON.
 * Preset wins when set (non-empty): stale custom values must not override a later
 * preset choice — Wappler often leaves old cacheKeyCustom / namespaceCustom in the API JSON.
 * Custom fields apply only when the preset is empty (Custom / none selected).
 *
 * @param {object} app
 * @param {object} options
 * @returns {string}
 */
function resolveCacheKeyPart(app, options) {
    const preset = normalizeScopeKey(app.parseOptional(options.cacheKey, '*', ''));
    if (preset) return preset;
    return normalizeScopeKey(app.parseOptional(options.cacheKeyCustom, '*', ''));
}

/**
 * @param {object} app
 * @param {object} options
 * @returns {string}
 */
function resolveNamespacePart(app, options) {
    const preset = normalizeScopeKey(app.parseOptional(options.namespace, 'string', ''));
    if (preset) return preset;
    return normalizeScopeKey(app.parseOptional(options.namespaceCustom, 'string', ''));
}

/**
 * @param {object} app Wappler App / module context (this)
 * @param {object} options step options
 * @returns {{ namespace: string, scopePart: string, key: string, apiPath: string }}
 */
function resolveKeyContext(app, options) {
    const namespace = resolveNamespacePart(app, options);
    const requireScopeKey = app.parseOptional(options.requireScopeKey, 'boolean', true);
    const scopePart = resolveCacheKeyPart(app, options);

    if (requireScopeKey && !scopePart) {
        throw new Error(
            'cachemachine: cache key is empty. Bind {{identity}}, {{$_SERVER.REMOTE_ADDR}}, or another scope value. ' +
            'Set requireScopeKey to false only if you intend a shared cache entry.'
        );
    }

    const req = app.req;
    const apiPath = req
        ? String(req.path || req.originalUrl || '').split('?')[0]
        : '';

    const key = buildCacheKey({ namespace, scopePart, apiPath });

    return { namespace, scopePart, key, apiPath };
}

/**
 * @param {object} options
 * @returns {Promise<{ success: boolean, hit: boolean, data: unknown, key: string, store: string, bypassed?: boolean, error?: string }>}
 */
exports.get = async function get(options) {
    try {
        const ctx = resolveKeyContext(this, options);
        const store = activeStore();

        if (shouldBypassCache(this.req)) {
            return {
                success: true,
                hit: false,
                data: null,
                key: ctx.key,
                namespace: ctx.namespace,
                store,
                bypassed: true,
            };
        }

        const entry = await storeGet(ctx.key);

        if (!entry) {
            return {
                success: true,
                hit: false,
                data: null,
                key: ctx.key,
                namespace: ctx.namespace,
                store,
            };
        }

        return {
            success: true,
            hit: true,
            data: entry.value,
            key: ctx.key,
            namespace: ctx.namespace,
            store,
        };
    } catch (error) {
        return {
            success: false,
            hit: false,
            data: null,
            key: '',
            store: activeStore(),
            error: error.message,
        };
    }
};

/**
 * @param {object} options
 * @returns {Promise<{ success: boolean, key: string, store: string, ttl?: number, error?: string }>}
 */
exports.set = async function set(options) {
    try {
        const ctx = resolveKeyContext(this, options);
        const ttl = parseTtlSeconds(this.parseOptional(options.ttl, 'number', 300));
        const data = this.parseOptional(options.data, '*', null);
        const store = activeStore();

        await storeSet(ctx.key, data, ttl);

        return {
            success: true,
            key: ctx.key,
            namespace: ctx.namespace,
            store,
            ttl,
        };
    } catch (error) {
        return {
            success: false,
            key: '',
            store: activeStore(),
            error: error.message,
        };
    }
};

/**
 * @param {object} options
 * @returns {Promise<{ success: boolean, removed: number, key?: string, prefix?: string, store: string, error?: string }>}
 */
exports.clear = async function clear(options) {
    try {
        const mode = this.parseOptional(options.mode, 'string', 'exact');
        const store = activeStore();

        if (mode === 'namespace') {
            const namespace = resolveNamespacePart(this, options);
            if (!namespace) {
                throw new Error('cachemachine.clear: namespace mode requires a namespace value.');
            }

            const prefix = buildNamespacePrefix(namespace);
            const removed = await storeDeleteByPrefix(prefix);

            return {
                success: true,
                removed,
                prefix,
                namespace,
                store,
            };
        }

        const ctx = resolveKeyContext(this, options);
        const removed = (await storeDelete(ctx.key)) ? 1 : 0;

        return {
            success: true,
            removed,
            key: ctx.key,
            namespace: ctx.namespace,
            store,
        };
    } catch (error) {
        return {
            success: false,
            removed: 0,
            store: activeStore(),
            error: error.message,
        };
    }
};
