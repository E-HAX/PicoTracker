'use strict';

/**
 * Owner-only attendance console API.
 *
 * Security model:
 * - Admin password is verified server-side (scrypt hash, or env password fallback).
 * - Sessions are HMAC-signed HttpOnly cookies; no session data lives client-side
 *   beyond the opaque signed token. Logout bumps a server-side session epoch.
 * - Every state-changing request requires a session-bound CSRF token and same-origin.
 * - Login attempts are rate limited per IP using a private Blob record.
 * - Attendance data is only ever returned to an authenticated admin.
 * - No attendance data lives in the static deployment.
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  get: blobGet,
  put: blobPut,
  BlobNotFoundError,
  BlobPreconditionFailedError,
} = require('@vercel/blob');

const MAX_BODY_BYTES = 256 * 1024;
const MAX_STORE_BYTES = 900 * 1024;
const MAX_MEETINGS = 500;
const MAX_LABEL_LENGTH = 80;
const MAX_PASSWORD_LENGTH = 256;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 6;
const MAX_RATE_ENTRIES = 200;
const ROSTER_CACHE_MS = 30 * 1000;
const DEFAULT_SESSION_HOURS = 4;

const ENVIRONMENT = process.env.VERCEL_ENV || 'local';
const DATA_PATHNAME =
  process.env.ATTENDANCE_BLOB_PATH ||
  `attendance/${ENVIRONMENT}/state-v1.json`;
const RATE_PATHNAME =
  process.env.ATTENDANCE_RATE_BLOB_PATH ||
  `attendance/${ENVIRONMENT}/rate-v1.json`;

const SESSION_TTL_SECONDS = (() => {
  const raw = Number(process.env.ATTENDANCE_SESSION_HOURS);
  const hours =
    Number.isFinite(raw) && raw >= 0.25 && raw <= 24
      ? raw
      : DEFAULT_SESSION_HOURS;
  return Math.round(hours * 3600);
})();

const USERNAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let rosterCache = null;
let rosterCacheAt = 0;

/* ------------------------------------------------------------------ */
/* Errors and responses                                                */
/* ------------------------------------------------------------------ */

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function setApiHeaders(res) {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Vary', 'Cookie, Origin');
}

function handleError(res, error) {
  if (res.writableEnded) return;

  if (error && error.expose) {
    sendJson(res, error.status || 400, {
      ok: false,
      error: error.code || 'request_error',
      message: error.message,
    });
    return;
  }

  console.error('[console-api]', error && error.stack ? error.stack : error);
  sendJson(res, 500, {
    ok: false,
    error: 'internal_error',
    message: 'Internal server error.',
  });
}

/* ------------------------------------------------------------------ */
/* Storage (private Vercel Blob store)                                 */
/* ------------------------------------------------------------------ */

function storageConfigured() {
  return Boolean(
    process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN
  );
}

function storageUnavailable(cause) {
  const error = httpError(
    503,
    'storage_unavailable',
    'Console storage is temporarily unavailable.'
  );
  error.cause = cause;
  return error;
}

function isNotFoundError(error) {
  return (
    error instanceof BlobNotFoundError ||
    (error && error.name === 'BlobNotFoundError')
  );
}

function isPreconditionFailed(error) {
  return (
    error instanceof BlobPreconditionFailedError ||
    (error && error.name === 'BlobPreconditionFailedError')
  );
}

function blobTimeout(ms = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    },
  };
}

async function readJsonBlob(pathname) {
  const timeout = blobTimeout();

  try {
    let result;
    try {
      result = await blobGet(pathname, {
        access: 'private',
        useCache: false,
        abortSignal: timeout.signal,
      });
    } catch (error) {
      if (isNotFoundError(error)) return { value: null, etag: null };
      throw storageUnavailable(error);
    }

    if (!result || result.statusCode !== 200 || !result.stream) {
      return {
        value: null,
        etag: result && result.blob ? result.blob.etag : null,
      };
    }

    let text;
    try {
      text = await new Response(result.stream).text();
    } catch (error) {
      throw storageUnavailable(error);
    }

    if (!text) {
      return { value: null, etag: result.blob.etag };
    }

    try {
      return { value: JSON.parse(text), etag: result.blob.etag };
    } catch (error) {
      const wrapped = httpError(
        503,
        'data_unavailable',
        'Attendance data could not be read.'
      );
      wrapped.cause = error;
      throw wrapped;
    }
  } finally {
    timeout.clear();
  }
}

