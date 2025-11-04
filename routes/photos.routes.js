// routes/photos.routes.js
const express = require('express');
const checkAuth = require('../middleware/checkAuth');
const { upload } = require('../middleware/upload');

const Photos = require('../controllers/photos.controller');

const router = express.Router();

// Manage page
router.get('/photos', checkAuth, Photos.photosView);

// Add more photos (form posts "photos")
router.post(
  '/photos',
  checkAuth,
  upload.array('photos', Photos.MAX_PHOTOS),
  Photos.photosAdd
);

// AJAX uploader used by photos.ejs (field "profilePhotos")
router.post(
  '/photos/upload',
  checkAuth,
  upload.array('profilePhotos', Photos.MAX_PHOTOS),
  Photos.uploadPhotos
);

// Set primary by index
router.post('/photos/set-primary/:idx', checkAuth, Photos.setPrimary);

// Delete by array index (preferred path used by photos.ejs)
router.post('/photos/delete/:photoIndex', checkAuth, Photos.deleteByIndex);

// Alias: delete by exact URL in body {photoUrl}
router.post('/photos/delete', checkAuth, Photos.deleteByUrl);

module.exports = router;

