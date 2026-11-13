require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const verificationRoutes = require('./routes/verification');
const messageRoutes = require('./routes/messages');

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
});