async function writeJsonBlob(pathname, value, etag) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, 'utf8') > MAX_STORE_BYTES) {
    throw httpError(
      413,
      'data_too_large',
      'Attendance data is too large to save.'
    );
  }

  const timeout = blobTimeout();
  const options = {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    abortSignal: timeout.signal,
  };
  if (etag) options.ifMatch = etag;

  try {
    return await blobPut(pathname, body, options);
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw httpError(
        409,
        'revision_conflict',
        'Attendance data changed in another tab. Reload and try again.'
      );
    }
    throw storageUnavailable(error);
  } finally {
    timeout.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Roster                                                              */
/* ------------------------------------------------------------------ */

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(
      /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanRosterName(value) {
  const name = sanitizeText(value, MAX_LABEL_LENGTH);
  if (!name || name === 'Name not given' || name === 'Busy Person') {
    return '';
  }
  return name;
}

async function loadRoster() {
  if (rosterCache && Date.now() - rosterCacheAt < ROSTER_CACHE_MS) {
    return rosterCache;
  }

  const candidates = [
    path.join(process.cwd(), 'leaderboard.json'),
    path.join(__dirname, '..', 'leaderboard.json'),
  ];

  let raw = null;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      raw = await fs.readFile(candidate, 'utf8');
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!raw) {
    const error = httpError(
      503,
      'roster_unavailable',
      'Roster data is unavailable.'
    );
    error.cause = lastError;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const wrapped = httpError(
      503,
      'roster_unavailable',
      'Roster data could not be read.'
    );
    wrapped.cause = error;
    throw wrapped;
  }

  const entries = Array.isArray(parsed && parsed.leaderboard)
    ? parsed.leaderboard
    : [];
  const seen = new Set();
  const roster = [];

  for (const entry of entries) {
    if (!entry || typeof entry.username !== 'string') continue;
    const username = entry.username.trim();
    if (!USERNAME_RE.test(username)) continue;
    const key = username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    roster.push({
      username,
      name: cleanRosterName(entry.name),
    });
  }

  if (roster.length === 0) {
    throw httpError(503, 'roster_empty', 'Roster data is empty.');
  }

  roster.sort((a, b) => {
    const aName = a.name || a.username;
    const bName = b.name || b.username;
    return (
      aName.localeCompare(bName, undefined, { sensitivity: 'base' }) ||
      a.username.localeCompare(b.username, undefined, {
        sensitivity: 'base',
      })
    );
  });

  rosterCache = roster;
  rosterCacheAt = Date.now();
  return roster;
}

/* ------------------------------------------------------------------ */
/* Data store                                                          */
/* ------------------------------------------------------------------ */

function emptyStore() {
  return {
    version: 1,
    revision: 0,
    sessionEpoch: 0,
    meetings: [],
    records: {},
    updatedAt: null,
  };
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw httpError(400, 'invalid_date', 'Enter a valid date.');
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2100) {
    throw httpError(400, 'invalid_date', 'Date is outside the supported range.');
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw httpError(400, 'invalid_date', 'Enter a valid date.');
  }
  return value;
}

function normalizeLabel(value) {
  if (value === undefined || value === null || value === '') {
    return 'CyLab Meet';
  }
  if (typeof value !== 'string') {
    throw httpError(400, 'invalid_label', 'Invalid meeting label.');
  }
  const label = sanitizeText(value, MAX_LABEL_LENGTH);
  return label || 'CyLab Meet';
}

function normalizeId(value) {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 80 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw httpError(400, 'invalid_id', 'Invalid meeting identifier.');
  }
  return value;
}

function parseRevision(value) {
  const revision =
    typeof value === 'number' ? value : Number(value);
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision > 1_000_000_000
  ) {
    throw httpError(400, 'invalid_revision', 'Invalid data revision.');
  }
  return revision;
}

