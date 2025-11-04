// controllers/users.controller.js
const path = require('path');
const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

// ===== Inlined helpers (kept tiny; mirrors your usage) =====
const MAX_PHOTOS = Number(process.env.MAX_PHOTOS || 5);
const toIntOrNull = (v, min = 0, max = 999) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
};
const normalizeArray = (v) =>
  Array.isArray(v)
    ? v.map(s => String(s).trim()).filter(Boolean)
    : String(v || '').split(',').map(s => s.trim()).filter(Boolean);

// ---- tiny helpers (inlined for speed; align with your /advanced-search) ----
const DAILY_LIKE_LIMIT = Number(process.env.DAILY_LIKE_LIMIT || 50);
const FREE_MAX_RADIUS_KM = Number(process.env.FREE_MAX_RADIUS_KM || 25);

const toTrimmed = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()));
const toInt = (v, def = null) => { const n = parseInt(v, 10); return Number.isNaN(n) ? def : n; };

const STRIPE_PRICE_ID_ELITE   = String(process.env.STRIPE_PRICE_ID_EMERALD || process.env.STRIPE_PRICE_ID_ELITE || '');
const STRIPE_PRICE_ID_PREMIUM = String(process.env.STRIPE_PRICE_ID_SILVER  || process.env.STRIPE_PRICE_ID_PREMIUM || '');

const planOf = (u) => {
  const price = String(u?.stripePriceId || u?.subscriptionPriceId || '');
  if (price && STRIPE_PRICE_ID_ELITE   && price === STRIPE_PRICE_ID_ELITE)   return 'elite';
  if (price && STRIPE_PRICE_ID_PREMIUM && price === STRIPE_PRICE_ID_PREMIUM) return 'premium';
  return u?.isPremium ? 'premium' : 'free';
};
const isElite = (u) => planOf(u) === 'elite';

function clampFiltersByPlan(filters, user){
  const out = { ...filters }; const locks = { videoChat:false };
  if (!isElite(user)) {
    if (out.videoChat === '1' || out.videoChat === '0') locks.videoChat = true;
    out.videoChat = ''; // non-Elite: don’t hard filter by videoChat
  }
  return { filters: out, locks };
}

