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
const QRCode       = require('qrcode');
const { Q, db }   = require('./db/database');

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
      scriptSrc:  ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'cdn.socket.io', 'cdnjs.cloudflare.com', 'https://unpkg.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      frameSrc:   ["'self'", 'https://meet.google.com', 'https://*.google.com', 'https://www.youtube.com', 'https://youtube.com', 'https://www.youtube-nocookie.com', 'https://www.facebook.com', 'https://player.vimeo.com', 'https://vimeo.com', 'https://zoom.us', 'https://*.zoom.us', 'https://www.dailymotion.com', 'https://player.twitch.tv', 'https://twitch.tv'],
      imgSrc:     ["'self'", 'data:', 'blob:', '*'],
      connectSrc: ["'self'", 'ws:', 'wss:', '*'],
      mediaSrc:   ["'self'", 'blob:', '*'],
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

// Additional security headers - Allow camera for verify page and photo capture
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Allow camera access for the verify page and main page (for photo capture)
  if (req.path === '/verify' || req.path === '/' || req.path === '/index.html') {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  } else {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  }
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
  // Check RSVP deadline (April 17, 2026 at 11:59 PM WAT)
  const deadline = new Date('2026-04-17T23:59:59+01:00');
  const now = new Date();
  if (now > deadline) {
    return res.status(403).json({ error: 'RSVP deadline has passed. RSVP closed on April 17, 2026 at 11:59 PM.' });
  }

  const { name, email='', phone='', attendance, guest_of='', party_size=1, dietary='', message='' } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!attendance || !['physical','virtual','regrets'].includes(attendance))
    return res.status(400).json({ error: 'Please select how you will attend (In Person, Virtually, or Regrets)' });
  if (name.length > 80) return res.status(400).json({ error: 'Name too long (max 80 characters)' });

  const cleanName = sanitize(name.trim());
  const cleanEmail = email ? sanitize(email.trim()) : null;
  const cleanPhone = phone ? sanitize(phone.trim()) : null;
  const cleanGuestOf = guest_of ? sanitize(guest_of) : null;
  const cleanDietary = dietary ? sanitize(dietary) : null;
  const cleanMessage = message ? sanitize(message) : null;

  
  const existing = Q.rsvpFindByName(cleanName);
  if (existing) {
    return res.status(409).json({ error: 'An RSVP with this name already exists. If you need to update your RSVP, please contact us via WhatsApp.' });
  }

  // Generate unique barcode
  const barcode = 'HL2026-' + crypto.randomBytes(6).toString('hex').toUpperCase();

  Q.rsvpAdd(cleanName, cleanEmail, cleanPhone, attendance, cleanGuestOf, Math.min(20,+party_size||1), cleanDietary, cleanMessage, barcode);
  io.emit('rsvp:new', {});
  res.json({ ok: true, barcode });
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

// RSVP deadline status
app.get('/api/rsvp/status', (req, res) => {
  const deadline = new Date('2026-04-17T23:59:59+01:00');
  const now = new Date();
  const isOpen = now <= deadline;
  res.json({ 
    isOpen, 
    deadline: deadline.toISOString(),
    deadlineFormatted: 'April 17, 2026 at 11:59 PM WAT'
  });
});

// Barcode verification (for /verify page)
app.get('/api/verify/:barcode', (req, res) => {
  const barcode = req.params.barcode?.trim().toUpperCase();
  if (!barcode || !barcode.startsWith('HL2026-')) {
    return res.status(400).json({ valid: false, error: 'Invalid barcode format' });
  }
  
  const rsvp = Q.rsvpGetByBarcode(barcode);
  if (!rsvp) {
    return res.status(404).json({ valid: false, error: 'Barcode not found' });
  }
  
  // Check if already scanned
  const alreadyScanned = rsvp.scanned_at !== null;
  
  // Mark as scanned if this is the first scan
  if (!alreadyScanned) {
    Q.rsvpMarkScanned(rsvp.id);
  }
  
  // Return guest details with scan status
  res.json({
    valid: true,
    alreadyScanned: alreadyScanned,
    scannedAt: rsvp.scanned_at,
    guest: {
      name: rsvp.name,
      email: rsvp.email,
      phone: rsvp.phone,
      attendance: rsvp.attendance,
      guest_of: rsvp.guest_of,
      party_size: rsvp.party_size,
      dietary: rsvp.dietary,
      registered_at: rsvp.created_at
    }
  });
});

