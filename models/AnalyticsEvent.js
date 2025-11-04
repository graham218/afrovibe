// models/AnalyticsEvent.js
const mongoose = require('mongoose');

const AnalyticsEventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
  event: { type: String, required: true, index: true },
  payload: mongoose.Schema.Types.Mixed,
  path: String,
  ua: String,
  ip: String,
  at: { type: Date, default: Date.now, index: true },
}, { versionKey: false });

module.exports = mongoose.models.AnalyticsEvent
  || mongoose.model('AnalyticsEvent', AnalyticsEventSchema);