function sanitizeStoredMeeting(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (
    typeof raw.id !== 'string' ||
    raw.id.length < 8 ||
    raw.id.length > 80 ||
    !/^[A-Za-z0-9_-]+$/.test(raw.id)
  ) {
    return null;
  }

  let date;
  try {
    date = normalizeDate(raw.date);
  } catch (_) {
    return null;
  }

  const label =
    typeof raw.label === 'string' && raw.label.trim()
      ? sanitizeText(raw.label, MAX_LABEL_LENGTH)
      : 'CyLab Meet';

  const now = new Date().toISOString();
  return {
    id: raw.id,
    date,
    label: label || 'CyLab Meet',
    createdAt:
      typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt:
      typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore();

  const meetings = [];
  const meetingIds = new Set();
  const meetingDates = new Set();
  const rawMeetings = Array.isArray(raw.meetings) ? raw.meetings : [];

  for (const item of rawMeetings) {
    const meeting = sanitizeStoredMeeting(item);
    if (!meeting) continue;
    if (meetingIds.has(meeting.id) || meetingDates.has(meeting.date)) {
      continue;
    }
    meetingIds.add(meeting.id);
    meetingDates.add(meeting.date);
    meetings.push(meeting);
    if (meetings.length >= MAX_MEETINGS) break;
  }

  const records = Object.create(null);
  const rawRecords =
    raw.records && typeof raw.records === 'object' ? raw.records : {};

  for (const meeting of meetings) {
    const source = rawRecords[meeting.id];
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      records[meeting.id] = Object.create(null);
      continue;
    }
    const clean = Object.create(null);
    for (const [username, status] of Object.entries(source)) {
      if (!USERNAME_RE.test(username)) continue;
      if (status === 'P' || status === 'R') {
        clean[username] = status;
      }
    }
    records[meeting.id] = clean;
  }

  const revision = Number(raw.revision);
  const sessionEpoch = Number(raw.sessionEpoch);
  return {
    version: 1,
    revision:
      Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    sessionEpoch:
      Number.isSafeInteger(sessionEpoch) && sessionEpoch >= 0
        ? sessionEpoch
        : 0,
    meetings,
    records,
    updatedAt:
      typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

async function loadStore() {
  const { value, etag } = await readJsonBlob(DATA_PATHNAME);
  return { store: normalizeStore(value), etag };
}

async function withStoreWrite(callback, session) {
  const { store, etag } = await loadStore();

  if (session && session.epoch !== store.sessionEpoch) {
    throw httpError(
      401,
      'session_revoked',
      'Session is no longer valid. Authenticate again.'
    );
  }

  const result = await callback(store);

  store.version = 1;
  store.revision += 1;
  store.updatedAt = new Date().toISOString();

  await writeJsonBlob(DATA_PATHNAME, store, etag);
  return { store, result };
}

function requireRevision(store, expected) {
  if (expected !== store.revision) {
    throw httpError(
      409,
      'revision_conflict',
      'Attendance data changed in another tab. Reload and try again.'
    );
  }
}

function buildPublicData(store, roster) {
  const known = new Set(roster.map((entry) => entry.username));
  const records = {};

  const meetings = [...store.meetings].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      String(b.createdAt).localeCompare(String(a.createdAt))
  );

  for (const meeting of meetings) {
    const source = store.records[meeting.id] || {};
    const clean = Object.create(null);
    for (const [username, status] of Object.entries(source)) {
      if (known.has(username) && (status === 'P' || status === 'R')) {
        clean[username] = status;
      }
    }
    records[meeting.id] = clean;
  }

  return {
    revision: store.revision,
    updatedAt: store.updatedAt,
    meetings,
    records,
  };
}

function buildClientPayload(store, roster, session, meta) {
  const payload = {
    ok: true,
    data: buildPublicData(store, roster),
    roster,
  };
  if (session) {
    payload.csrf = session.csrf;
    payload.expiresAt = session.exp;
  }
  if (meta) payload.meta = meta;
  return payload;
}

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

function passwordMaterial() {
  const rawHash = String(
    process.env.ATTENDANCE_ADMIN_PASSWORD_HASH || ''
  ).trim();
  const hash = rawHash
    .replace(/^['"]|['"]$/g, '')
    .replace(/^ATTENDANCE_ADMIN_PASSWORD_HASH=/, '')
    .trim();
  if (hash) return { kind: 'hash', value: hash };

  const plain = String(process.env.ATTENDANCE_ADMIN_PASSWORD || '');
  if (plain) return { kind: 'plain', value: plain };

  return { kind: 'none', value: '' };
}

function passwordConfigured() {
  return passwordMaterial().kind !== 'none';
}

function authFingerprint() {
  const material = passwordMaterial();
  return crypto
    .createHash('sha256')
    .update(
      `cylabs-console-auth:${material.kind}:${
        material.value || 'unconfigured'
      }`
    )
    .digest('base64url')
    .slice(0, 22);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  return (
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

function scryptAsync(password, salt, keyLength, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

async function verifyScryptPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isInteger(N) ||
    N < 4096 ||
    N > 1_048_576 ||
    (N & (N - 1)) !== 0 ||
    !Number.isInteger(r) ||
    r < 1 ||
    r > 32 ||
    !Number.isInteger(p) ||
    p < 1 ||
    p > 16
  ) {
    return false;
  }

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch (_) {
    return false;
  }
  if (
    salt.length < 16 ||
    expected.length < 32 ||
    expected.length > 128
  ) {
    return false;
  }

  const memory = 128 * N * r;
  if (memory > 512 * 1024 * 1024) return false;

  let derived;
  try {
    derived = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(64 * 1024 * 1024, memory * 2),
    });
  } catch (_) {
    return false;
  }

  return (
    derived.length === expected.length &&
    crypto.timingSafeEqual(derived, expected)
  );
}

async function verifyPassword(password) {
  const material = passwordMaterial();

  if (material.kind === 'hash') {
    try {
      return await verifyScryptPassword(password, material.value);
    } catch (_) {
      return false;
    }
  }

  if (material.kind === 'plain') {
    const inputDigest = crypto
      .createHash('sha256')
      .update(password, 'utf8')
      .digest();
    const storedDigest = crypto
      .createHash('sha256')
      .update(material.value, 'utf8')
      .digest();
    return crypto.timingSafeEqual(inputDigest, storedDigest);
  }

  return false;
}

function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (proto) return proto === 'https';
  return (
    process.env.VERCEL_ENV === 'production' ||
    process.env.VERCEL_ENV === 'preview'
  );
}

function sessionCookieName(req) {
  return isHttps(req) ? '__Host-cylab_sess' : 'cylab_sess';
}

function serializeCookie(req, name, value, maxAge) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (isHttps(req)) parts.push('Secure');
  if (maxAge !== null && maxAge !== undefined) {
    parts.push(`Max-Age=${maxAge}`);
  }
  if (maxAge === 0) {
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  return parts.join('; ');
}

function setSessionCookie(req, res, token) {
  // Browser-session cookie; the signed token's expiry enforces the max TTL.
  res.setHeader(
    'Set-Cookie',
    serializeCookie(req, sessionCookieName(req), token, null)
  );
}

function clearSessionCookie(req, res) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(req, sessionCookieName(req), '', 0)
  );
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch (_) {
      return null;
    }
  }
  return null;
}

