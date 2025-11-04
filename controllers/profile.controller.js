// controllers/profile.controller.js
const User = require('../models/User');

module.exports.setLocation = async function setLocation(req, res) {
  try {
    const { lat, lng } = req.body;
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    user.profile = user.profile || {};
    user.profile.lat = Number(lat);
    user.profile.lng = Number(lng);
    await user.save();

    return res.json({ ok: true });
  } catch (e) {
    console.error('location save error', e);
    return res.status(500).json({ ok: false, error: 'Failed to save location' });
  }
};
