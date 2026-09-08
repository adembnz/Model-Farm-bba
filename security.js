import crypto from 'node:crypto';
export function csrfToken(req,res,next){
  if(!req.session.csrfToken) req.session.csrfToken=crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken=req.session.csrfToken;
  next();
}
export function verifyCsrf(req,res,next){
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const supplied=req.get('x-csrf-token');
  const expected=req.session?.csrfToken;
  if(!supplied || !expected || supplied!==expected) return res.status(403).json({error:'Invalid CSRF token'});
  next();
}