function sessionSigningKey() {
  const material = passwordMaterial();
  return crypto
    .createHash('sha256')
    .update(
      `cylabs-console-session:${material.kind}:${
        material.value || 'unconfigured'
      }`
    )
    .digest();
}

function createSession(epoch) {
  const csrf = crypto.randomBytes(32).toString('base64url');
  const exp = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = {
    v: 1,
    exp,
    csrf,
    epoch,
    auth: authFingerprint(),
    n: crypto.randomBytes(12).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  const signature = crypto
    .createHmac('sha256', sessionSigningKey())
    .update(encoded)
    .digest('base64url');
  return {
    token: `${encoded}.${signature}`,
    csrf,
    exp,
    epoch,
  };
}

function getSession(req) {
  if (!passwordConfigured()) return null;

  const token = readCookie(req, sessionCookieName(req));
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;

  const expected = crypto
    .createHmac('sha256', sessionSigningKey())
    .update(encoded)
    .digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  let session;
  try {
    session = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    );
  } catch (_) {
    return null;
  }

  if (
    !session ||
    session.v !== 1 ||
    typeof session.csrf !== 'string' ||
    typeof session.exp !== 'number' ||
    session.exp <= Date.now() ||
    !Number.isSafeInteger(session.epoch) ||
    session.epoch < 0 ||
    session.auth !== authFingerprint()
  ) {
    return null;
  }

  return {
    csrf: session.csrf,
    exp: session.exp,
    epoch: session.epoch,
  };
}

function requireSession(session) {
  if (!session) {
    throw httpError(401, 'unauthorized', 'Authentication required.');
  }
  return session;
}

