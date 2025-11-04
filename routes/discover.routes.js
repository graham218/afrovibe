// routes/discover.routes.js
const express = require('express');
const checkAuth = require('../middleware/checkAuth');
const Discover = require('../controllers/discover.controller');

const router = express.Router();

// Page (if you have it)
router.get('/discover', checkAuth, Discover.page || ((req, res) => res.render('discover')));

// API
router.get('/api/discover', checkAuth, Discover.discoverApi);

module.exports = router;
