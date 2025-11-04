// routes/favorites.routes.js
const express = require('express');
const mongoose = require('mongoose');
const checkAuth = require('../middleware/checkAuth');

const Favorites = require('../controllers/favorites.controller');

const router = express.Router();

const validateObjectIdParam = (param) => (req, res, next) => {
  const val = String(req.params[param] || '');
  if (!mongoose.Types.ObjectId.isValid(val)) {
    return res.status(400).json({ ok: false, error: `bad_${param}` });
  }
  next();
};

// Add / remove favorite
router.post('/favorite/:id', checkAuth, validateObjectIdParam('id'), Favorites.addFavorite);
router.delete('/favorite/:id', checkAuth, validateObjectIdParam('id'), Favorites.removeFavorite);

// Favorites hub page
router.get('/favorites', checkAuth, Favorites.favoritesPage);

module.exports = router;