const deg2rad = (d) => d * Math.PI / 180;
function haversineKm(lat1,lng1,lat2,lng2){
  const R=6371; const dLat=deg2rad(lat2-lat1); const dLng=deg2rad(lng2-lng1);
  const a=Math.sin(dLat/2)**2 + Math.cos(deg2rad(lat1))*Math.cos(deg2rad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function computeBoostActive(u, nowMs){
  if (!u?.boostExpiresAt) return false;
  try { return (nowMs < new Date(u.boostExpiresAt).getTime()); } catch { return false; }
}

// Stub: plug in your exact “active user” criteria if you have them
const isActiveUserQuery = () => ({ /* e.g., deactivatedAt: { $exists: false } */ });

// helper for edit-profile $set builder
const setIf = (obj, pathKey, val) => {
  if (val === undefined) return;
  obj[pathKey] = val;
};

// ===== Controllers =====
exports.MAX_PHOTOS = MAX_PHOTOS;

exports.dashboard = async (req, res) => {
  try {
    const now = Date.now();

    const currentUser = await User.findById(req.session.userId)
      .populate('likes', '_id')
      .populate('dislikes', '_id')
      .populate('blockedUsers', '_id')
      .lean();

    if (!currentUser) {
      req.session.destroy(() => {});
      return res.redirect('/login');
    }

    // UI tier mapping: free | silver | emerald (kept for card badges)
    const STRIPE_PRICE_ID_EMERALD = process.env.STRIPE_PRICE_ID_EMERALD || '';
    const STRIPE_PRICE_ID_SILVER  = process.env.STRIPE_PRICE_ID_SILVER  || '';
    const tierOf = (u) => {
      const price = u.stripePriceId || u.subscriptionPriceId || null;
      if (price && STRIPE_PRICE_ID_EMERALD && String(price) === String(STRIPE_PRICE_ID_EMERALD)) return 'emerald';
      if (price && STRIPE_PRICE_ID_SILVER  && String(price) === String(STRIPE_PRICE_ID_SILVER))  return 'silver';
      if (u.isPremium) return 'silver';
      return 'free';
    };

    // Exclusions
    const excludedUserIds = [
      ...(currentUser.blockedUsers || []).map(u => u._id),
      currentUser._id,
    ];

    // ---- Filters ----
    const rawFilters = {
      seekingGender : req.query.seekingGender || 'Any',
      minAge        : toTrimmed(req.query.minAge) || '',
      maxAge        : toTrimmed(req.query.maxAge) || '',
      country       : req.query.country || 'Any',
      stateProvince : toTrimmed(req.query.stateProvince) || '',
      city          : toTrimmed(req.query.city) || '',
      q             : toTrimmed(req.query.q) || '',
      interests     : toTrimmed(req.query.interests) || '',
      location      : toTrimmed(req.query.location) || '',

      verifiedOnly  : req.query.verifiedOnly || '',
      onlineNow     : req.query.onlineNow || '',
      hasPhoto      : req.query.hasPhoto || '',
      minPhotos     : toTrimmed(req.query.minPhotos) || '',
      radiusKm      : toTrimmed(req.query.radiusKm) || '',
      religion      : toTrimmed(req.query.religion) || '',
      denomination  : toTrimmed(req.query.denomination) || '',
      languages     : req.query.languages || '',
      education     : toTrimmed(req.query.education) || '',
      smoking       : toTrimmed(req.query.smoking) || '',
      drinking      : toTrimmed(req.query.drinking) || '',
      sort          : req.query.sort || 'active',
      videoChat     : toTrimmed(req.query.videoChat || ''),
    };

    // ---- Free clamp ----
    function clampFiltersForFree(filters, isPremium) {
      const out = { ...filters };
      const locks = { minPhotos:false, languages:false, lifestyle:false, radius:false, distanceSort:false };
      if (!isPremium) {
        if ((+out.minPhotos || 0) > 1) { out.minPhotos = ''; locks.minPhotos = true; }
        if (out.languages && String(out.languages).trim() !== '') { out.languages = ''; locks.languages = true; }
        if (out.education) { out.education = ''; locks.lifestyle = true; }
        if (out.smoking)   { out.smoking   = ''; locks.lifestyle = true; }
        if (out.drinking)  { out.drinking  = ''; locks.lifestyle = true; }
        const r = +out.radiusKm || 0;
        if (r > FREE_MAX_RADIUS_KM) { out.radiusKm = String(FREE_MAX_RADIUS_KM); locks.radius = true; }
        if (out.sort === 'distance') { out.sort = 'active'; locks.distanceSort = true; }
      }
      return { filters: out, locks };
    }

    const { filters: f1, locks: l1 } = clampFiltersForFree(rawFilters, !!currentUser.isPremium);
    const { filters, locks: l2 }     = clampFiltersByPlan(f1, currentUser);
    const premiumLocks               = { ...l1, ...l2 };

    // ---- Paging ----
    const page  = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit || req.query.pageSize, 24), 6), 48);
    const skip  = (page - 1) * limit;

    // ---- Sorting ----
    const sortKey  = filters.sort || 'active';
    let   sortBase = { lastActive: -1, _id: -1 };
    if (sortKey === 'recent')  sortBase = { createdAt: -1, _id: -1 };
    if (sortKey === 'ageAsc')  sortBase = { 'profile.age': 1,  _id: -1 };
    if (sortKey === 'ageDesc') sortBase = { 'profile.age': -1, _id: -1 };
    const sort = { boostExpiresAt: -1, ...sortBase };

    // ---- Base query (active + not me/blocked + has profile) ----
    const query = {
      ...isActiveUserQuery(),
      _id: { $nin: excludedUserIds },
      profile: { $exists: true }
    };

    // Strict videoChat only for Elite
    if (filters.videoChat === '1' && isElite(currentUser)) query.videoChat = true;

    // Gender
    if (filters.seekingGender !== 'Any') query['profile.gender'] = filters.seekingGender;

    // Age
    const minAge = toInt(filters.minAge);
    const maxAge = toInt(filters.maxAge);
    if (minAge != null && maxAge != null) query['profile.age'] = { $gte: minAge, $lte: maxAge };
    else if (minAge != null)              query['profile.age'] = { $gte: minAge };
    else if (maxAge != null)              query['profile.age'] = { $lte: maxAge };

    // Location
    if (filters.country !== 'Any') query['profile.country'] = filters.country;
    if (filters.stateProvince)     query['profile.stateProvince'] = new RegExp(filters.stateProvince, 'i');
    if (filters.city)              query['profile.city'] = new RegExp(filters.city, 'i');

    // Text / interests
    if (filters.q) {
      query.$or = [
        { username: new RegExp(filters.q, 'i') },
        { 'profile.bio': new RegExp(filters.q, 'i') },
      ];
    }
    if (filters.interests) {
      query['profile.interests'] = { $regex: filters.interests, $options: 'i' };
    }

    // Toggles
    if (filters.verifiedOnly === '1')  query.verifiedAt = { $ne: null };
    if (filters.onlineNow   === '1')   query.lastActive = { $gte: new Date(Date.now() - 5 * 60 * 1000) };
    if (filters.hasPhoto    === '1')   query['profile.photos.0'] = { $exists: true, $ne: null };

    const minPhotosWanted = toInt(filters.minPhotos, 0);
    if (minPhotosWanted && minPhotosWanted > 1) {
      query[`profile.photos.${minPhotosWanted - 1}`] = { $exists: true, $ne: null };
    }

    if (filters.religion)     query['profile.religion']     = new RegExp(filters.religion, 'i');
    if (filters.denomination) query['profile.denomination'] = new RegExp(filters.denomination, 'i');

    if (filters.languages && String(filters.languages).trim() !== '') {
      const langs = Array.isArray(filters.languages)
        ? filters.languages
        : String(filters.languages).split(',').map(s => s.trim()).filter(Boolean);
      if (langs.length) query['profile.languages'] = { $in: langs };
    }

    if (filters.education) query['profile.education'] = new RegExp(filters.education, 'i');
    if (filters.smoking)   query['profile.smoking']   = new RegExp(filters.smoking, 'i');
    if (filters.drinking)  query['profile.drinking']  = new RegExp(filters.drinking, 'i');

    // ---- Projection ----
    const projection = {
      username               : 1,
      lastActive             : 1,
      createdAt              : 1,
      boostExpiresAt         : 1,
      verifiedAt             : 1,
      isPremium              : 1,
      stripePriceId          : 1,
      subscriptionPriceId    : 1,
      'profile.age'          : 1,
      'profile.bio'          : 1,
      'profile.photos'       : 1,
      'profile.country'      : 1,
      'profile.stateProvince': 1,
      'profile.city'         : 1,
      'profile.prompts'      : 1,
      'profile.lat'          : 1,
      'profile.lng'          : 1,
      'profile.languages'    : 1,
      'profile.religion'     : 1,
      'profile.denomination' : 1,
      videoChat              : 1
    };

    // ---- Fetch + count ----
    const [rawList, total] = await Promise.all([
      User.find(query).select(projection).sort(sort).skip(skip).limit(limit).lean(),
      User.countDocuments(query),
    ]);

    // ---- Enhance ----
    const meLat = currentUser?.profile?.lat;
    const meLng = currentUser?.profile?.lng;

    const enhance = (u) => {
      const isOnline = u.lastActive
        ? (now - new Date(u.lastActive).getTime() < 5 * 60 * 1000)
        : false;

      const distanceKm =
        typeof meLat === 'number' && typeof meLng === 'number' &&
        typeof u?.profile?.lat === 'number' && typeof u?.profile?.lng === 'number'
          ? haversineKm(meLat, meLng, u.profile.lat, u.profile.lng)
          : null;

      return {
        ...u,
        isOnline,
        distanceKm,
        boostActive: computeBoostActive(u, now),
        memberLevel: tierOf(u), // free | silver | emerald
      };
    };

    let potentialMatches = (rawList || []).map(enhance);

    // ---- Radius post-filter + optional distance sort ----
    const radiusKm = toInt(filters.radiusKm, 0) || 0;
    if (radiusKm > 0 && typeof meLat === 'number' && typeof meLng === 'number') {
      potentialMatches = potentialMatches.filter(u =>
        typeof u.distanceKm === 'number' && u.distanceKm <= radiusKm
      );
    }
    if (filters.sort === 'distance') {
      potentialMatches.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    }

    // ---- Favorites & wave flags (safe defaults) ----
    const favoriteSet   = new Set((currentUser.favorites  || []).map(id => String(id)));
    const wavedSet      = new Set((currentUser.waved      || []).map(id => String(id)));
    const superLikedSet = new Set((currentUser.superLiked || []).map(id => String(id)));

    potentialMatches = potentialMatches.map(u => {
      const idStr = String(u._id);
      return {
        ...u,
        isFavorite : favoriteSet.has(idStr),
        iWaved     : wavedSet.has(idStr),
        iSuperLiked: superLikedSet.has(idStr),
      };
    });

    // ---- Likes remaining (freemium)
    let likesRemaining = -1;
    if (!currentUser.isPremium) {
      const todayKey = new Date().toDateString();
      const lastKey  = currentUser.lastLikeDate ? new Date(currentUser.lastLikeDate).toDateString() : null;

      if (todayKey !== lastKey) {
        await User.updateOne(
          { _id: currentUser._id },
          { $set: { likesToday: 0, lastLikeDate: new Date() } }
        );
        currentUser.likesToday = 0;
      }

      const used = Number(currentUser.likesToday || 0);
      likesRemaining = Math.max(DAILY_LIKE_LIMIT - used, 0);
    }

    // ---- Unread counts
    const [unreadNotificationCount, unreadMessages] = await Promise.all([
      Notification.countDocuments({ recipient: currentUser._id, read: false }),
      Message.countDocuments({ recipient: currentUser._id, read: false }),
    ]);

    // ---- Daily suggestions (newest, active)
    let dailySuggestions = [];
    try {
      const rawDaily = await User.find({
          ...isActiveUserQuery(),
          _id: { $nin: excludedUserIds },
          profile: { $exists: true },
        })
        .select(projection)
        .sort({ createdAt: -1, _id: -1 })
        .limit(12)
        .lean();
      dailySuggestions = (rawDaily || []).map(enhance);
    } catch { dailySuggestions = []; }

    dailySuggestions = (dailySuggestions || []).map(u => {
      const idStr = String(u._id);
      return {
        ...u,
        isFavorite: favoriteSet.has(idStr),
        iWaved:     wavedSet.has(idStr),
      };
    });

    // ---- Streak widget
    const streak = { day: Number(currentUser.streakDay || 0), target: 7, percentage: 0 };
    streak.percentage = Math.max(0, Math.min(100, (streak.day / streak.target) * 100));

    // ---- Meta
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const pageMeta = { page, limit, total, totalPages, hasPrev: page > 1, hasNext: page < totalPages, sort: sortKey };

    // ---- Render
    return res.render('dashboard', {
      currentUser,
      potentialMatches,
      dailySuggestions,
      likesRemaining,
      unreadNotificationCount: unreadNotificationCount || 0,
      unreadMessages: unreadMessages || 0,
      filters,          // clamped filters (sticky)
      premiumLocks,     // locked controls (for UI)
      pageMeta,
      streak,
    });
  } catch (err) {
    console.error('Error fetching dashboard:', err);
    return res.status(500).render('error', {
      status: 500,
      message: 'Something went wrong while loading your dashboard.',
    });
  }
};

