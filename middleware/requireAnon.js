module.exports = function requireAnon(req,res,next){
  if (req.session?.userId) return res.redirect('/dashboard');
  return next();
};
