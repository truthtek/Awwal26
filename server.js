// server.js — Hawau & Lukman Wedding Stream Server (Fixed & Production-Ready)
'use strict';
require('dotenv').config();

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const path         = require('path');
const crypto       = require('crypto');
const helmet       = require('helmet');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const multer       = require('multer');
const { v4: uuid } = require('uuid');
const fs           = require('fs');
const { Q }        = require('./db/database');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ── Ensure uploads directory exists ──────────────────────────────
const uploadsDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Security Headers ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'cdn.socket.io', 'cdnjs.cloudflare.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      frameSrc:   ["'self'", 'https://meet.google.com', 'https://*.google.com', 'https://www.youtube.com', 'https://youtube.com', 'https://www.youtube-nocookie.com', 'https://www.facebook.com', 'https://player.vimeo.com', 'https://vimeo.com', 'https://zoom.us', 'https://*.zoom.us', 'https://www.dailymotion.com', 'https://player.twitch.tv', 'https://twitch.tv'],
      imgSrc:     ["'self'", 'data:', 'blob:', '*'],
      connectSrc: ["'self'", 'ws:', 'wss:', '*'],
      mediaSrc:   ["'self'", '*'],
      scriptSrcAttr: ["'unsafe-inline'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
  noSniff: true,
  frameguard: { action: 'sameorigin' }
}));

// Additional security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ── CORS & Body Parser ───────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static Files ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
}));

