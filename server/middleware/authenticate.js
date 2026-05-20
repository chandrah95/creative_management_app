const jwt = require('jsonwebtoken');
const { findUserById } = require('../storage/localAdapter');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Always merge with fresh DB data so stale tokens and newly-registered
    // users (who get empty projects/leadId) still work correctly.
    const dbUser = findUserById(decoded.id);
    if (dbUser) {
      decoded.role       = dbUser.role;
      decoded.projects   = dbUser.projects   || [];
      decoded.leadId     = dbUser.leadId     || null;
      decoded.department = dbUser.department || '';
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

module.exports = { authenticate, JWT_SECRET };
