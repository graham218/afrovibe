// routes/static.routes.js
const express = require('express');
const router = express.Router();

const staticPages = [
  { path: '/how-it-works',          view: 'how-it-works',          title: 'How It Works' },
  { path: '/success-stories',       view: 'success-stories',       title: 'Success Stories' },
  { path: '/blog',                  view: 'blog',                  title: 'Blog' },
  { path: '/events',                view: 'events',                title: 'AfroVibe Events' },
  { path: '/help',                  view: 'help',                  title: 'Help Center' },
  { path: '/safety',                view: 'safety',                title: 'Safety Tips' },
  { path: '/community-guidelines',  view: 'community-guidelines',  title: 'Community Guidelines' },
  { path: '/terms',                 view: 'terms',                 title: 'Terms of Service' },
  { path: '/privacy',               view: 'privacy',               title: 'Privacy Policy' },
  { path: '/cookies',               view: 'cookies',               title: 'Cookie Policy' },
];

staticPages.forEach(({ path, view, title }) => {
  router.get(path, (req, res) => {
    res.render(view, {
      pageTitle: title,
      currentUser: req.user || null,
    });
  });
});

module.exports = router;
