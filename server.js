'use strict';
/**
 * SECURE Parts Whiteboard
 * Zero runtime dependencies; file-backed persistent storage.
 * Railway: add a Volume mounted at /data and set DATA_DIR=/data.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const HOST = process.env.HOST || (process.env.SECURE_APP_PIN || process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(process.env.PORT || 3000);
const ACCESS_CODE = process.env.SECURE_APP_PIN || '';
const MISSING_RAILWAY_PIN = Boolean(process.env.RAILWAY_ENVIRONMENT && !ACCESS_CODE);
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'secure-data.json');
const MAX_BODY = 1024 * 1024;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();

function dateTime() { return new Date().toISOString(); }
function starterData() {
  const now = dateTime();
  const examples = [
    ['pickup', 'Finning', 'LD167', 'Edge, hooks'],
    ['pickup', 'Brandt', '524L', 'Filters, O-rings'],
    ['pickup', 'Greggs Distributors', 'FL207', 'Filters'],
    ['delivery', 'Texcan', 'RDSHP', 'Cable'],
    ['delivery', 'Lefort', 'BAL33', 'Cylinder parts']
  ];
  return {
    version: 1,
    items: examples.map(([kind, vendor, unit, description]) => ({
      id: crypto.randomUUID(), kind, date: '2026-11-06', vendor, unit, po: '',
      description, quantity: '', notes: '', status: 'scheduled',
      completedAt: null, createdAt: now, updatedAt: now, demo: true
    }))
  };
}

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(starterData(), null, 2), { flag: 'wx' });
}
let data;
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!Array.isArray(data.items)) throw Error('Invalid data format: items must be an array.');
} catch (err) {
  console.error('Could not open the whiteboard data. Existing data was NOT overwritten.', err);
  process.exit(1);
}
function saveData() {
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DATA_FILE);
}
function respond(res, status, payload, moreHeaders = {}) {
  const json = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...moreHeaders
  });
  res.end(json);
}
function getCookies(req) {
  const result = {};
  for (const piece of (req.headers.cookie || '').split(';')) {
    const pos = piece.indexOf('=');
    if (pos > 0) result[piece.slice(0, pos).trim()] = piece.slice(pos + 1).trim();
  }
  return result;
}
function isAuthorized(req) {
  if (MISSING_RAILWAY_PIN) return false;
  if (!ACCESS_CODE) return true; // Local development without an access code.
  const token = getCookies(req).secure_session;
  if (!token) return false;
  const until = sessions.get(token);
  if (!until || until < Date.now()) { sessions.delete(token); return false; }
  return true;
}
function requestJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', part => {
      size += part.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { statusCode: 413 }));
        req.destroy();
      } else chunks.push(part);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}
function field(value, length = 255) { return typeof value === 'string' ? value.trim().slice(0, length) : ''; }
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function normalizedItem(input, existing = {}) {
  const kind = field(input.kind, 20);
  const date = field(input.date, 10);
  const vendor = field(input.vendor, 120);
  const description = field(input.description, 350);
  const status = field(input.status, 20) || 'scheduled';
  if (!['pickup', 'delivery'].includes(kind)) throw Error('Choose pickup or delivery.');
  if (!validDate(date)) throw Error('Enter a valid date.');
  if (!vendor) throw Error('Vendor is required.');
  if (!description) throw Error('Parts expected is required.');
  if (!['scheduled', 'delayed', 'completed'].includes(status)) throw Error('Choose a valid status.');
  const now = dateTime();
  return {
    id: existing.id || crypto.randomUUID(),
    kind, date, vendor,
    po: field(input.po, 100), unit: field(input.unit, 100),
    description, quantity: field(input.quantity, 60),
    notes: field(input.notes, 1000), status,
    completedAt: status === 'completed' ? (existing.completedAt || now) : null,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    demo: existing.demo === true
  };
}
function sendSession(req, res) {
  respond(res, 200, {
    authenticated: isAuthorized(req),
    requiresPin: Boolean(ACCESS_CODE || MISSING_RAILWAY_PIN),
    configurationMissing: MISSING_RAILWAY_PIN
  });
}
function secureCookie(req, value, maxAge) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return `secure_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${proto === 'https' ? '; Secure' : ''}`;
}
async function api(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') return respond(res, 200, { ok: true });
  if (pathname === '/api/session' && req.method === 'GET') return sendSession(req, res);
  if (pathname === '/api/login' && req.method === 'POST') {
    if (MISSING_RAILWAY_PIN) return respond(res, 503, { error: 'Set SECURE_APP_PIN in Railway variables, then redeploy.' });
    if (!ACCESS_CODE) return respond(res, 400, { error: 'An access code has not been configured.' });
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded || req.socket.remoteAddress || 'unknown';
    const attempts = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (attempts.until > Date.now()) return respond(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const payload = await requestJson(req);
    const supplied = typeof payload.pin === 'string' ? payload.pin : '';
    const sameLength = Buffer.byteLength(supplied) === Buffer.byteLength(ACCESS_CODE);
    const allowed = sameLength && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(ACCESS_CODE));
    if (!allowed) {
      const count = attempts.count + 1;
      loginAttempts.set(ip, { count, until: count >= 8 ? Date.now() + 15 * 60 * 1000 : 0 });
      return respond(res, 401, { error: 'Incorrect access code.' });
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    return respond(res, 200, { ok: true }, { 'Set-Cookie': secureCookie(req, token, SESSION_TTL / 1000) });
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    sessions.delete(getCookies(req).secure_session);
    return respond(res, 200, { ok: true }, { 'Set-Cookie': secureCookie(req, '', 0) });
  }
  if (!isAuthorized(req)) return respond(res, 401, { error: 'Sign in to continue.' });
  if (pathname === '/api/meta' && req.method === 'GET') {
    return respond(res, 200, { protected: Boolean(ACCESS_CODE), dataDirectory: DATA_DIR, demoCount: data.items.filter(i => i.demo).length });
  }
  if (pathname === '/api/items' && req.method === 'GET') return respond(res, 200, { items: data.items });
  if (pathname === '/api/items' && req.method === 'POST') {
    const payload = await requestJson(req);
    let item;
    try { item = normalizedItem(payload); } catch (err) { return respond(res, 400, { error: err.message }); }
    data.items.push(item);
    saveData();
    return respond(res, 201, { item });
  }
  const match = pathname.match(/^\/api\/items\/([0-9a-f-]{36})$/i);
  if (match) {
    const index = data.items.findIndex(i => i.id === match[1]);
    if (index === -1) return respond(res, 404, { error: 'Entry not found.' });
    if (req.method === 'DELETE') {
      data.items.splice(index, 1);
      saveData();
      return respond(res, 200, { ok: true });
    }
    if (req.method === 'PUT') {
      const payload = await requestJson(req);
      let item;
      try { item = normalizedItem({ ...data.items[index], ...payload }, data.items[index]); }
      catch (err) { return respond(res, 400, { error: err.message }); }
      data.items[index] = item;
      saveData();
      return respond(res, 200, { item });
    }
  }
  if (pathname === '/api/clear-demo' && req.method === 'POST') {
    const before = data.items.length;
    data.items = data.items.filter(i => i.demo !== true);
    saveData();
    return respond(res, 200, { removed: before - data.items.length });
  }
  if (pathname === '/api/export' && req.method === 'GET') {
    return respond(res, 200, { app: 'SECURE Parts Whiteboard', exportedAt: dateTime(), items: data.items });
  }
  return respond(res, 404, { error: 'Unknown API request.' });
}
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/secure-logo.png', ['secure-logo.png', 'image/png']]
]);
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    if (!['GET', 'HEAD'].includes(req.method)) return respond(res, 405, { error: 'Method not allowed.' });
    const entry = files.get(pathname);
    if (!entry) return respond(res, 404, { error: 'Not found.' });
    const filename = path.join(__dirname, entry[0]);
    res.writeHead(200, {
      'Content-Type': entry[1], 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filename).pipe(res);
  } catch (err) {
    console.error('Request failed:', err);
    if (!res.headersSent) respond(res, err.statusCode || 500, { error: err.statusCode ? err.message : 'Server error.' });
    else res.end();
  }
});
server.listen(PORT, HOST, () => {
  console.log(`SECURE Parts Whiteboard running on ${HOST}:${PORT}`);
  console.log(`Data path: ${DATA_FILE}`);
  if (MISSING_RAILWAY_PIN) console.warn('SECURITY SETUP REQUIRED: Set SECURE_APP_PIN in Railway variables.');
  else if (!ACCESS_CODE) console.warn('No access code set: intended for local development only.');
});