exports.profileRedirect = (req, res) => res.redirect(301, '/my-profile');

exports.userProfile = (mongoose) => async (req, res) => {
  try {
    const currentUserId = String(req.session.userId || '');
    const profileId = String(req.params.id || '');

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return res.status(400).send('Invalid user ID');
    }

    const [currentUser, user] = await Promise.all([
      User.findById(currentUserId).lean(),
      User.findOne({ _id: profileId, ...isActiveUserQuery() }).lean(), // only active users
    ]);

    if (!currentUser) return res.status(404).send('User not found');
    if (!user) {
      return res
        .status(404)
        .render('error', { status: 404, message: 'This account is not available.' });
    }

    const set = (arr) => new Set((arr || []).map(v => String(v)));
    const myLikes = set(currentUser.likes);
    const theirLikes = set(user.likes);
    const myBlocked = set(currentUser.blockedUsers);

    const hasLiked = myLikes.has(profileId);
    const isMatched = hasLiked && theirLikes.has(currentUserId);
    const isBlocked = myBlocked.has(profileId);

    const [unreadNotificationCount, unreadMessages] = await Promise.all([
      Notification.countDocuments({ recipient: currentUserId, read: false }),
      Message.countDocuments({ recipient: currentUserId, read: false }),
    ]);

    const successMessage =
      req.query.payment === 'success'
        ? 'Subscription successful! You are now a Premium Member.'
        : null;

    return res.render('profile', {
      currentUser,
      user,
      isMatched,
      isBlocked,
      hasLiked,
      unreadNotificationCount: unreadNotificationCount || 0,
      unreadMessages: unreadMessages || 0,
      successMessage,
    });
  } catch (err) {
    console.error('Error loading profile:', err);
    return res.status(500).send('Server Error');
  }
};

