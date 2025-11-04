const express = require('express');
const checkAuth = require('../middleware/checkAuth');
const { advancedSearch } = require('../controllers/search.controller');

const router = express.Router();
router.get('/advanced-search', checkAuth, advancedSearch);
module.exports = router;
