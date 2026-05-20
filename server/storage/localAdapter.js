const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR    = path.join(__dirname, '../data');
const USERS_FILE  = path.join(DATA_DIR, 'users.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function initStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE))    writeJson(USERS_FILE, []);
  if (!fs.existsSync(REQUESTS_FILE)) writeJson(REQUESTS_FILE, []);
  seedDefaultUsers();
}

function seedDefaultUsers() {
  let users   = readJson(USERS_FILE);
  let updated = false;

  const admin = users.find(u => u.role === 'admin');
  if (admin && !admin.projects) {
    admin.projects   = ['brand-identity','digital-marketing','social-media','video-animation','print-offline','web-ui-design'];
    admin.department = 'Administration';
    updated = true;
  }

  const seeds = [
    { email:'andhika@company.com',    password:'Lead123!',    name:'Andhika',       role:'creative_lead',     projects:['social-media','digital-marketing'], department:'Social Media & Digital Marketing' },
    { email:'designer1@company.com',  password:'Design123!',  name:'Designer One',  role:'creative_designer', projects:['social-media','digital-marketing'], department:'Social Media & Digital Marketing' },
    { email:'designer2@company.com',  password:'Design123!',  name:'Designer Two',  role:'creative_designer', projects:['social-media','digital-marketing'], department:'Social Media & Digital Marketing' },
    { email:'requester@company.com',  password:'Request123!', name:'Requester One', role:'requester',         projects:[], department:'' }
  ];

  for (const seed of seeds) {
    if (!users.find(u => u.email === seed.email)) {
      const hash = bcrypt.hashSync(seed.password, 10);
      users.push({ id: uuidv4(), email: seed.email, password: hash, name: seed.name, role: seed.role, projects: seed.projects, department: seed.department });
      updated = true;
    }
  }

  const lead = users.find(u => u.email === 'andhika@company.com');
  if (lead) {
    for (const u of users) {
      if (u.role === 'creative_designer' && u.projects?.includes('social-media') && !u.leadId) {
        u.leadId = lead.id;
        updated  = true;
      }
    }
  }

  if (updated) { writeJson(USERS_FILE, users); console.log('Seed users initialised'); }
}

// ── Users ───────────────────────────────────────────────────────────────────

function findUserByEmail(email) {
  return readJson(USERS_FILE).find(u => u.email === email) || null;
}
function findUserById(id) {
  return readJson(USERS_FILE).find(u => u.id === id) || null;
}
function getAllUsers(filters = {}) {
  let users = readJson(USERS_FILE);
  if (filters.role)   users = users.filter(u => u.role   === filters.role);
  if (filters.leadId) users = users.filter(u => u.leadId === filters.leadId);
  return users.map(({ password, ...safe }) => safe);
}
function createUser(data) {
  const users   = readJson(USERS_FILE);
  const newUser = { id: uuidv4(), projects: [], department: '', ...data };
  users.push(newUser);
  writeJson(USERS_FILE, users);
  const { password, ...safe } = newUser;
  return safe;
}

// ── Ticket ID generation ────────────────────────────────────────────────────