// Generate QR code image for a barcode
app.get('/api/qrcode/:barcode', async (req, res) => {
  const barcode = req.params.barcode?.trim().toUpperCase();
  if (!barcode || !barcode.startsWith('HL2026-')) {
    return res.status(400).send('Invalid barcode format');
  }
  
  try {
    const qrDataUrl = await QRCode.toDataURL(barcode, {
      width: 300,
      margin: 2,
      color: {
        dark: '#0C1A0E',
        light: '#FFFFFF'
      }
    });
    
    // Convert data URL to buffer
    const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(500).send('Error generating QR code');
  }
});

// ═══════════════════════════════════════════════════
//  GUEST PHOTOS API
// ═══════════════════════════════════════════════════

// Guest photo upload storage
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const photosDir = path.join(__dirname, 'public/uploads/guest-photos');
    if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });
    cb(null, photosDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'guest_' + Date.now() + '_' + uuid().substring(0, 8) + ext);
  }
});
const photoUpload = multer({ 
  storage: photoStorage, 
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and videos are allowed.'), false);
    }
  }
});

// Upload a guest photo/video
app.post('/api/guest-photos', postLimit, photoUpload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const name = sanitize((req.body.name || 'Guest').trim()).substring(0, 100);
  const caption = req.body.caption ? sanitize(req.body.caption.trim()).substring(0, 500) : null;
  
  try {
    Q.photoAdd(name, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, caption);
    
    // Notify admin via socket
    io.emit('photo:new', {
      id: Q.photoCount(),
      name,
      filename: req.file.filename,
      caption,
      created_at: new Date().toISOString()
    });
    
    res.json({ 
      ok: true, 
      message: 'Photo uploaded successfully! Thank you for sharing your memory.',
      filename: req.file.filename 
    });
  } catch (err) {
    console.error('Photo upload error:', err);
    // Delete the uploaded file if database insert fails
    fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Failed to save photo' });
  }
});

// Get approved photos (public)
app.get('/api/guest-photos', (req, res) => {
  const limit = Math.min(100, +req.query.limit || 50);
  const photos = Q.photoGet(limit);
  res.json({ photos, total: Q.photoCount() });
});

// Get all photos (admin only)
app.get('/admin/guest-photos', requireAdmin, (req, res) => {
  const photos = Q.photoAll();
  res.json({ photos, total: photos.length });
});

