const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { findUserByEmail } = require('../storage/localAdapter');
const { JWT_SECRET } = require('../middleware/authenticate');

const EXPIRES_NORMAL = '24h';
const EXPIRES_REMEMBER = '30d';

async function login(req, res) {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required' });
  }

  const user = findUserByEmail(email.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const expiresIn = rememberMe ? EXPIRES_REMEMBER : EXPIRES_NORMAL;
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn }
  );

  res.json({
    success: true,
    token,
    expiresIn,
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
}

function me(req, res) {
  res.json({ success: true, user: req.user });
}

module.exports = { login, me };