function nextTicketNumber(projectId, existingRequests) {
  let max = 0;
  for (const r of existingRequests) {
    if (r.project !== projectId) continue;
    // Match parent ticket IDs like SMXC-01 or PAC-101
    const m = r.ticketId?.match(/^[A-Z]+-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

function makeTicketId(projectId, num) {
  const code   = projectId.toUpperCase();
  const padded = String(num).padStart(2, '0');
  return `${code}-${padded}`;
}

function makeChildTicketId(parentId, childIndex) {
  return `${parentId}-${String(childIndex + 1).padStart(2, '0')}`;
}

// ── Requests ────────────────────────────────────────────────────────────────

function getAllRequests(filters = {}) {
  let list = readJson(REQUESTS_FILE);

  if (filters.project)    list = list.filter(r => r.project === filters.project);
  if (filters.status)     list = list.filter(r => r.status  === filters.status);
  if (filters.assignedTo) list = list.filter(r => r.assignedTo?.id === filters.assignedTo);
  if (filters.submittedBy)list = list.filter(r => r.submittedBy?.id === filters.submittedBy);

  // projects filter: undefined = no restriction; [] = no projects assigned = return nothing
  if (filters.projects !== undefined) {
    if (!filters.projects.length) return [];
    list = list.filter(r => filters.projects.includes(r.project));
  }

  if (!filters.includeApproved) list = list.filter(r => r.status !== 'approved');

  return list.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function getRequestById(id) {
  return readJson(REQUESTS_FILE).find(r => r.id === id) || null;
}

function createRequest(data) {
  const requests  = readJson(REQUESTS_FILE);
  const now       = new Date().toISOString();
  const num       = nextTicketNumber(data.project, requests);
  const ticketId  = makeTicketId(data.project, num);

  const childIssues = (data.childIssues || []).map((child, idx) => ({
    id:            uuidv4(),
    ticketId:      makeChildTicketId(ticketId, idx),
    status:        'requested',
    statusHistory: [{ from: null, to: 'requested', changedAt: now }],
    ...child
  }));

  const { childIssues: _ci, ...rest } = data;
  const newRequest = {
    id:            uuidv4(),
    ticketId,
    status:        'requested',
    assignedTo:    null,
    comments:      [],
    statusHistory: [{ from: null, to: 'requested', changedAt: now, changedBy: data.submittedBy || null }],
    submittedAt:   now,
    ...rest,
    childIssues
  };
  requests.push(newRequest);
  writeJson(REQUESTS_FILE, requests);
  return newRequest;
}

function updateRequest(id, updates, changedBy = null) {
  const requests = readJson(REQUESTS_FILE);
  const idx      = requests.findIndex(r => r.id === id);
  if (idx === -1) return null;

  const old     = requests[idx];
  const merged  = { ...old, ...updates, updatedAt: new Date().toISOString() };

  if (updates.status && updates.status !== old.status) {
    if (!merged.statusHistory) merged.statusHistory = [];
    merged.statusHistory.push({
      from:      old.status,
      to:        updates.status,
      changedAt: new Date().toISOString(),
      changedBy: changedBy || null
    });
  }

  requests[idx] = merged;
  writeJson(REQUESTS_FILE, requests);
  return requests[idx];
}

function addComment(requestId, comment) {
  const requests = readJson(REQUESTS_FILE);
  const idx      = requests.findIndex(r => r.id === requestId);
  if (idx === -1) return null;
  if (!requests[idx].comments) requests[idx].comments = [];
  requests[idx].comments.push({
    id:       uuidv4(),
    text:     comment.text,
    postedAt: new Date().toISOString(),
    postedBy: comment.postedBy
  });
  requests[idx].updatedAt = new Date().toISOString();
  writeJson(REQUESTS_FILE, requests);
  return requests[idx];
}

function updateChildIssue(requestId, childId, updates, changedBy = null) {
  const requests = readJson(REQUESTS_FILE);
  const idx      = requests.findIndex(r => r.id === requestId);
  if (idx === -1) return null;
  const ci    = requests[idx].childIssues || [];
  const cidx  = ci.findIndex(c => c.id === childId);
  if (cidx === -1) return null;

  const oldChild = ci[cidx];
  ci[cidx] = { ...oldChild, ...updates };

  if (updates.status && updates.status !== oldChild.status) {
    if (!ci[cidx].statusHistory) ci[cidx].statusHistory = [];
    ci[cidx].statusHistory.push({
      from:      oldChild.status,
      to:        updates.status,
      changedAt: new Date().toISOString(),
      changedBy: changedBy || null
    });
  }

  // Auto-approve parent when all children are approved
  if (ci.length > 0 && ci.every(c => c.status === 'approved') && requests[idx].status !== 'approved') {
    if (!requests[idx].statusHistory) requests[idx].statusHistory = [];
    requests[idx].statusHistory.push({
      from: requests[idx].status, to: 'approved',
      changedAt: new Date().toISOString(),
      changedBy: { name: 'System (all sub-tasks approved)', role: 'system' }
    });
    requests[idx].status = 'approved';
  }

  requests[idx].updatedAt = new Date().toISOString();
  writeJson(REQUESTS_FILE, requests);
  return requests[idx];
}

function getAllLeads() {
  return readJson(USERS_FILE)
    .filter(u => u.role === 'creative_lead')
    .map(({ password, ...safe }) => safe);
}

function updateUserLead(userId, newLeadId) {
  const users = readJson(USERS_FILE);
  const idx   = users.findIndex(u => u.id === userId);
  if (idx === -1) return null;
  const lead = users.find(u => u.id === newLeadId);
  users[idx].leadId     = newLeadId;
  users[idx].projects   = lead?.projects   || users[idx].projects;
  users[idx].department = lead?.department || users[idx].department;
  writeJson(USERS_FILE, users);
  const { password, ...safe } = users[idx];
  return safe;
}

module.exports = {
  initStorage,
  findUserByEmail, findUserById, getAllUsers, getAllLeads, createUser, updateUserLead,
  getAllRequests, getRequestById, createRequest, updateRequest,
  addComment, updateChildIssue
};
