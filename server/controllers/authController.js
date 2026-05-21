const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { findUserByEmail, findUserById, createUser, getAllLeads } = require('../storage/localAdapter');
const { JWT_SECRET } = require('../middleware/authenticate');

const EXPIRES_NORMAL = '24h';
const EXPIRES_REMEMBER = '30d';

function makeToken(user, expiresIn) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, projects: user.projects || [], department: user.department || '', leadId: user.leadId || null },
    JWT_SECRET,
    { expiresIn }
  );
}

function safeUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, projects: user.projects || [], department: user.department || '' };
}

async function login(req, res) {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required' });
  }

  const user = findUserByEmail(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

  // Support plain-text passwords (dev accounts) alongside bcrypt hashes
  const isBcrypt = user.password.startsWith('$2a$') || user.password.startsWith('$2b$');
  const match    = isBcrypt
    ? await bcrypt.compare(password, user.password)
    : password === user.password;
  if (!match) return res.status(401).json({ success: false, error: 'Invalid credentials' });

  const expiresIn = rememberMe ? EXPIRES_REMEMBER : EXPIRES_NORMAL;
  res.json({ success: true, token: makeToken(user, expiresIn), expiresIn, user: safeUser(user) });
}

async function register(req, res) {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ success: false, error: 'Email, name, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
  }

  const allowed = ['requester', 'creative_designer', 'creative_lead'];
  const userRole = allowed.includes(role) ? role : 'requester';

  if (findUserByEmail(email.toLowerCase().trim())) {
    return res.status(409).json({ success: false, error: 'Email already registered' });
  }

  const hash     = await bcrypt.hash(password, 10);
  const userData = { email: email.toLowerCase().trim(), password: hash, name: name.trim(), role: userRole, projects: [], department: '' };

  // Designer: assign to lead and restrict projects to selected scopes
  if (userRole === 'creative_designer' && req.body.leadId) {
    const lead = findUserById(req.body.leadId);
    if (lead && lead.role === 'creative_lead') {
      const SCOPE_PROJECTS = {
        'In App':    ['ebxc', 'plxc'],
        'Out App 1': ['smxc', 'daxc'],
        'Out App 2': ['ocsp', 'pac'],
        'Studio':    ['studio']
      };
      const scopes      = Array.isArray(req.body.scopes) ? req.body.scopes : [];
      const leadProjects = lead.projects || [];

      // Map selected scopes → project IDs, then intersect with the lead's actual projects
      const scopedProjects = scopes.length
        ? scopes.flatMap(s => SCOPE_PROJECTS[s] || []).filter(p => leadProjects.includes(p))
        : leadProjects;

      userData.leadId     = lead.id;
      userData.projects   = scopedProjects;
      userData.scopes     = scopes;
      userData.department = scopes.length ? scopes.join(' & ') : (lead.department || '');
    }
  }

  // Requester project scope (limits what they can submit and see)
  if (userRole === 'requester' && Array.isArray(req.body.projects) && req.body.projects.length) {
    const SAFE = ['smxc','daxc','ebxc','plxc','ocsp','pac'];
    userData.projects = req.body.projects.filter(p => SAFE.includes(p));
  }

  const newUser = createUser(userData);
  res.status(201).json({ success: true, token: makeToken(newUser, EXPIRES_NORMAL), user: safeUser(newUser) });
}

function getLeads(req, res) {
  res.json({ success: true, data: getAllLeads() });
}

function me(req, res) {
  res.json({ success: true, user: req.user });
}

module.exports = { login, register, getLeads, me };
