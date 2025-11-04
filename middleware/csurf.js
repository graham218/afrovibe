const csurf = require('csurf');
const attach = csurf();

module.exports = function attachCsrf(req,res,next){
  // Skip CSRF for Stripe webhook or specific APIs if you already had skips
  if (req.path === '/webhook') return next();
  return attach(req,res,()=>{
    res.locals.csrfToken = req.csrfToken();
    next();
  });
};
