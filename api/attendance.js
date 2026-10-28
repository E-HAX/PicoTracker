'use strict';

/**
 * Public read-only attendance feed.
 *
 * This endpoint deliberately exposes only:
 * - meeting dates + labels
 * - P/R marks for usernames that are on the public leaderboard
 *
 * It never exposes admin sessions, rate-limit data, meeting IDs, or the
 * private Blob URL. The console remains the only writer.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  get: blobGet,
  BlobNotFoundError,
} = require('@vercel/blob');

const MAX_MEETINGS = 500;
const MAX_LABEL_LENGTH = 80;
const ROSTER_CACHE_MS = 30 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const USERNAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

const ENVIRONMENT = process.env.VERCEL_ENV || 'local';
const DATA_PATHNAME =
  process.env.ATTENDANCE_BLOB_PATH ||
  `attendance/${ENVIRONMENT}/state-v1.json`;

let rosterCache = null;
let rosterCacheAt = 0;

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

function setHeaders(res, cacheable) {
  res.setHeader(
    'Cache-Control',
    cacheable
      ? 'public, s-maxage=10, max-age=0'
      : 'no-store, no-cache, must-revalidate, max-age=0'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  res.setHeader('Vary', 'Accept-Encoding');
}

function storageConfigured() {
  return Boolean(
    process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN
  );
}

function storageUnavailable(cause) {
  const error = httpError(
    503,
    'storage_unavailable',
    'Attendance data is temporarily unavailable.'
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

function sanitizeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(
      /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2100) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
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
    roster.push(username);
  }

  if (roster.length === 0) {
    throw httpError(503, 'roster_empty', 'Roster data is empty.');
  }

  rosterCache = roster;
  rosterCacheAt = Date.now();
  return roster;
}

function normalizeStore(raw) {
  const meetings = [];
  const seenIds = new Set();
  const seenDates = new Set();

  const rawMeetings = Array.isArray(raw && raw.meetings) ? raw.meetings : [];
  for (const item of rawMeetings) {
    if (!item || typeof item !== 'object') continue;
    if (
      typeof item.id !== 'string' ||
      item.id.length < 8 ||
      item.id.length > 80 ||
      !/^[A-Za-z0-9_-]+$/.test(item.id)
    ) {
      continue;
    }
    if (!isValidDate(item.date)) continue;
    if (seenIds.has(item.id) || seenDates.has(item.date)) continue;
    seenIds.add(item.id);
    seenDates.add(item.date);
    meetings.push({
      id: item.id,
      date: item.date,
      label: sanitizeText(item.label) || 'CyLab Meet',
    });
    if (meetings.length >= MAX_MEETINGS) break;
  }

  const records = Object.create(null);
  const rawRecords =
    raw && raw.records && typeof raw.records === 'object'
      ? raw.records
      : {};

  for (const meeting of meetings) {
    const source = rawRecords[meeting.id];
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
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

  return {
    meetings,
    records,
    updatedAt:
      raw && typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

async function loadStore() {
  if (!storageConfigured()) {
    return { configured: false, store: normalizeStore(null) };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  let result;

  try {
    result = await blobGet(DATA_PATHNAME, {
      access: 'private',
      useCache: false,
      abortSignal: controller.signal,
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      return { configured: true, store: normalizeStore(null) };
    }
    throw storageUnavailable(error);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!result || result.statusCode !== 200 || !result.stream) {
    return { configured: true, store: normalizeStore(null) };
  }

  let text;
  try {
    text = await new Response(result.stream).text();
  } catch (error) {
    throw storageUnavailable(error);
  }

  if (!text) {
    return { configured: true, store: normalizeStore(null) };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const wrapped = httpError(
      503,
      'data_unavailable',
      'Attendance data could not be read.'
    );
    wrapped.cause = error;
    throw wrapped;
  }

  return { configured: true, store: normalizeStore(parsed) };
}

function buildPublicPayload(loaded, roster) {
  const known = new Set(roster);
  const meetings = [...loaded.store.meetings]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((meeting) => ({
      date: meeting.date,
      label: meeting.label,
    }));

  const records = Object.create(null);
  for (const meeting of loaded.store.meetings) {
    const source = loaded.store.records[meeting.id] || {};
    for (const [username, status] of Object.entries(source)) {
      if (!known.has(username)) continue;
      if (status !== 'P' && status !== 'R') continue;
      if (!records[username]) {
        records[username] = Object.create(null);
      }
      records[username][meeting.date] = status;
    }
  }

  return {
    ok: true,
    configured: loaded.configured,
    updatedAt: loaded.store.updatedAt,
    meetings,
    records,
  };
}

module.exports = async function handler(req, res) {
  setHeaders(res, req.method === 'GET');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, {
      ok: false,
      error: 'method_not_allowed',
      message: 'Method not allowed.',
    });
    return;
  }

  try {
    const roster = await loadRoster();
    const loaded = await loadStore();
    sendJson(res, 200, buildPublicPayload(loaded, roster));
  } catch (error) {
    if (error && error.expose) {
      setHeaders(res, false);
      sendJson(res, error.status || 500, {
        ok: false,
        error: error.code || 'error',
        message: error.message,
      });
      return;
    }

    console.error(
      '[attendance-public]',
      error && error.stack ? error.stack : error
    );
    setHeaders(res, false);
    sendJson(res, 500, {
      ok: false,
      error: 'internal_error',
      message: 'Internal server error.',
    });
  }
};