function assertCsrf(req, session) {
  const token =
    req.headers['x-csrf-token'] ||
    req.headers['x-attendance-csrf'] ||
    '';
  if (!safeEqual(token, session.csrf)) {
    throw httpError(403, 'csrf_failed', 'Request verification failed.');
  }
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let parsed;
    try {
      parsed = new URL(String(origin));
    } catch (_) {
      throw httpError(403, 'origin_failed', 'Request origin rejected.');
    }
    const requestHost = String(req.headers.host || '').toLowerCase();
    if (parsed.host.toLowerCase() !== requestHost) {
      throw httpError(403, 'origin_failed', 'Request origin rejected.');
    }
  }

  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    throw httpError(403, 'origin_failed', 'Request origin rejected.');
  }
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (forwarded) return forwarded;
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (real) return real;
  return (
    (req.socket && req.socket.remoteAddress) ||
    (req.connection && req.connection.remoteAddress) ||
    'unknown'
  );
}

function rateFingerprint(req) {
  const pepper = passwordMaterial().value || 'cylab-console';
  return crypto
    .createHmac('sha256', pepper)
    .update(clientIp(req))
    .digest('hex')
    .slice(0, 32);
}

function normalizeRateEntries(value, now) {
  const entries = Object.create(null);
  const source =
    value &&
    typeof value === 'object' &&
    value.entries &&
    typeof value.entries === 'object'
      ? value.entries
      : {};

  for (const [key, item] of Object.entries(source)) {
    if (typeof key !== 'string' || key.length > 64) continue;
    if (
      !item ||
      typeof item.count !== 'number' ||
      typeof item.reset !== 'number' ||
      !Number.isFinite(item.reset) ||
      item.reset <= now
    ) {
      continue;
    }
    entries[key] = {
      count: Math.max(0, Math.floor(item.count)),
      reset: item.reset,
    };
  }

  return entries;
}

function pruneRateEntries(entries) {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_RATE_ENTRIES) return;
  keys.sort((a, b) => entries[a].reset - entries[b].reset);
  const removeCount = keys.length - MAX_RATE_ENTRIES;
  for (let index = 0; index < removeCount; index += 1) {
    delete entries[keys[index]];
  }
}

async function bumpLoginRate(req) {
  const key = rateFingerprint(req);
  const now = Date.now();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { value, etag } = await readJsonBlob(RATE_PATHNAME);
    const entries = normalizeRateEntries(value, now);
    const current = entries[key];

    if (current && current.count >= LOGIN_MAX_ATTEMPTS) {
      return {
        allowed: false,
        key,
        retryAfter: Math.max(
          1,
          Math.ceil((current.reset - now) / 1000)
        ),
      };
    }

    const reset =
      current && current.reset > now
        ? current.reset
        : now + LOGIN_WINDOW_SECONDS * 1000;
    const count = (current ? current.count : 0) + 1;
    entries[key] = { count, reset };
    pruneRateEntries(entries);

    try {
      await writeJsonBlob(
        RATE_PATHNAME,
        { version: 1, entries },
        etag
      );
      return {
        allowed: true,
        key,
        count,
        retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)),
      };
    } catch (error) {
      if (error && error.status === 409) continue;
      throw error;
    }
  }

  throw httpError(
    503,
    'storage_busy',
    'Login verification is busy. Try again in a moment.'
  );
}

async function clearLoginRate(key) {
  if (!key) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { value, etag } = await readJsonBlob(RATE_PATHNAME);
      const entries = normalizeRateEntries(value, Date.now());
      if (!entries[key]) return;
      delete entries[key];
      await writeJsonBlob(
        RATE_PATHNAME,
        { version: 1, entries },
        etag
      );
      return;
    } catch (error) {
      if (error && error.status === 409) continue;
      return;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Request body                                                        */
/* ------------------------------------------------------------------ */

async function readBody(req) {
  const declaredLength = Number(req.headers['content-length']);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_BODY_BYTES
  ) {
    throw httpError(413, 'body_too_large', 'Request body is too large.');
  }

  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (body === undefined || body === null || body === '') body = {};

  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw httpError(413, 'body_too_large', 'Request body is too large.');
    }
    try {
      body = JSON.parse(body);
    } catch (_) {
      throw httpError(400, 'invalid_json', 'Invalid request body.');
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'invalid_body', 'Invalid request body.');
  }

  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
    throw httpError(413, 'body_too_large', 'Request body is too large.');
  }

  return body;
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

