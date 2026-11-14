require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const verificationRoutes = require('./routes/verification');
const messageRoutes = require('./routes/messages');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Native cookie parser middleware
app.use((req, res, next) => {
  req.cookies = req.cookies || {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach(pair => {
      const parts = pair.split('=');
      if (parts.length >= 2) {
        req.cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
      }
    });
  }
  next();
});

// Ping endpoint for 24/7 keep-alive monitoring
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), time: new Date().toISOString() });
});

// Serve raw bare-bones static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api', verificationRoutes);
app.use('/api', messageRoutes);

// Root route fallback to frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`Frontend accessible at http://localhost:${PORT}`);

  // 24/7 Self-Ping Keep-Alive for Render (pings every 9 minutes to prevent spinning down)
  const APP_URL = process.env.RENDER_EXTERNAL_URL || 'https://stips-verification-board.onrender.com';
  console.log(`[KeepAlive] 24/7 pinger active for: ${APP_URL}`);

  setInterval(() => {
    const pingTarget = `${APP_URL.replace(/\/+$/, '')}/api/ping`;
    axios.get(pingTarget, { timeout: 10000 })
      .then(() => console.log(`[KeepAlive] 24/7 ping OK: ${new Date().toLocaleTimeString('he-IL')}`))
      .catch(err => console.warn(`[KeepAlive] Ping warning: ${err.message}`));
  }, 9 * 60 * 1000); // every 9 minutes (Render sleeps after 15 min)
});
