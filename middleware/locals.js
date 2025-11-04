const { planOf, isElite, isPremiumOrBetter } = require('../config/stripe');
const User = require('../models/User');

module.exports = async function setLocals(req, res, next){
  res.locals.currentUser = null;
  res.locals.planOf = planOf;
  res.locals.isElite = isElite;
  res.locals.isPremiumOrBetter = isPremiumOrBetter;

  if (req.session?.userId){
    try {
      const me = await User.findById(req.session.userId).lean();
      res.locals.currentUser = me || null;
    } catch(e){ /* fail soft */ }
  }
  next();
};