async function handleGet(req, res) {
  const session = getSession(req);
  if (!session) {
    clearSessionCookie(req, res);
    throw httpError(401, 'unauthorized', 'Authentication required.');
  }

  const [roster, loaded] = await Promise.all([
    loadRoster(),
    loadStore(),
  ]);
  const store = loaded.store;

  if (session.epoch !== store.sessionEpoch) {
    clearSessionCookie(req, res);
    throw httpError(
      401,
      'session_revoked',
      'Session is no longer valid. Authenticate again.'
    );
  }

  sendJson(
    res,
    200,
    buildClientPayload(store, roster, session)
  );
}

async function handleLogin(req, res, body) {
  if (!passwordConfigured() || !storageConfigured()) {
    throw httpError(
      503,
      'not_configured',
      'Admin access is not configured on this deployment.'
    );
  }

  const rate = await bumpLoginRate(req);
  if (!rate.allowed) {
    res.setHeader(
      'Retry-After',
      String(rate.retryAfter || LOGIN_WINDOW_SECONDS)
    );
    throw httpError(
      429,
      'rate_limited',
      'Too many attempts. Try again later.'
    );
  }

  const password = body.password;
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    await sleep(300);
    throw httpError(401, 'invalid_credentials', 'Invalid credentials.');
  }

  const valid = await verifyPassword(password);
  if (!valid) {
    await sleep(300);
    throw httpError(401, 'invalid_credentials', 'Invalid credentials.');
  }

  await clearLoginRate(rate.key);

  const [roster, loaded] = await Promise.all([
    loadRoster(),
    loadStore(),
  ]);
  const store = loaded.store;
  const session = createSession(store.sessionEpoch);

  setSessionCookie(req, res, session.token);
  sendJson(
    res,
    200,
    buildClientPayload(store, roster, session)
  );
}

async function handleLogout(req, res, session) {
  let revoked = false;
  let failure = null;

  if (session) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await withStoreWrite(async (store) => {
          store.sessionEpoch = (store.sessionEpoch || 0) + 1;
          return {};
        }, session);
        revoked = true;
        break;
      } catch (error) {
        failure = error;
        if (error && error.status === 409) continue;
        break;
      }
    }
  } else {
    revoked = true;
  }

  clearSessionCookie(req, res);

  // A 401 means the session epoch already invalidated this cookie. Anything
  // else means we cleared the browser cookie but could not revoke the token
  // server-side; tell the client so it can warn instead of claiming success.
  if (session && !revoked && (!failure || failure.status !== 401)) {
    sendJson(res, 503, {
      ok: false,
      error: 'logout_incomplete',
      message:
        'Locked locally, but the server could not revoke the session. It will expire automatically.',
    });
    return;
  }

  sendJson(res, 200, { ok: true, revoked });
}

async function handleAddMeeting(req, res, body, session) {
  const date = normalizeDate(body.date);
  const label = normalizeLabel(body.label);
  const expected = parseRevision(body.expectedRevision);
  const roster = await loadRoster();

  const { store, result } = await withStoreWrite(async (draft) => {
    requireRevision(draft, expected);

    if (draft.meetings.some((meeting) => meeting.date === date)) {
      throw httpError(
        409,
        'duplicate_date',
        'A meeting already exists on this date.'
      );
    }
    if (draft.meetings.length >= MAX_MEETINGS) {
      throw httpError(
        413,
        'too_many_meetings',
        'The meeting limit has been reached.'
      );
    }

    const now = new Date().toISOString();
    const meeting = {
      id: crypto.randomUUID(),
      date,
      label,
      createdAt: now,
      updatedAt: now,
    };
    draft.meetings.push(meeting);
    draft.records[meeting.id] = {};
    return { meetingId: meeting.id };
  }, session);

  sendJson(
    res,
    200,
    buildClientPayload(store, roster, session, result)
  );
}

