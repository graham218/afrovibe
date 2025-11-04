// routes/misc.routes.js
const express = require('express');
const checkAuth = require('../middleware/checkAuth');

const router = express.Router();

// favicon (no content)
router.get('/favicon.ico', (req, res) => res.status(204).end());

// RTC config (STUN/TURN)
router.get('/api/rtc/config', checkAuth, (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];

  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    const urls = process.env.TURN_URL.split(',').map(s => s.trim()).filter(Boolean);
    iceServers.push({
      urls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  res.json({ iceServers, rtc: { iceServers } });
});

module.exports = router;