exports.myProfile = async (req, res) => {
  try {
    const meId = req.session.userId;
    const currentUser = await User.findById(meId).lean();
    if (!currentUser) return res.redirect('/login');

    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: meId, read: false }),
      Notification.countDocuments({ recipient: meId, read: false }),
    ]);

    const successMessage =
      req.query.payment === 'success'
        ? 'Subscription successful! You are now a Premium Member.'
        : null;

    return res.render('my-profile', {
      pageTitle: 'My Profile',
      currentUser,
      updated: req.query.updated === '1',
      unreadMessages,
      unreadNotificationCount,
      successMessage,
    });
  } catch (err) {
    console.error('GET /my-profile', err);
    return res.status(500).render('error', {
      status: 500,
      message: 'Failed to load profile.',
    });
  }
};

exports.myProfilePost = async (req, res) => {
  try {
    const meId = req.session.userId;
    const me = await User.findById(meId)
      .select('profile favoriteAfricanArtists culturalTraditions relationshipGoals')
      .lean();
    if (!me) return res.redirect('/login');

    const bio = (req.body.bio || '').trim();
    const age = toIntOrNull(req.body.age, 18, 100);
    const gender = (req.body.gender || '').trim();
    const occupation = (req.body.occupation || '').trim();
    const interests = normalizeArray(req.body.interests);

    const favoriteAfricanArtists = (req.body.favoriteAfricanArtists || '').trim();
    const culturalTraditions = (req.body.culturalTraditions || '').trim();
    const relationshipGoals = (req.body.relationshipGoals || '').trim();

    const existing = Array.isArray(me?.profile?.photos) ? me.profile.photos : [];
    const uploaded = (req.files || []).map((f) => '/uploads/' + path.basename(f.filename));
    const merged = Array.from(new Set([...uploaded, ...existing])).slice(0, MAX_PHOTOS);

    // You computed a full $set in your original, but ultimately only saved photos.
    // To keep behavior 1:1, we perform the same effective write:
    await User.updateOne({ _id: meId }, { $set: { 'profile.photos': merged } });

    return res.redirect('/my-profile?updated=1');
  } catch (err) {
    console.error('POST /my-profile', err);
    return res.status(500).render('error', {
      status: 500,
      message: 'Failed to update profile.',
    });
  }
};

