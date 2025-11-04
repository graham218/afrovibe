// routes/report.routes.js
const express = require('express');
const mongoose = require('mongoose');
const checkAuth = require('../middleware/checkAuth');
const ReportCtrl = require('../controllers/report.controller');

const router = express.Router();

// (optional) tiny validator for path params
const validateObjectId = (param) => (req, res, next) => {
  const v = String(req.params[param] || req.body[param] || '');
  if (v && !mongoose.Types.ObjectId.isValid(v)) {
    return res.status(400).json({ status: 'error', message: `Invalid ${param}` });
  }
  next();
};

// Page
router.get('/report', checkAuth, ReportCtrl.reportPage);

// Page submit (simple redirect back with ?sent=1)
router.post('/report', checkAuth, ReportCtrl.submitReport);

// Ajax: report a specific user (for card menus, profile actions, etc.)
router.post(
  '/report-user',
  checkAuth,
  validateObjectId('targetId'),
  ReportCtrl.reportUser
);

module.exports = router;

