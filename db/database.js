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
    party_size INTEGER DEFAULT 1,
    dietary    TEXT,
    message    TEXT,
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
`);

// Seed defaults
const seedSettings = [
  ['meet_link',       process.env.MEET_LINK || ''],
  ['stream_status',   'waiting'],
  ['stream_title',    'Hawau & Lukman — Wedding Day Live'],
  ['welcome_msg',     'Welcome! You are watching the wedding of Hawau & Lukman live. 🎉'],
  ['chat_open',       '1'],
  ['blessings_open',  '1'],
  ['rsvp_open',       '1'],
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
  rsvpAdd:   (n,e,p,att,sz,diet,msg) => db.prepare('INSERT INTO rsvp(name,email,phone,attendance,party_size,dietary,message) VALUES(?,?,?,?,?,?,?)').run(n,e,p,att,sz,diet,msg),
  rsvpAll:   ()  => db.prepare('SELECT * FROM rsvp ORDER BY created_at DESC').all(),
  rsvpStats: ()  => db.prepare("SELECT attendance, COUNT(*) as cnt, SUM(party_size) as ppl FROM rsvp GROUP BY attendance").all(),
  rsvpCount: ()  => db.prepare('SELECT COUNT(*) as n FROM rsvp').get().n,
  rsvpDel:   id  => db.prepare('DELETE FROM rsvp WHERE id=?').run(id),
  
  rsvpFindByName: (name) => db.prepare('SELECT id FROM rsvp WHERE LOWER(name) = LOWER(?)').get(name),
  rsvpResetAll: () => db.prepare('DELETE FROM rsvp').run(),

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
};

module.exports = { db, Q };


