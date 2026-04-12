// db/database.js — Fixed & Production-Ready
'use strict';
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// Railway/Render: set DATA_DIR env var to a persistent volume mount path
// e.g. /var/data  — otherwise falls back to local ./data/
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DB_PATH  = path.join(DATA_DIR, 'wedding.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ─────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guestbook (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    location   TEXT,
    relation   TEXT DEFAULT 'Friend',
    message    TEXT NOT NULL,
    approved   INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rsvp (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    attendance TEXT NOT NULL,
    guest_of   TEXT,
    party_size INTEGER DEFAULT 1,
    dietary    TEXT,
    message    TEXT,
    barcode    TEXT UNIQUE,
    barcode_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS blessings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    location   TEXT,
    message    TEXT NOT NULL,
    visible    INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reactions (
    emoji      TEXT PRIMARY KEY,
    cnt        INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS viewers (
    sid        TEXT PRIMARY KEY,
    name       TEXT DEFAULT 'Guest',
    joined_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    left_at    DATETIME
  );

  CREATE TABLE IF NOT EXISTS chat (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guest_photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    filename   TEXT NOT NULL UNIQUE,
    original_name TEXT,
    mime_type  TEXT,
    size       INTEGER,
    caption    TEXT,
    approved   INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: Add guest_of column to existing rsvp table if it doesn't exist
try {
  const columns = db.prepare("PRAGMA table_info(rsvp)").all();
  const hasGuestOf = columns.some(col => col.name === 'guest_of');
  if (!hasGuestOf) {
    db.exec('ALTER TABLE rsvp ADD COLUMN guest_of TEXT');
    console.log('Migration: Added guest_of column to rsvp table');
  }
} catch (err) {
  console.log('Migration check:', err.message);
}

// Migration: Add barcode and barcode_sent columns to existing rsvp table
try {
  const columns = db.prepare("PRAGMA table_info(rsvp)").all();
  const hasBarcode = columns.some(col => col.name === 'barcode');
  const hasBarcodeSent = columns.some(col => col.name === 'barcode_sent');
  
  if (!hasBarcode) {
    db.exec('ALTER TABLE rsvp ADD COLUMN barcode TEXT UNIQUE');
    console.log('Migration: Added barcode column to rsvp table');
  }
  if (!hasBarcodeSent) {
    db.exec('ALTER TABLE rsvp ADD COLUMN barcode_sent INTEGER DEFAULT 0');
    console.log('Migration: Added barcode_sent column to rsvp table');
  }
  
  // Generate barcodes for existing RSVPs that don't have one
  const crypto = require('crypto');
  const rsvpsWithoutBarcode = db.prepare('SELECT id FROM rsvp WHERE barcode IS NULL').all();
  for (const rsvp of rsvpsWithoutBarcode) {
    const barcode = 'HL2026-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    try {
      db.prepare('UPDATE rsvp SET barcode = ? WHERE id = ?').run(barcode, rsvp.id);
    } catch (e) {
      // If duplicate, generate another
      const newBarcode = 'HL2026-' + crypto.randomBytes(8).toString('hex').toUpperCase();
      db.prepare('UPDATE rsvp SET barcode = ? WHERE id = ?').run(newBarcode, rsvp.id);
    }
  }
  if (rsvpsWithoutBarcode.length > 0) {
    console.log(`Migration: Generated barcodes for ${rsvpsWithoutBarcode.length} existing RSVPs`);
  }
} catch (err) {
  console.log('Migration check:', err.message);
}

// Migration: Add scanned_at column to track when barcode was scanned
try {
  const columns = db.prepare("PRAGMA table_info(rsvp)").all();
  const hasScannedAt = columns.some(col => col.name === 'scanned_at');
  
  if (!hasScannedAt) {
    db.exec('ALTER TABLE rsvp ADD COLUMN scanned_at DATETIME');
    console.log('Migration: Added scanned_at column to rsvp table');
  }
} catch (err) {
  console.log('Migration check:', err.message);
}

// Seed defaults
const seedSettings = [
  ['meet_link',       process.env.MEET_LINK || ''],
  ['stream_status',   'waiting'],
  ['stream_title',    'Hawau & Lukman — Wedding Day Live'],
  ['welcome_msg',     'Welcome! You are watching the wedding of Hawau & Lukman live. 🎉'],
  ['chat_open',       '1'],
  ['blessings_open',  '1'],
  ['rsvp_open',       '1'],
  // Email scheduling settings
  ['email_schedule_1',  '2026-04-15T12:00:00+01:00'],  // First email: April 15, 2026 at 12:00 PM WAT
  ['email_schedule_2',  '2026-04-18T10:00:00+01:00'],  // Reminder: April 18, 2026 at 10:00 AM WAT
  ['email_schedule_enabled', '1'],  // Auto email enabled by default
  ['email_1_sent',      '0'],  // Track if first email was sent
  ['email_2_sent',      '0'],  // Track if reminder email was sent
];
const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
for (const [k,v] of seedSettings) ins.run(k, v);

const seedReactions = ['❤️','🎉','🤲','😭','👏','🌹','✨','🕌'];
const insR = db.prepare('INSERT OR IGNORE INTO reactions(emoji,cnt) VALUES(?,0)');
for (const e of seedReactions) insR.run(e);

// ── QUERY HELPERS ──────────────────────────────────────────────────────────────────────
const Q = {
  // Settings
  get:    k       => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value,
  set:    (k,v)   => db.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)').run(k,v),
  allSettings: () => {
    const rows = db.prepare('SELECT key,value FROM settings').all();
    return Object.fromEntries(rows.map(r=>[r.key,r.value]));
  },

  // Guestbook
  gbAdd:   (name,email,loc,rel,msg) => db.prepare('INSERT INTO guestbook(name,email,location,relation,message) VALUES(?,?,?,?,?)').run(name,email,loc,rel,msg),
  gbGet:   (lim=30,off=0) => db.prepare('SELECT * FROM guestbook WHERE approved=1 ORDER BY created_at DESC LIMIT ? OFFSET ?').all(lim,off),
  gbCount: ()             => db.prepare('SELECT COUNT(*) as n FROM guestbook WHERE approved=1').get().n,
  gbAll:   ()             => db.prepare('SELECT * FROM guestbook ORDER BY created_at DESC').all(),
  gbDel:   id             => db.prepare('DELETE FROM guestbook WHERE id=?').run(id),
  gbApprove: id           => db.prepare('UPDATE guestbook SET approved=1 WHERE id=?').run(id),
  gbHide:  id             => db.prepare('UPDATE guestbook SET approved=0 WHERE id=?').run(id),
  gbResetAll: ()           => db.prepare('DELETE FROM guestbook').run(),

  // RSVP
  rsvpAdd:   (n,e,p,att,guest,sz,diet,msg,barcode) => db.prepare('INSERT INTO rsvp(name,email,phone,attendance,guest_of,party_size,dietary,message,barcode) VALUES(?,?,?,?,?,?,?,?,?)').run(n,e,p,att,guest,sz,diet,msg,barcode),
  rsvpAll:   ()  => db.prepare('SELECT * FROM rsvp ORDER BY created_at DESC').all(),
  rsvpStats: ()  => db.prepare("SELECT attendance, COUNT(*) as cnt, SUM(party_size) as ppl FROM rsvp GROUP BY attendance").all(),
  rsvpCount: ()  => db.prepare('SELECT COUNT(*) as n FROM rsvp').get().n,
  rsvpDel:   id  => db.prepare('DELETE FROM rsvp WHERE id=?').run(id),
  rsvpGetById: id => db.prepare('SELECT * FROM rsvp WHERE id=?').get(id),
  rsvpGetByBarcode: barcode => db.prepare('SELECT * FROM rsvp WHERE barcode=?').get(barcode),
  rsvpMarkBarcodeSent: id => db.prepare('UPDATE rsvp SET barcode_sent=1 WHERE id=?').run(id),
  rsvpWithEmails: () => db.prepare("SELECT * FROM rsvp WHERE email IS NOT NULL AND email != ''").all(),
  rsvpPhysicalWithEmails: () => db.prepare("SELECT * FROM rsvp WHERE email IS NOT NULL AND email != '' AND attendance = 'physical'").all(),
  
  rsvpFindByName: (name) => db.prepare('SELECT id FROM rsvp WHERE LOWER(name) = LOWER(?)').get(name),
  rsvpResetAll: () => db.prepare('DELETE FROM rsvp').run(),
  resetBarcodeSent: () => db.prepare('UPDATE rsvp SET barcode_sent = 0').run(),
  rsvpMarkScanned: (id) => db.prepare('UPDATE rsvp SET scanned_at = CURRENT_TIMESTAMP WHERE id = ?').run(id),

  // Blessings
  blessAdd:  (name,loc,msg) => db.prepare('INSERT INTO blessings(name,location,message) VALUES(?,?,?)').run(name,loc,msg),
  blessGet:  (lim=40)       => db.prepare('SELECT * FROM blessings WHERE visible=1 ORDER BY created_at DESC LIMIT ?').all(lim),
  blessAll:  ()              => db.prepare('SELECT * FROM blessings ORDER BY created_at DESC').all(),
  blessDel:  id              => db.prepare('DELETE FROM blessings WHERE id=?').run(id),
  blessResetAll: ()           => db.prepare('DELETE FROM blessings').run(),

  // Reactions
  reactBump: emoji => { db.prepare('UPDATE reactions SET cnt=cnt+1 WHERE emoji=?').run(emoji); return db.prepare('SELECT cnt FROM reactions WHERE emoji=?').get(emoji)?.cnt||0; },
  reactAll:  ()    => db.prepare('SELECT emoji,cnt FROM reactions').all(),

  // Viewers
  viewerJoin:   (sid,name) => db.prepare('INSERT OR REPLACE INTO viewers(sid,name) VALUES(?,?)').run(sid,name),
  viewerLeave:  sid        => db.prepare('UPDATE viewers SET left_at=CURRENT_TIMESTAMP WHERE sid=?').run(sid),
  viewerCount:  ()         => db.prepare('SELECT COUNT(*) as n FROM viewers WHERE left_at IS NULL').get().n,
  viewerNames:  ()         => db.prepare("SELECT name FROM viewers WHERE left_at IS NULL ORDER BY joined_at DESC LIMIT 30").all(),

  // Chat
  chatAdd:  (name,msg) => db.prepare('INSERT INTO chat(name,message) VALUES(?,?)').run(name,msg),
  chatRecent: (lim=60) => db.prepare('SELECT * FROM chat ORDER BY created_at DESC LIMIT ?').all(lim).reverse(),
  chatCount:  ()       => db.prepare('SELECT COUNT(*) as n FROM chat').get().n,

  // Guest Photos
  photoAdd:    (name, filename, originalName, mimeType, size, caption) => 
    db.prepare('INSERT INTO guest_photos(name, filename, original_name, mime_type, size, caption) VALUES(?,?,?,?,?,?)').run(name, filename, originalName, mimeType, size, caption),
  photoAll:    ()  => db.prepare('SELECT * FROM guest_photos ORDER BY created_at DESC').all(),
  photoGet:    (lim=50) => db.prepare('SELECT * FROM guest_photos WHERE approved=1 ORDER BY created_at DESC LIMIT ?').all(lim),
  photoCount:  ()  => db.prepare('SELECT COUNT(*) as n FROM guest_photos').get().n,
  photoDel:    id  => db.prepare('DELETE FROM guest_photos WHERE id=?').run(id),
  photoGetById: id => db.prepare('SELECT * FROM guest_photos WHERE id=?').get(id),
  photoApprove: id => db.prepare('UPDATE guest_photos SET approved=1 WHERE id=?').run(id),
  photoHide:   id  => db.prepare('UPDATE guest_photos SET approved=0 WHERE id=?').run(id),
  photoResetAll: () => db.prepare('DELETE FROM guest_photos').run(),
};

module.exports = { db, Q };


