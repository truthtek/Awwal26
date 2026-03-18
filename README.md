# 💍 Hawau & Lukman — Wedding Streaming Platform

A complete full-stack wedding streaming website built with Node.js, Express, Socket.io, and SQLite.

---

## 🌟 Features

### Public Website (`/`)
- **Live Stream** — Google Meet embedded directly; stream activates automatically when admin goes live
- **Real-time Live Chat** — Socket.io powered chat visible to all viewers simultaneously
- **Reaction System** — 8 emoji reactions with floating animations & live counts
- **Live Viewer Counter** — Real-time count of connected virtual guests
- **Send Blessings** — Viewers can send live blessings visible to everyone
- **RSVP System** — Full form with attendance tracking (Physical / Virtual / Regrets)
- **Virtual Guest Book** — Paginated, persistent guest messages
- **Wedding Programme** — Full timeline with 8 ceremony stages
- **Add to Calendar** — Google, Outlook, Yahoo, Apple iCal (.ics)
- **Countdown Timer** — Live countdown to the wedding
- **Share Button** — Web Share API / clipboard fallback
- **Broadcast Banners** — Admin announcements pushed to all viewers in real-time

### Admin Dashboard (`/admin`)
- **Stream Control** — Paste Meet link and go live with one click
- **Real-time Analytics** — Live viewer count, RSVPs, guestbook, reactions
- **RSVP Management** — View all RSVPs, stats breakdown, CSV export
- **Guest Book Moderation** — Approve, hide, delete entries
- **Blessings Management** — View and moderate all blessings
- **Live Chat Log** — Full chat history with real-time updates
- **Broadcast Tool** — Send announcements to all viewers instantly
- **Feature Toggles** — Enable/disable chat, blessings, RSVP
- **Site Settings** — Stream title, welcome message, status control

---

## 🚀 Quick Start

### 1. Install Node.js (v18+)
Download from https://nodejs.org

### 2. Install dependencies
```bash
cd wedding-app
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
```
Then edit `.env` with your settings:
- Change `SESSION_SECRET` to a long random string
- Set `ADMIN_USERNAME` and `ADMIN_PASSWORD`
- Optionally set `MEET_LINK` to pre-load your Meet link

### 4. Run the server
```bash
# Production
npm start

# Development (with auto-restart)
npm run dev
```

### 5. Access the website
- **Public site:** http://localhost:3000
- **Admin panel:** http://localhost:3000/admin

---

## 🎥 Going Live on Wedding Day

1. Open Google Meet and start your meeting
2. Copy the meeting link (e.g. `https://meet.google.com/abc-defg-xyz`)
3. Go to **Admin Panel** → **Stream Control**
4. Paste the Meet link and click **"🔴 Go Live"**
5. The stream instantly activates for all website visitors worldwide!

---

## 🌐 Deploying to the Internet

### Option A: Railway (Recommended — Free tier available)
```bash
npm install -g railway
railway login
railway init
railway up
```

### Option B: Render
- Connect your GitHub repo to render.com
- Set `npm start` as start command
- Add environment variables from `.env`

### Option C: VPS (DigitalOcean, Linode, etc.)
```bash
# Install PM2 for process management
npm install -g pm2
pm2 start server.js --name wedding-stream
pm2 save
pm2 startup
```
Then configure Nginx as a reverse proxy to port 3000.

### Option D: ngrok (Quick temporary public URL for testing)
```bash
npm install -g ngrok
npm start &
ngrok http 3000
```

---

## 📁 Project Structure

```
wedding-app/
├── server.js              # Main Express server + Socket.io
├── package.json
├── .env.example           # Environment config template
├── db/
│   └── database.js        # SQLite schema + query helpers
├── data/
│   └── wedding.db         # Auto-created SQLite database
├── public/
│   ├── index.html         # Main public website
│   ├── admin.html         # Admin dashboard
│   └── uploads/           # Photo uploads folder
└── README.md
```

---

## ⚙️ Technology Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Server     | Node.js + Express.js              |
| Real-time  | Socket.io (WebSockets)            |
| Database   | SQLite (via better-sqlite3)       |
| Auth       | Express-session + bcryptjs        |
| Security   | Helmet.js + rate limiting         |
| Frontend   | Vanilla HTML/CSS/JS (no framework)|
| Fonts      | Google Fonts (CDN)                |

---

## 🔐 Security Notes

- Change all credentials in `.env` before deploying
- The admin panel is session-protected
- All API endpoints are rate-limited
- Helmet.js provides security headers
- All user inputs are sanitized before database insertion

---

## 📞 RSVP Contacts
- +234 802 810 3410
- +234 706 095 7637
- #HawauAndLukman2026

---

*Made with ❤️ for Hawau Atinuke & Lukman Adebayo — 19 April 2026*