// Delete a photo (admin only)
app.delete('/admin/guest-photos/:id', requireAdmin, (req, res) => {
  const photo = Q.photoGetById(+req.params.id);
  if (!photo) {
    return res.status(404).json({ error: 'Photo not found' });
  }
  
  // Delete file from disk
  const filePath = path.join(__dirname, 'public/uploads/guest-photos', photo.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  
  Q.photoDel(+req.params.id);
  res.json({ ok: true });
});

// Toggle photo approval (admin only)
app.post('/admin/guest-photos/:id/toggle', requireAdmin, (req, res) => {
  const photo = Q.photoGetById(+req.params.id);
  if (!photo) {
    return res.status(404).json({ error: 'Photo not found' });
  }
  
  if (photo.approved) {
    Q.photoHide(+req.params.id);
  } else {
    Q.photoApprove(+req.params.id);
  }
  
  res.json({ ok: true, approved: !photo.approved });
});

// Download all photos as ZIP (admin only)
app.get('/admin/guest-photos/download', requireAdmin, async (req, res) => {
  const archiver = require('archiver');
  const photos = Q.photoAll();
  
  if (photos.length === 0) {
    return res.status(404).json({ error: 'No photos to download' });
  }
  
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="wedding-memories-${Date.now()}.zip"`);
  
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  
  for (const photo of photos) {
    const filePath = path.join(__dirname, 'public/uploads/guest-photos', photo.filename);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: `${photo.created_at.split(' ')[0]}_${photo.name}_${photo.filename}` });
    }
  }
  
  archive.finalize();
});

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

// Send barcode emails to physical attendees only
app.post('/admin/send-barcodes', requireAdmin, async (req, res) => {
  // Only send to guests who are attending physically (in person)
  const rsvpsWithEmails = Q.rsvpPhysicalWithEmails();
  
  if (rsvpsWithEmails.length === 0) {
    return res.json({ ok: true, sent: 0, message: 'No physical attendees with email addresses found. Barcodes are only sent to guests attending in person.' });
  }

  // Email configuration - uses environment variables
  const emailConfig = {
    service: process.env.EMAIL_SERVICE || 'gmail',
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  };

  if (!emailConfig.user || !emailConfig.pass) {
    return res.status(500).json({ error: 'Email not configured. Set EMAIL_USER and EMAIL_PASS environment variables.' });
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (e) {
    return res.status(500).json({ error: 'Nodemailer not installed. Run: npm install nodemailer' });
  }

  const transporter = nodemailer.createTransport({
    service: emailConfig.service,
    auth: {
      user: emailConfig.user,
      pass: emailConfig.pass
    }
  });

  let sent = 0;
  let failed = 0;
  const results = [];

  for (const rsvp of rsvpsWithEmails) {
    if (!rsvp.email || rsvp.barcode_sent) continue;

    // Skip if no barcode
    if (!rsvp.barcode) {
      console.error('No barcode for RSVP:', rsvp.id, rsvp.name);
      continue;
    }

    const guestOfText = rsvp.guest_of === 'bride' ? "Guest of Bride" : 
                        rsvp.guest_of === 'groom' ? "Guest of Groom" : 
                        rsvp.guest_of === 'both' ? "Guest of Both" : "";

    // Get the server's public URL for hosted QR code image
    const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const qrCodeUrl = `${serverUrl}/api/qrcode/${rsvp.barcode}`;
    
    console.log(`Sending email to ${rsvp.email} with QR URL: ${qrCodeUrl}`);

    const mailOptions = {
      from: `"Hawau & Lukman Wedding" <${emailConfig.user}>`,
      to: rsvp.email,
      subject: 'Your Wedding Invitation Barcode - Hawau & Lukman 2026',
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0C1A0E; border-radius: 12px; border: 1px solid #B8922C;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="font-family: 'Great Vibes', cursive, serif; color: #EFC060; font-size: 2.5rem; margin: 0;">Hawau & Lukman</h1>
            <p style="color: #3DD4C8; font-size: 0.9rem; letter-spacing: 2px;">WEDDING CELEBRATION • 19 APRIL 2026</p>
          </div>
          
          <div style="background: rgba(255,255,255,0.05); padding: 25px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #EFC060; font-size: 1.1rem; margin-top: 0;">Dear ${rsvp.name},</h2>
            <p style="color: #FDFAF2; line-height: 1.8;">Assalamu alaikum! Thank you for your RSVP. Your unique QR code for the wedding celebration is below:</p>
            
            <div style="text-align: center; padding: 25px; background: #fff; border-radius: 8px; margin: 20px 0;">
              <img src="${qrCodeUrl}" alt="QR Code" style="width: 200px; height: 200px; display: block; margin: 0 auto;" />
              <p style="font-family: 'Courier New', monospace; font-size: 1.3rem; font-weight: bold; color: #0C1A0E; margin: 15px 0 5px; letter-spacing: 2px;">${rsvp.barcode}</p>
              <p style="color: #666; font-size: 0.75rem;">Scan this QR code at the venue entrance</p>
            </div>
            
            <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-top: 20px;">
              <h3 style="color: #3DD4C8; font-size: 0.9rem; margin-top: 0;">Your Registration Details:</h3>
              <p style="color: #FDFAF2; margin: 8px 0;"><strong>Attendance:</strong> ${rsvp.attendance === 'physical' ? 'In Person' : rsvp.attendance === 'virtual' ? 'Virtual' : 'Regrets'}</p>
              ${guestOfText ? `<p style="color: #FDFAF2; margin: 8px 0;"><strong>Guest Of:</strong> ${guestOfText}</p>` : ''}
              <p style="color: #FDFAF2; margin: 8px 0;"><strong>Party Size:</strong> ${rsvp.party_size} ${rsvp.party_size > 1 ? 'guests' : 'guest'}</p>
              ${rsvp.dietary ? `<p style="color: #FDFAF2; margin: 8px 0;"><strong>Dietary Notes:</strong> ${rsvp.dietary}</p>` : ''}
            </div>
          </div>
          
          <div style="background: rgba(15,122,106,0.2); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #EFC060; font-size: 1rem; margin-top: 0;">📍 Event Details</h3>
            <p style="color: #FDFAF2; margin: 8px 0;"><strong>Date:</strong> Sunday, 19 April 2026</p>
            <p style="color: #FDFAF2; margin: 8px 0;"><strong>Engagement:</strong> 11:00 AM WAT</p>
            <p style="color: #FDFAF2; margin: 8px 0;"><strong>Nikkah:</strong> 1:00 PM WAT</p>
            <p style="color: #FDFAF2; margin: 8px 0;"><strong>Venue:</strong> Marque Event Centre, 22 Town Planning Way, Ilupeju, Lagos</p>
            <p style="color: #FDFAF2; margin: 8px 0;"><strong>Dress Code:</strong> White & Green</p>
          </div>
          
          <p style="color: #FDFAF2; text-align: center; line-height: 1.8;">Please present this QR code at the venue entrance. We look forward to celebrating with you!</p>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(184,146,44,0.3);">
            <p style="color: #3DD4C8; font-size: 0.85rem;">#HawauAndLukman2026</p>
            <p style="color: rgba(253,250,242,0.5); font-size: 0.75rem;">Questions? Contact: +234 802 319 3526 (Bride) | +234 706 095 7637 (Groom)</p>
          </div>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      Q.rsvpMarkBarcodeSent(rsvp.id);
      sent++;
      results.push({ email: rsvp.email, name: rsvp.name, status: 'sent' });
    } catch (e) {
      failed++;
      results.push({ email: rsvp.email, name: rsvp.name, status: 'failed', error: e.message });
    }
  }

  res.json({ 
    ok: true, 
    sent, 
    failed, 
    total: rsvpsWithEmails.length,
    results 
  });
});

// Get RSVPs with barcode info
app.get('/admin/rsvp/barcodes', requireAdmin, (req, res) => {
  const rsvps = Q.rsvpAll();
  res.json({ rsvps });
});

// Reset barcode_sent flags to allow resending emails
app.post('/admin/reset-barcode-sent', requireAdmin, (req, res) => {
  try {
    const result = Q.resetBarcodeSent();
    res.json({ ok: true, reset: result.changes });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reset barcode_sent flags' });
  }
});

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
    photos:    Q.photoCount(),
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
//  EMAIL SCHEDULING API
// ═══════════════════════════════════════════════════

// Get email schedule settings
app.get('/admin/email-schedule', requireAdmin, (req, res) => {
  res.json({
    schedule1: Q.get('email_schedule_1') || '2026-04-15T12:00:00+01:00',
    schedule2: Q.get('email_schedule_2') || '2026-04-18T10:00:00+01:00',
    enabled: Q.get('email_schedule_enabled') === '1',
    email1Sent: Q.get('email_1_sent') === '1',
    email2Sent: Q.get('email_2_sent') === '1',
  });
});

// Update email schedule settings
app.post('/admin/email-schedule', requireAdmin, (req, res) => {
  const { schedule1, schedule2, enabled } = req.body;
  
  if (schedule1) {
    try {
      const date = new Date(schedule1);
      if (isNaN(date.getTime())) throw new Error('Invalid date');
      Q.set('email_schedule_1', schedule1);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid schedule 1 date format' });
    }
  }
  
  if (schedule2) {
    try {
      const date = new Date(schedule2);
      if (isNaN(date.getTime())) throw new Error('Invalid date');
      Q.set('email_schedule_2', schedule2);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid schedule 2 date format' });
    }
  }
  
  if (typeof enabled === 'boolean') {
    Q.set('email_schedule_enabled', enabled ? '1' : '0');
  }
  
  res.json({ 
    ok: true, 
    schedule: {
      schedule1: Q.get('email_schedule_1'),
      schedule2: Q.get('email_schedule_2'),
      enabled: Q.get('email_schedule_enabled') === '1',
    }
  });
});

// Reset email sent flags (to allow resending)
app.post('/admin/reset-email-sent', requireAdmin, (req, res) => {
  const { emailNum } = req.body; // 1 or 2
  if (emailNum === 1) {
    Q.set('email_1_sent', '0');
  } else if (emailNum === 2) {
    Q.set('email_2_sent', '0');
  } else {
    return res.status(400).json({ error: 'Invalid emailNum. Use 1 or 2' });
  }
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════
//  GUEST CHECKLIST API
// ═══════════════════════════════════════════════════

// Get all RSVPs with check-in status for verify page
app.get('/api/guest-checklist', (req, res) => {
  const rsvps = Q.rsvpAll();
  const checklist = rsvps.map(r => ({
    id: r.id,
    name: r.name,
    barcode: r.barcode,
    attendance: r.attendance,
    guest_of: r.guest_of,
    party_size: r.party_size,
    checkedIn: r.scanned_at !== null,
    scannedAt: r.scanned_at,
  }));
  
  const stats = {
    total: rsvps.length,
    checkedIn: rsvps.filter(r => r.scanned_at !== null).length,
    physical: rsvps.filter(r => r.attendance === 'physical').length,
    virtual: rsvps.filter(r => r.attendance === 'virtual').length,
    regrets: rsvps.filter(r => r.attendance === 'regrets').length,
  };
  
  res.json({ checklist, stats });
});

// ═══════════════════════════════════════════════════
//  ADMIN RSVP IMPORT API
// ═══════════════════════════════════════════════════

// Import RSVP data from admin panel
app.post('/admin/import-rsvps', requireAdmin, (req, res) => {
  const { rsvps } = req.body;
  
  if (!rsvps || !Array.isArray(rsvps) || rsvps.length === 0) {
    return res.status(400).json({ error: 'No RSVP data provided' });
  }
  
  let imported = 0;
  let errors = 0;
  const results = [];
  
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO rsvp (name, email, phone, attendance, guest_of, barcode, party_size, dietary, message, barcode_sent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  for (const rsvp of rsvps) {
    try {
      // Validate required fields
      if (!rsvp.name || !rsvp.attendance) {
        errors++;
        results.push({ name: rsvp.name || 'Unknown', status: 'error', error: 'Missing required fields' });
        continue;
      }
      
      // Validate attendance
      if (!['physical', 'virtual', 'regrets'].includes(rsvp.attendance)) {
        errors++;
        results.push({ name: rsvp.name, status: 'error', error: 'Invalid attendance value' });
        continue;
      }
      
      // Generate barcode if not provided
      const barcode = rsvp.barcode || 'HL2026-' + crypto.randomBytes(6).toString('hex').toUpperCase();
      
      insertStmt.run(
        sanitize(rsvp.name),
        rsvp.email ? sanitize(rsvp.email) : null,
        rsvp.phone ? sanitize(rsvp.phone) : null,
        rsvp.attendance,
        rsvp.guest_of || null,
        barcode,
        Math.min(20, parseInt(rsvp.party_size) || 1),
        rsvp.dietary ? sanitize(rsvp.dietary) : null,
        rsvp.message ? sanitize(rsvp.message) : null,
        rsvp.barcode_sent ? 1 : 0,
        rsvp.created_at || new Date().toISOString()
      );
      
      imported++;
      results.push({ name: rsvp.name, status: 'imported', barcode: barcode });
      
    } catch (err) {
      errors++;
      results.push({ name: rsvp.name, status: 'error', error: err.message });
    }
  }
  
  // Notify connected clients
  io.emit('rsvp:new', {});
  
  res.json({ 
    ok: true, 
    imported, 
    errors, 
    total: rsvps.length,
    results: results.slice(0, 50) // Limit results to prevent large responses
  });
});

// ═══════════════════════════════════════════════════
//  PAGE ROUTES (express.static handles / and /admin.html)
// ═══════════════════════════════════════════════════
app.get('/admin',   (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.get('/verify',  (req, res) => res.sendFile(path.join(__dirname, 'public/verify.html')));
app.get('/import-rsvp-data', (req, res) => res.sendFile(path.join(__dirname, 'public/import-rsvp-data.html')));
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
//  EMAIL SCHEDULER
// ═══════════════════════════════════════════════════

// Helper function to send scheduled emails
async function sendScheduledEmails(emailNum) {
  // Only send to guests who are attending physically and have email
  const rsvpsWithEmails = Q.rsvpPhysicalWithEmails();
  
  if (rsvpsWithEmails.length === 0) {
    console.log(`Scheduled email ${emailNum}: No physical attendees with emails`);
    return { sent: 0, failed: 0 };
  }

  const emailConfig = {
    service: process.env.EMAIL_SERVICE || 'gmail',
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  };

  if (!emailConfig.user || !emailConfig.pass) {
    console.log('Email not configured. Set EMAIL_USER and EMAIL_PASS environment variables.');
    return { sent: 0, failed: 0, error: 'Email not configured' };
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (e) {
    console.log('Nodemailer not installed');
    return { sent: 0, failed: 0, error: 'Nodemailer not installed' };
  }

  const transporter = nodemailer.createTransport({
    service: emailConfig.service,
    auth: { user: emailConfig.user, pass: emailConfig.pass }
  });

  let sent = 0;
  let failed = 0;
  const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const isFirstEmail = emailNum === 1;
  const subject = isFirstEmail 
    ? 'Your Wedding Invitation Barcode - Hawau & Lukman 2026'
    : 'Reminder: Your Wedding Barcode - Hawau & Lukman 2026 (Tomorrow!)';

  for (const rsvp of rsvpsWithEmails) {
    // For first email, skip if already sent
    // For reminder, skip if already sent this reminder
    if (isFirstEmail && rsvp.barcode_sent) continue;
    if (!rsvp.barcode) continue;

    const guestOfText = rsvp.guest_of === 'bride' ? "Guest of Bride" : 
                        rsvp.guest_of === 'groom' ? "Guest of Groom" : 
                        rsvp.guest_of === 'both' ? "Guest of Both" : "";
    const qrCodeUrl = `${serverUrl}/api/qrcode/${rsvp.barcode}`;

    const mailOptions = {
      from: `"Hawau & Lukman Wedding" <${emailConfig.user}>`,
      to: rsvp.email,
      subject: subject,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0C1A0E; border-radius: 12px; border: 1px solid #B8922C;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="font-family: 'Great Vibes', cursive, serif; color: #EFC060; font-size: 2.5rem; margin: 0;">Hawau & Lukman</h1>
            <p style="color: #3DD4C8; font-size: 0.9rem; letter-spacing: 2px;">WEDDING CELEBRATION • 19 APRIL 2026</p>
            ${!isFirstEmail ? '<p style="color: #EFC060; font-size: 1rem; margin-top: 10px;">⏰ REMINDER: Wedding is Tomorrow!</p>' : ''}
          </div>
          
          <div style="background: rgba(255,255,255,0.05); padding: 25px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #EFC060; font-size: 1.1rem; margin-top: 0;">Dear ${rsvp.name},</h2>
            <p style="color: #FDFAF2; line-height: 1.8;">${isFirstEmail 
              ? "Assalamu alaikum! Thank you for your RSVP. Your unique QR code for the wedding celebration is below:" 
              : "This is a friendly reminder that the wedding is tomorrow! Please remember to bring your QR code for entry:"}</p>
            
            <div style="text-align: center; padding: 25px; background: #fff; border-radius: 8px; margin: 20px 0;">
              <img src="${qrCodeUrl}" alt="QR Code" style="width: 200px; height: 200px; display: block; margin: 0 auto;" />
              <p style="font-family: 'Courier New', monospace; font-size: 1.3rem; font-weight: bold; color: #0C1A0E; margin: 15px 0 5px; letter-spacing: 2px;">${rsvp.barcode}</p>
              <p style="color: #666; font-size: 0.75rem;">Scan this QR code at the venue entrance</p>
            </div>
            
            <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-top: 20px;">
              <h3 style="color: #3DD4C8; font-size: 0.9rem; margin-top: 0;">Your Registration Details:</h3>
              <p style="color: #FDFAF2; margin: 8px 0;"><strong>Attendance:</strong> ${rsvp.attendance === 'physical' ? 'In Person' : rsvp.attendance === 'virtual' ? 'Virtual' : 'Regrets'}</p>
              ${guestOfText ? `<p style="color: #FDFAF2; margin: 8px 0;"><strong>Guest Of:</strong> ${guestOfText}</p>` : ''}
              <p style="color: #FDFAF2; margin: 8px 0;"><strong>Party Size:</strong> ${rsvp.party_size} ${rsvp.party_size > 1 ? 'guests' : 'guest'}</p>
              ${rsvp.dietary ? `<p style="color: #FDFAF2; margin: 8px 0;"><strong>Dietary Notes:</strong> ${rsvp.dietary}</p>` : ''}
            </div>
          </div>
          
          <div style="background: rgba(15,122,106,0.2); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #EFC060; font-size: 1rem; margin-top: 0;">📍 Event Details</h3>
            <p style="color: #FDFAF2; margin: 8px 0;"><strong>Date:</strong> Sunday, 19 April 2026</p>
            <p style="color: #FDFAF2; margin: 8px 0;"><strong>Engagement:</strong> 11:00 AM WAT</p>
            <p style="color: #FDFAF2; margin: 8px 0;"><strong>Nikkah:</strong> 1:00 PM WAT</p>
            <p style="color: #FDFAF2; margin: 8px 0;"><strong>Venue:</strong> Marque Event Centre, 22 Town Planning Way, Ilupeju, Lagos</p>
            <p style="color: #FDFAF2; margin: 8px 0;"><strong>Dress Code:</strong> White & Green</p>
          </div>
          
          <p style="color: #FDFAF2; text-align: center; line-height: 1.8;">Please present this QR code at the venue entrance. We look forward to celebrating with you!</p>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(184,146,44,0.3);">
            <p style="color: #3DD4C8; font-size: 0.85rem;">#HawauAndLukman2026</p>
            <p style="color: rgba(253,250,242,0.5); font-size: 0.75rem;">Questions? Contact: +234 802 319 3526 (Bride) | +234 706 095 7637 (Groom)</p>
          </div>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      if (isFirstEmail) {
        Q.rsvpMarkBarcodeSent(rsvp.id);
      }
      sent++;
    } catch (e) {
      console.error(`Failed to send email to ${rsvp.email}:`, e.message);
      failed++;
    }
  }

  console.log(`Scheduled email ${emailNum} completed: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}

// Check for scheduled emails every minute
setInterval(async () => {
  const enabled = Q.get('email_schedule_enabled') === '1';
  if (!enabled) return;

  const now = new Date();
  
  // Check first scheduled email
  const schedule1 = Q.get('email_schedule_1');
  const email1Sent = Q.get('email_1_sent') === '1';
  if (schedule1 && !email1Sent) {
    const scheduleDate = new Date(schedule1);
    if (now >= scheduleDate) {
      console.log('⏰ Triggering scheduled email 1...');
      const result = await sendScheduledEmails(1);
      Q.set('email_1_sent', '1');
      Q.set('email_1_sent_at', now.toISOString());
      console.log('Scheduled email 1 result:', result);
    }
  }
  
  // Check second scheduled email (reminder)
  const schedule2 = Q.get('email_schedule_2');
  const email2Sent = Q.get('email_2_sent') === '1';
  if (schedule2 && !email2Sent) {
    const scheduleDate = new Date(schedule2);
    if (now >= scheduleDate) {
      console.log('⏰ Triggering scheduled email 2 (reminder)...');
      const result = await sendScheduledEmails(2);
      Q.set('email_2_sent', '1');
      Q.set('email_2_sent_at', now.toISOString());
      console.log('Scheduled email 2 result:', result);
    }
  }
}, 60 * 1000); // Check every minute

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
