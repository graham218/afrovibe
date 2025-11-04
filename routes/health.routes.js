const express = require('express');
const router = express.Router();

router.get('/healthz', (req, res) => res.json({ ok: true }));
router.get('/ping', (req, res) => res.type('text').send('pong'));

module.exports = router;
