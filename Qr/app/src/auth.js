function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "not_authenticated" });
}

module.exports = { requireAdmin };
