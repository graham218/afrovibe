// middleware/checkAuth.js
module.exports = async function checkAuth(req, res, next) {
  try {
    const wantsHTML = () => {
      const a = req.headers.accept || '';
      const x = req.headers['x-requested-with'] || '';
      if (req.path.startsWith('/api')) return false;
      return a.includes('text/html') && !a.includes('application/json') && x !== 'XMLHttpRequest';
    };

    if (!req.session?.userId) {
      return wantsHTML()
        ? res.redirect('/login')
        : res.status(401).json({ error: 'You must be logged in to access this.' });
    }
    const User = require('../models/User');
    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return wantsHTML()
        ? res.redirect('/login')
        : res.status(401).json({ error: 'User not found. Please log in again.' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('checkAuth error:', err);
    return res.status(500).json({ error: 'Server error while authenticating.' });
  }
};
