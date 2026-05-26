const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { findUserByEmail, findUserById, createUser, getAllLeads } = require('../storage/supabaseAdapter');
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

  const user = await findUserByEmail(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

  const isBcrypt = user.password?.startsWith('$2');
  const match    = isBcrypt
    ? await bcrypt.compare(password, user.password)
    : password === user.password; // fallback for any unmigrated plain-text accounts
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

  if (await findUserByEmail(email.toLowerCase().trim())) {
    return res.status(409).json({ success: false, error: 'Email already registered' });
  }

  const hash     = await bcrypt.hash(password, 10);
  const userData = { email: email.toLowerCase().trim(), password: hash, name: name.trim(), role: userRole, projects: [], department: '' };

  const SAFE_ALL       = ['smxc','daxc','ebxc','plxc','ocsp','pac','studio','copywriting'];
  const SAFE_REQUESTER = ['smxc','daxc','ebxc','plxc','ocsp','pac'];

  // Designer: assign to lead and set project scope directly
  if (userRole === 'creative_designer' && req.body.leadId) {
    const lead = await findUserById(req.body.leadId);
    if (!lead) {
      return res.status(400).json({ success: false, error: 'The selected Creative Lead does not exist. Please refresh and try again.' });
    }
    if (lead.role !== 'creative_lead') {
      return res.status(400).json({ success: false, error: 'Selected user is not a Creative Lead.' });
    }
    const projects = Array.isArray(req.body.projects)
      ? req.body.projects.filter(p => SAFE_ALL.includes(p))
      : [];
    userData.leadId     = lead.id;
    userData.projects   = projects.length ? projects : (lead.projects || []);
    userData.department = projects.length ? projects.join(', ') : (lead.department || '');
  }

  // Creative Lead: set project scope
  if (userRole === 'creative_lead' && Array.isArray(req.body.projects) && req.body.projects.length) {
    userData.projects = req.body.projects.filter(p => SAFE_ALL.includes(p));
  }

  // Requester: project scope + direct superior email
  if (userRole === 'requester') {
    if (Array.isArray(req.body.projects) && req.body.projects.length) {
      userData.projects = req.body.projects.filter(p => SAFE_REQUESTER.includes(p));
    }
    if (req.body.directSuperiorEmail) {
      userData.directSuperiorEmail = req.body.directSuperiorEmail.toLowerCase().trim();
    }
  }

  const newUser = await createUser(userData);
  res.status(201).json({ success: true, token: makeToken(newUser, EXPIRES_NORMAL), user: safeUser(newUser) });
}

async function getLeads(req, res) {
  const leads = await getAllLeads();
  res.json({ success: true, data: leads });
}

function me(req, res) {
  res.json({ success: true, user: req.user });
}

module.exports = { login, register, getLeads, me };