exports.editProfile = async (req, res) => {
  try {
    const meId = req.session.userId;
    const currentUser = await User.findById(meId).lean();
    if (!currentUser) return res.redirect('/login');

    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: meId, read: false }),
      Notification.countDocuments({ recipient: meId, read: false }),
    ]);

    return res.render('edit-profile', {
      pageTitle: 'Edit Profile',
      currentUser,
      unreadMessages,
      unreadNotificationCount,
      error: null,
    });
  } catch (err) {
    console.error('GET /edit-profile', err);
    return res.status(500).render('error', {
      status: 500,
      message: 'Failed to load editor.',
    });
  }
};

exports.editProfilePost = async (req, res) => {
  try {
    const meId = req.session.userId;
    const b = req.body;
    const arr = (v) =>
      Array.isArray(v)
        ? v.map((s) => String(s).trim()).filter(Boolean)
        : String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

    const $set = {};
    setIf($set, 'username', (b.username || '').trim());
    setIf($set, 'profile.age', b.age ? Math.max(18, Math.min(100, parseInt(b.age, 10))) : null);
    setIf($set, 'profile.gender', (b.gender || '').trim());
    setIf($set, 'profile.bio', (b.bio || '').trim());

    setIf($set, 'profile.country', (b.country || '').trim());
    setIf($set, 'profile.stateProvince', (b.stateProvince || '').trim());
    setIf($set, 'profile.city', (b.city || '').trim());

    setIf($set, 'profile.occupation', (b.occupation || '').trim());
    setIf($set, 'profile.employmentStatus', (b.employmentStatus || '').trim());
    setIf($set, 'profile.educationLevel', (b.educationLevel || '').trim());

    setIf($set, 'profile.nationality', (b.nationality || '').trim());
    setIf($set, 'profile.religion', (b.religion || '').trim());
    setIf($set, 'profile.starSign', (b.starSign || '').trim());
    setIf($set, 'profile.languagesSpoken', b.languagesSpoken ? arr(b.languagesSpoken) : []);

    setIf($set, 'profile.drinks', (b.drinks || '').trim());
    setIf($set, 'profile.smokes', (b.smokes || '').trim());
    setIf($set, 'profile.pets', b.pets ? arr(b.pets) : []);
    setIf($set, 'profile.bodyArt', b.bodyArt ? arr(b.bodyArt) : []);

    setIf(
      $set,
      'profile.relationshipLookingFor',
      b.relationshipLookingFor ? arr(b.relationshipLookingFor) : []
    );
    setIf($set, 'profile.children', (b.children || '').trim());
    setIf($set, 'profile.wantsMoreChildren', (b.wantsMoreChildren || '').trim());

    setIf($set, 'profile.interests', b.interests ? arr(b.interests) : []);
    setIf($set, 'profile.hobbiesInterests', b.hobbiesInterests ? arr(b.hobbiesInterests) : []);

    // prompts (top-level)
    setIf($set, 'favoriteAfricanArtists', (b.favoriteAfricanArtists || '').trim());
    setIf($set, 'culturalTraditions', (b.culturalTraditions || '').trim());
    setIf($set, 'relationshipGoals', (b.relationshipGoals || '').trim());

    await User.updateOne({ _id: meId }, { $set }, { runValidators: true });

    return res.redirect('/my-profile?updated=1');
  } catch (e) {
    console.error('POST /edit-profile error', e);
    return res
      .status(500)
      .render('error', { status: 500, message: 'Failed to save profile.' });
  }
};