// ── Helper Functions ──────────────────────────────────────────────
function sanitize(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function makeToken(username, password) {
  return crypto
    .createHash('sha256')
    .update(username + password)
    .digest('hex');
}

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const expected = makeToken(
    process.env.ADMIN_USERNAME || 'weddingadmin',
    process.env.ADMIN_PASSWORD || 'HawauLukman2026!'
  );
  if (token === expected) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Rate Limits ──────────────────────────────────────────────────
app.use('/api', rateLimit({ windowMs: 60000, max: 120, message: { error: 'Rate limit exceeded. Please wait a moment.' } }));
const postLimit  = rateLimit({ windowMs: 10 * 60000, max: 20, message: { error: 'Too many submissions. Please wait a few minutes.' } });
const reactLimit = rateLimit({ windowMs: 60000, max: 60 });
const loginLimit = rateLimit({
  windowMs: 15 * 60000, // 15 minutes
  max: 5,               // 5 attempts per 15 minutes
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── File Uploads ─────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => cb(null, uuid() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g,'_'))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
app.set('io', io);

// ═══════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════

app.get('/api/stream', (req, res) => {
  const s = Q.allSettings();
  res.json({
    meetLink:      s.meet_link      || '',
    status:        s.stream_status  || 'waiting',
    title:         s.stream_title,
    welcomeMsg:    s.welcome_msg,
    chatOpen:      s.chat_open      === '1',
    blessingsOpen: s.blessings_open === '1',
    rsvpOpen:      s.rsvp_open      === '1',
    viewerCount:   Q.viewerCount(),
    reactions:     Q.reactAll(),
  });
});

app.get('/api/guestbook', (req, res) => {
  const page  = Math.max(1, +req.query.page  || 1);
  const limit = Math.min(30, +req.query.limit || 10);
  const off   = (page - 1) * limit;
  const total = Q.gbCount();
  const pages = Math.max(1, Math.ceil(total / limit));
  res.json({ entries: Q.gbGet(limit, off), total, page, pages });
});
app.post('/api/guestbook', postLimit, (req, res) => {
  const { name, email='', location='', relation='Friend', message } = req.body;
  if (!name?.trim() || !message?.trim()) return res.status(400).json({ error: 'Name and message required' });
  if (message.length > 600) return res.status(400).json({ error: 'Message too long (max 600 characters)' });
  if (name.length > 80) return res.status(400).json({ error: 'Name too long (max 80 characters)' });

  const cleanName = sanitize(name.trim());
  const cleanEmail = email ? sanitize(email.trim()) : null;
  const cleanLoc = location ? sanitize(location.trim()) : null;
  const cleanRel = sanitize(relation || 'Friend');
  const cleanMsg = sanitize(message.trim());

  const r = Q.gbAdd(cleanName, cleanEmail, cleanLoc, cleanRel, cleanMsg);
  const entry = { id: r.lastInsertRowid, name: cleanName, location: cleanLoc, relation: cleanRel, message: cleanMsg, created_at: new Date().toISOString() };
  io.emit('guestbook:new', entry);
  res.json({ ok: true, entry });
});
app.post('/api/rsvp', postLimit, (req, res) => {
  const { name, email='', phone='', attendance, party_size=1, dietary='', message='' } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!attendance || !['physical','virtual','regrets'].includes(attendance))
    return res.status(400).json({ error: 'Please select how you will attend (In Person, Virtually, or Regrets)' });
  if (name.length > 80) return res.status(400).json({ error: 'Name too long (max 80 characters)' });

  const cleanName = sanitize(name.trim());
  const cleanEmail = email ? sanitize(email.trim()) : null;
  const cleanPhone = phone ? sanitize(phone.trim()) : null;
  const cleanDietary = dietary ? sanitize(dietary) : null;
  const cleanMessage = message ? sanitize(message) : null;

  
  const existing = Q.rsvpFindByName(cleanName);
  if (existing) {
    return res.status(409).json({ error: 'An RSVP with this name already exists. If you need to update your RSVP, please contact us via WhatsApp.' });
  }

  Q.rsvpAdd(cleanName, cleanEmail, cleanPhone, attendance, Math.min(20,+party_size||1), cleanDietary, cleanMessage);
  io.emit('rsvp:new', {});
  res.json({ ok: true });
});

app.get('/api/rsvp/stats', (req, res) => res.json({ stats: Q.rsvpStats(), total: Q.rsvpCount() }));
app.get('/api/blessings',  (req, res) => res.json({ blessings: Q.blessGet() }));
app.post('/api/blessings', postLimit, (req, res) => {
  const { name, location='', message } = req.body;
  if (!name?.trim() || !message?.trim()) return res.status(400).json({ error: 'Name and message required' });
  if (message.length > 300) return res.status(400).json({ error: 'Max 300 characters' });
  if (name.length > 40) return res.status(400).json({ error: 'Name too long (max 40 characters)' });

  const cleanName = sanitize(name.trim());
  const cleanLoc = location ? sanitize(location.trim()) : null;
  const cleanMsg = sanitize(message.trim());

  const r = Q.blessAdd(cleanName, cleanLoc, cleanMsg);
  const blessing = { id: r.lastInsertRowid, name: cleanName, location: cleanLoc, message: cleanMsg, created_at: new Date().toISOString() };
  io.emit('blessing:new', blessing);
  res.json({ ok: true, blessing });
});

app.get('/api/reactions', (req, res) => res.json({ reactions: Q.reactAll() }));

app.post('/api/reactions/:emoji', reactLimit, (req, res) => {
  const allowed = ['❤️','🎉','🤲','😭','👏','🌹','✨','🕌'];
  const emoji = decodeURIComponent(req.params.emoji);
  if (!allowed.includes(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
  const cnt = Q.reactBump(emoji);
  io.emit('reaction:bump', { emoji, cnt });
  res.json({ ok: true, emoji, cnt });
});

app.get('/api/chat', (req, res) => res.json({ messages: Q.chatRecent() }));

// ═══════════════════════════════════════════════════
//  ADMIN API
// ═══════════════════════════════════════════════════
app.post('/admin/login', loginLimit, (req, res) => {
  const { username, password } = req.body;
  const eu = process.env.ADMIN_USERNAME || 'weddingadmin';
  const ep = process.env.ADMIN_PASSWORD || 'HawauLukman2026!';
  if (username === eu && password === ep) {
    res.json({ ok: true, token: makeToken(username, password) });
  } else {
    setTimeout(() => res.status(401).json({ error: 'Invalid username or password' }), 800);
  }
});

app.get('/admin/check', requireAdmin, (req, res) => res.json({ ok: true }));

app.post('/admin/go-live', requireAdmin, (req, res) => {
  const { meetLink } = req.body;
  if (!meetLink) return res.status(400).json({ error: 'Please provide a stream link' });
  try { new URL(meetLink); } catch(e) { return res.status(400).json({ error: 'Please enter a valid URL' }); }
  Q.set('meet_link', meetLink);
  Q.set('stream_status', 'live');
  io.emit('stream:golive', { meetLink, status: 'live' });
  res.json({ ok: true, meetLink });
});

app.post('/admin/end-stream', requireAdmin, (req, res) => {
  Q.set('stream_status', 'ended');
  io.emit('stream:ended', {});
  res.json({ ok: true });
});

app.post('/admin/reset-stream', requireAdmin, (req, res) => {
  Q.set('stream_status', 'waiting');
  Q.set('meet_link', '');
  io.emit('stream:reset', {});
  res.json({ ok: true });
});

function handleSettings(req, res) {
  const allowed = ['meet_link','stream_status','stream_title','welcome_msg','chat_open','blessings_open','rsvp_open'];
  for (const [k,v] of Object.entries(req.body)) {
    if (allowed.includes(k)) Q.set(k, String(v));
  }
  const s = Q.allSettings();
  io.emit('settings:update', {
    meetLink: s.meet_link, status: s.stream_status, title: s.stream_title,
    welcomeMsg: s.welcome_msg, chatOpen: s.chat_open==='1', blessingsOpen: s.blessings_open==='1'
  });
  res.json({ ok: true, settings: s });
}
app.get('/admin/settings',  requireAdmin, (req, res) => res.json(Q.allSettings()));
app.put('/admin/settings',  requireAdmin, handleSettings);
app.post('/admin/settings', requireAdmin, handleSettings);

app.get('/admin/rsvp',          requireAdmin, (req, res) => res.json({ rsvps: Q.rsvpAll(), stats: Q.rsvpStats() }));
app.delete('/admin/rsvp/:id',   requireAdmin, (req, res) => { Q.rsvpDel(+req.params.id); res.json({ ok: true }); });

app.get('/admin/guestbook',             requireAdmin, (req, res) => res.json({ entries: Q.gbAll() }));
app.delete('/admin/guestbook/:id',      requireAdmin, (req, res) => { Q.gbDel(+req.params.id); res.json({ ok: true }); });
app.put('/admin/guestbook/:id/hide',    requireAdmin, (req, res) => { Q.gbHide(+req.params.id); res.json({ ok: true }); });
app.put('/admin/guestbook/:id/approve', requireAdmin, (req, res) => { Q.gbApprove(+req.params.id); res.json({ ok: true }); });

app.get('/admin/blessings',        requireAdmin, (req, res) => res.json({ blessings: Q.blessAll() }));
app.delete('/admin/blessings/:id', requireAdmin, (req, res) => { Q.blessDel(+req.params.id); res.json({ ok: true }); });

// Reset guest list data
app.post('/admin/reset-data', requireAdmin, (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).json({ error: 'Missing type parameter' });
  try {
    if (type === 'rsvp')       Q.rsvpResetAll();
    else if (type === 'guestbook')  Q.gbResetAll();
    else if (type === 'blessings')  Q.blessResetAll();
    else return res.status(400).json({ error: 'Invalid type. Use: rsvp, guestbook, or blessings' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Failed to reset data' }); }
});

app.get('/admin/analytics', requireAdmin, (req, res) => {
  res.json({
    viewers:   Q.viewerCount(),
    guestbook: Q.gbCount(),
    rsvp:      Q.rsvpCount(),
    blessings: Q.blessAll().length,
    reactions: Q.reactAll(),
    rsvpStats: Q.rsvpStats(),
    chatCount: Q.chatCount(),
  });
});

app.post('/admin/broadcast', requireAdmin, (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  io.emit('admin:broadcast', { message: sanitize(message.trim()), time: new Date().toISOString() });
  res.json({ ok: true });
});

app.post('/admin/gallery', requireAdmin, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ ok: true, filename: req.file.filename, caption: req.body.caption || '' });
});

// ═══════════════════════════════════════════════════
//  PAGE ROUTES (express.static handles / and /admin.html)
// ═══════════════════════════════════════════════════
app.get('/admin',   (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.get('/health',  (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/ping',    (req, res) => res.send('pong'));

// Custom 404 page
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public/404.html'), (err) => {
    if (err) {
      res.status(404).json({ error: 'Page not found', path: req.path });
    }
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ═══════════════════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════════════════
const chatRateMap = new Map();

io.on('connection', (socket) => {
  const name = sanitize((socket.handshake.query.name || 'Guest').slice(0, 40));
  Q.viewerJoin(socket.id, name);

  socket.emit('init', {
    viewerCount: Q.viewerCount(),
    reactions:   Q.reactAll(),
    blessings:   Q.blessGet(20),
    chatHistory: Q.chatRecent(40),
    settings: (() => {
      const s = Q.allSettings();
      return { meetLink: s.meet_link, status: s.stream_status, title: s.stream_title, welcomeMsg: s.welcome_msg, chatOpen: s.chat_open==='1', blessingsOpen: s.blessings_open==='1' };
    })(),
  });

  io.emit('viewer:count', Q.viewerCount());
  io.emit('viewer:joined', { name, count: Q.viewerCount() });

  
  socket.on('chat:send', (data) => {
    if (Q.get('chat_open') !== '1') return;
    const msg = sanitize(String(data.message || '').trim().slice(0, 280));
    const senderName = sanitize(String(data.name || 'Guest').trim().slice(0, 40));
    if (!msg || !senderName) return;
    const now = Date.now(), last = chatRateMap.get(socket.id) || 0;
    if (now - last < 2000) return;
    chatRateMap.set(socket.id, now);
    const r = Q.chatAdd(senderName, msg);
    io.emit('chat:message', { id: r.lastInsertRowid, name: senderName, message: msg, created_at: new Date().toISOString() });
  });

  socket.on('reaction', (emoji) => {
    const allowed = ['❤️','🎉','🤲','😭','👏','🌹','✨','🕌'];
    if (!allowed.includes(emoji)) return;
    const cnt = Q.reactBump(emoji);
    io.emit('reaction:bump', { emoji, cnt });
  });

  socket.on('disconnect', () => {
    Q.viewerLeave(socket.id);
    chatRateMap.delete(socket.id);
    io.emit('viewer:count', Q.viewerCount());
  });
});

// ═══════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════
server.listen(PORT, () => {
  console.log('\n✨ Hawau & Lukman Wedding Stream → http://localhost:' + PORT);
  console.log('🔐 Admin panel → http://localhost:' + PORT + '/admin');
  console.log('📅 Wedding: 19 April 2026\n');

  // Keep-alive: ping self every 14 minutes to prevent Render free tier cold starts
  if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
    const keepAliveUrl = process.env.RENDER_EXTERNAL_URL + '/ping';
    setInterval(() => {
      require('https').get(keepAliveUrl, r => {
        console.log('Keep-alive ping:', r.statusCode);
      }).on('error', () => {});
    }, 14 * 60 * 1000);
    console.log('⏰ Keep-alive enabled →', keepAliveUrl);
  }
});

module.exports = { app, io };