async function handleUpdateMeeting(req, res, body, session) {
  const meetingId = normalizeId(body.meetingId);
  const date = normalizeDate(body.date);
  const label = normalizeLabel(body.label);
  const expected = parseRevision(body.expectedRevision);
  const roster = await loadRoster();

  const { store, result } = await withStoreWrite(async (draft) => {
    requireRevision(draft, expected);

    const meeting = draft.meetings.find((item) => item.id === meetingId);
    if (!meeting) {
      throw httpError(404, 'meeting_not_found', 'Meeting not found.');
    }

    if (
      draft.meetings.some(
        (item) => item.id !== meetingId && item.date === date
      )
    ) {
      throw httpError(
        409,
        'duplicate_date',
        'A meeting already exists on this date.'
      );
    }

    meeting.date = date;
    meeting.label = label;
    meeting.updatedAt = new Date().toISOString();
    return { meetingId: meeting.id };
  }, session);

  sendJson(
    res,
    200,
    buildClientPayload(store, roster, session, result)
  );
}

async function handleDeleteMeeting(req, res, body, session) {
  const meetingId = normalizeId(body.meetingId);
  const expected = parseRevision(body.expectedRevision);
  const roster = await loadRoster();

  const { store, result } = await withStoreWrite(async (draft) => {
    requireRevision(draft, expected);

    const index = draft.meetings.findIndex(
      (meeting) => meeting.id === meetingId
    );
    if (index === -1) {
      throw httpError(404, 'meeting_not_found', 'Meeting not found.');
    }

    draft.meetings.splice(index, 1);
    delete draft.records[meetingId];
    return { deletedMeetingId: meetingId };
  }, session);

  sendJson(
    res,
    200,
    buildClientPayload(store, roster, session, result)
  );
}

function normalizeMarks(marks, roster) {
  if (marks === undefined || marks === null) return {};
  if (typeof marks !== 'object' || Array.isArray(marks)) {
    throw httpError(400, 'invalid_marks', 'Invalid attendance marks.');
  }

  const known = new Set(roster.map((entry) => entry.username));
  const clean = Object.create(null);
  const entries = Object.entries(marks);

  if (entries.length > roster.length + 10) {
    throw httpError(400, 'invalid_marks', 'Invalid attendance marks.');
  }

  for (const [username, status] of entries) {
    if (!known.has(username)) continue;
    const normalized =
      typeof status === 'string' ? status.toUpperCase() : '';
    if (normalized === 'P' || normalized === 'R') {
      clean[username] = normalized;
    }
  }

  return clean;
}

async function handleSaveAttendance(req, res, body, session) {
  const meetingId = normalizeId(body.meetingId);
  const expected = parseRevision(body.expectedRevision);
  const roster = await loadRoster();
  const marks = normalizeMarks(body.marks, roster);

  const { store, result } = await withStoreWrite(async (draft) => {
    requireRevision(draft, expected);

    const meeting = draft.meetings.find((item) => item.id === meetingId);
    if (!meeting) {
      throw httpError(404, 'meeting_not_found', 'Meeting not found.');
    }

    draft.records[meetingId] = marks;
    meeting.updatedAt = new Date().toISOString();
    return {
      meetingId,
      saved: Object.keys(marks).length,
    };
  }, session);

  sendJson(
    res,
    200,
    buildClientPayload(store, roster, session, result)
  );
}

async function handlePost(req, res) {
  assertSameOrigin(req);
  const body = await readBody(req);
  const action = typeof body.action === 'string' ? body.action : '';

  if (action === 'login') {
    await handleLogin(req, res, body);
    return;
  }

  if (action === 'logout') {
    const session = getSession(req);
    if (session) assertCsrf(req, session);
    await handleLogout(req, res, session);
    return;
  }

  const session = requireSession(getSession(req));
  assertCsrf(req, session);

  switch (action) {
    case 'add-meeting':
      await handleAddMeeting(req, res, body, session);
      break;
    case 'update-meeting':
      await handleUpdateMeeting(req, res, body, session);
      break;
    case 'delete-meeting':
      await handleDeleteMeeting(req, res, body, session);
      break;
    case 'save-attendance':
      await handleSaveAttendance(req, res, body, session);
      break;
    default:
      throw httpError(400, 'unknown_action', 'Unknown action.');
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

module.exports = async function handler(req, res) {
  setApiHeaders(res);

  try {
    if (req.method === 'GET') {
      await handleGet(req, res);
      return;
    }

    if (req.method === 'POST') {
      await handlePost(req, res);
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    throw httpError(405, 'method_not_allowed', 'Method not allowed.');
  } catch (error) {
    handleError(res, error);
  }
};
