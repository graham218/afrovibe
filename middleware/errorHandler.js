function notFound(req,res,next){
  res.status(404);
  if (req.accepts('html')) return res.render('error', { status:404, message:'Not Found' });
  return res.json({ error:'Not Found' });
}

function errorHandler(err, req, res, next){
  console.error(err);
  const status = err.status || 500;
  res.status(status);
  if (req.accepts('html')){
    return res.render('error', { status, message: err.message || 'Server Error' });
  }
  res.json({ error: err.message || 'Server Error' });
}

module.exports = { notFound, errorHandler };