exports.viewedYou = async (req, res) => {
  try {
    const meId = req.session.userId;
    const currentUser = await User.findById(meId)
      .select('isPremium blockedUsers views')
      .lean();
    if (!currentUser) return res.redirect('/login');

    const blocked = new Set((currentUser.blockedUsers || []).map(String));

    // latest view per viewer
    const latestByViewer = new Map();
    for (const v of (currentUser.views || [])) {
      const k = String(v.user);
      if (blocked.has(k)) continue;
      const t = v.at instanceof Date ? v.at.getTime() : new Date(v.at).getTime();
      const prev = latestByViewer.get(k);
      if (!prev || t > prev) latestByViewer.set(k, t);
    }

    const viewerIds = [...latestByViewer.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    // paging
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '24', 10), 1), 48);
    const skip = (page - 1) * limit;
    const total = viewerIds.length;
    const slice = viewerIds.slice(skip, skip + limit);

    const projection = {
      username: 1,
      verifiedAt: 1,
      lastActive: 1,
      'profile.age': 1,
      'profile.city': 1,
      'profile.country': 1,
      'profile.photos': 1,
    };

    let people = [];
    if (slice.length) {
      const raw = await User.find({ _id: { $in: slice }, ...isActiveUserQuery() })
        .select(projection)
        .lean();
      const byId = new Map(raw.map((u) => [String(u._id), u]));
      people = slice.map((id) => byId.get(String(id))).filter(Boolean);
    }

    const blurred = !currentUser.isPremium;

    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: meId, read: false }),
      Notification.countDocuments({ recipient: meId, read: false }),
    ]);

    return res.render('viewed-you', {
      currentUser,
      people,
      blurred,
      pageMeta: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
      unreadMessages,
      unreadNotificationCount,
    });
  } catch (e) {
    console.error('viewed-you err', e);
    return res
      .status(500)
      .render('error', { status: 500, message: 'Failed to load Viewed You.' });
  }
};
