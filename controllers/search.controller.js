// controllers/search.controller.js
const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

/** ========================
 *  Tiny inlined helpers
 *  =======================
 */
const FREE_MAX_RADIUS_KM = Number(process.env.FREE_MAX_RADIUS_KM || 25);
const PRICE_PREMIUM = String(process.env.STRIPE_PRICE_ID_PREMIUM || '');
const PRICE_ELITE   = String(process.env.STRIPE_PRICE_ID_ELITE || '');

const toTrimmed = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()));
const toInt = (v, def = null) => { const n = parseInt(v, 10); return Number.isNaN(n) ? def : n; };

const planOf = (u) => {
  const price = String(u?.stripePriceId || u?.subscriptionPriceId || '');
  if (price && PRICE_ELITE && price === PRICE_ELITE) return 'elite';
  if (price && PRICE_PREMIUM && price === PRICE_PREMIUM) return 'premium';
  return u?.isPremium ? 'premium' : 'free';
};
const isElite = (u) => planOf(u) === 'elite';
const isPremiumOrBetter = (u) => ['premium', 'elite'].includes(planOf(u));

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

function clampFiltersForFree(raw, isPrem){
  const out = { ...raw };
  const locks = { minPhotos:false, languages:false, lifestyle:false, radius:false, distanceSort:false };
  if (!isPrem) {
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
function clampFiltersByPlan(filters, user){
  const out = { ...filters }; const locks = { videoChat:false };
  if (!isElite(user)) { 
    // treat as soft preference for non-Elite → blank to avoid hard filter
    if (out.videoChat === '1' || out.videoChat === '0') locks.videoChat = true;
    out.videoChat = ''; 
  }
  return { filters: out, locks };
}

/** ========================
 *  Controller
 *  =======================
 */
exports.advancedSearch = async (req, res) => {
  try {
    // Load minimal fields needed for gating & distance
    const currentUser = await User.findById(req.session.userId)
      .select('blockedUsers profile.lat profile.lng isPremium stripePriceId subscriptionPriceId')
      .lean();
    if (!currentUser) return res.redirect('/login');

    // Normalizers
    const ALLOWED_GENDERS = new Set(['Any','Male','Female','Non-binary']);
    const normGender = (g) => {
      const map = { Man:'Male', Woman:'Female', Nonbinary:'Non-binary', 'Non binary':'Non-binary' };
      const val = (g || 'Any').trim(); const mapped = map[val] || val;
      return ALLOWED_GENDERS.has(mapped) ? mapped : 'Any';
    };
    const safeRegex = (s) => {
      if (!s) return null;
      try { return new RegExp(String(s), 'i'); } catch { return null; }
    };

    // 1) Collect incoming filters
    const rawFilters = {
      seekingGender : normGender(req.query.seekingGender),
      minAge        : toTrimmed(req.query.minAge) || '',
      maxAge        : toTrimmed(req.query.maxAge) || '',
      country       : (req.query.country || 'Any').trim(),
      stateProvince : toTrimmed(req.query.stateProvince) || '',
      city          : toTrimmed(req.query.city) || '',
      q             : toTrimmed(req.query.q) || '',
      interests     : toTrimmed(req.query.interests) || '',
      location      : toTrimmed(req.query.location) || '',

      // advanced
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
      videoChat     : toTrimmed(req.query.videoChat || ''),
      sort          : (req.query.sort || 'active'),
    };

    // Age swap if reversed
    const minAgeRaw = toInt(rawFilters.minAge);
    const maxAgeRaw = toInt(rawFilters.maxAge);
    if (minAgeRaw != null && maxAgeRaw != null && minAgeRaw > maxAgeRaw) {
      rawFilters.minAge = String(maxAgeRaw);
      rawFilters.maxAge = String(minAgeRaw);
    }

    // 2) Gating
    const isPrem = isPremiumOrBetter(currentUser);
    const { filters: f1, locks: l1 } = clampFiltersForFree(rawFilters, isPrem);
    const { filters, locks: l2 }     = clampFiltersByPlan(f1, currentUser);
    const premiumLocks = { ...l1, ...l2 };

    // 3) Base query (exclude me + blocked; require profile)
    const excluded = [ currentUser._id, ...((currentUser.blockedUsers || []).map(id => id)) ];
    const query = { _id: { $nin: excluded }, profile: { $exists: true } };

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
    const reState = safeRegex(filters.stateProvince);
    const reCity  = safeRegex(filters.city);
    if (reState) query['profile.stateProvince'] = reState;
    if (reCity)  query['profile.city']          = reCity;

    // Free-text & interests
    if (filters.q) {
      query.$or = [
        { username: safeRegex(filters.q) || filters.q },
        { 'profile.bio': safeRegex(filters.q) || filters.q },
      ];
    }
    if (filters.interests) {
      query['profile.interests'] = { $regex: filters.interests, $options: 'i' };
    }

    // Toggles
    if (filters.verifiedOnly === '1') query.verifiedAt = { $ne: null };
    if (filters.onlineNow   === '1') query.lastActive = { $gte: new Date(Date.now() - 5 * 60 * 1000) };
    if (filters.hasPhoto    === '1') query['profile.photos.0'] = { $exists: true, $ne: null };

    // Min photos
    const minPhotosWanted = toInt(filters.minPhotos, 0);
    if (minPhotosWanted && minPhotosWanted > 1) {
      query[`profile.photos.${minPhotosWanted - 1}`] = { $exists: true, $ne: null };
    }

    // Faith / language / lifestyle
    if (filters.religion)     query['profile.religion']     = safeRegex(filters.religion)     || filters.religion;
    if (filters.denomination) query['profile.denomination'] = safeRegex(filters.denomination) || filters.denomination;

    if (filters.languages && String(filters.languages).trim() !== '') {
      const langs = Array.isArray(filters.languages)
        ? filters.languages
        : String(filters.languages).split(',').map(s => s.trim()).filter(Boolean);
      if (langs.length) query['profile.languages'] = { $in: langs };
    }

    if (filters.education) query['profile.education'] = safeRegex(filters.education) || filters.education;
    if (filters.smoking)   query['profile.smoking']   = safeRegex(filters.smoking)   || filters.smoking;
    if (filters.drinking)  query['profile.drinking']  = safeRegex(filters.drinking)  || filters.drinking;

    // Video chat (blanked for non-Elite by clamp)
    if (filters.videoChat === '1') query.videoChat = true;
    else if (filters.videoChat === '0') query.videoChat = { $ne: true };

    // 4) Sort
    const sortKey = filters.sort || 'active';
    let sortBase = { lastActive: -1, _id: -1 };
    if (sortKey === 'recent')  sortBase = { createdAt: -1, _id: -1 };
    if (sortKey === 'ageAsc')  sortBase = { 'profile.age': 1,  _id: -1 };
    if (sortKey === 'ageDesc') sortBase = { 'profile.age': -1, _id: -1 };
    const sort = { boostExpiresAt: -1, ...sortBase };

    // 5) Paging
    const page  = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 24), 1), 48);
    const skip  = (page - 1) * limit;

    // 6) Projection
    const projection = {
      username: 1,
      lastActive: 1,
      createdAt: 1,
      boostExpiresAt: 1,
      verifiedAt: 1,
      isPremium: 1,
      stripePriceId: 1,
      subscriptionPriceId: 1,
      videoChat: 1,
      'profile.age': 1,
      'profile.bio': 1,
      'profile.photos': 1,
      'profile.country': 1,
      'profile.stateProvince': 1,
      'profile.city': 1,
      'profile.lat': 1,
      'profile.lng': 1,
      'profile.languages': 1,
      'profile.religion': 1,
      'profile.denomination': 1,
    };

    // 7) Fetch + count
    const [rawList, total] = await Promise.all([
      User.find(query).select(projection).sort(sort).skip(skip).limit(limit).lean(),
      User.countDocuments(query),
    ]);

    // 8) Enhance
    const now = Date.now();
    const meLat = currentUser?.profile?.lat;
    const meLng = currentUser?.profile?.lng;

    const enhance = (u) => {
      const isOnline = u.lastActive ? (now - new Date(u.lastActive).getTime() < 5 * 60 * 1000) : false;
      const distanceKm =
        typeof meLat === 'number' && typeof meLng === 'number' &&
        typeof u?.profile?.lat === 'number' && typeof u?.profile?.lng === 'number'
          ? haversineKm(meLat, meLng, u.profile.lat, u.profile.lng)
          : null;
      return { ...u, isOnline, distanceKm, boostActive: computeBoostActive(u, now) };
    };

    let people = (rawList || []).map(enhance);

    // 9) Radius filter + distance sort (final step)
    const radiusKm = toInt(filters.radiusKm, 0) || 0;
    if (radiusKm > 0 && typeof meLat === 'number' && typeof meLng === 'number') {
      people = people.filter(u => typeof u.distanceKm === 'number' && u.distanceKm <= radiusKm);
    }
    if (sortKey === 'distance') {
      people.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    }

    // 10) Navbar badges
    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({
        recipient: currentUser._id,
        read: false,
        deletedFor: { $nin: [currentUser._id] }
      }),
      Notification.countDocuments({ recipient: currentUser._id, read: false }),
    ]);

    // 11) Render
    return res.render('advanced-search', {
      currentUser,
      filters,
      premiumLocks,
      people,
      pageMeta: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
        sort: sortKey,
      },
      unreadMessages,
      unreadNotificationCount,
    });
  } catch (err) {
    console.error('advanced-search err:', err);
    return res.status(500).render('error', { status: 500, message: 'Failed to load Advanced Search.' });
  }
};
