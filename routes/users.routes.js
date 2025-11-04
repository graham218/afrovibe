// routes/users.routes.js
const express = require('express');
const mongoose = require('mongoose');
const checkAuth = require('../middleware/checkAuth');
const { upload } = require('../middleware/upload'); // uses Multer (your existing middleware)

const Users = require('../controllers/users.controller');

const router = express.Router();

// NEW: dashboard
router.get('/dashboard', checkAuth, Users.dashboard);

// Canonical: /profile -> /my-profile
router.get('/profile', Users.profileRedirect);

// View another user's profile
router.get('/users/:id', checkAuth, Users.userProfile(mongoose));

// My profile (view / update)
router.get('/my-profile', checkAuth, Users.myProfile);
router.post('/my-profile', checkAuth, upload.array('photos', Users.MAX_PHOTOS), Users.myProfilePost);

// Edit profile (view / save)
router.get('/edit-profile', checkAuth, Users.editProfile);
router.post('/edit-profile', checkAuth, Users.editProfilePost);

// Viewed you
router.get('/viewed-you', checkAuth, Users.viewedYou);

module.exports = router;
