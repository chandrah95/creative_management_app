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

  // Remove any stale seed account with old project-format IDs that may have been injected
  const staleEmails = ['andhika@company.com'];
  const before = users.length;
  users = users.filter(u => {
    if (!staleEmails.includes(u.email)) return true;
    // Keep the account only if it uses current project IDs (not old form-template IDs)
    const oldIds = ['social-media','digital-marketing','print-offline','brand-identity','video-animation','web-ui-design'];
    const hasOldIds = (u.projects || []).some(p => oldIds.includes(p));
    return !hasOldIds;
  });
  if (users.length !== before) updated = true;

  // Ensure admin has the correct project list
  const admin = users.find(u => u.role === 'admin');
  if (admin) {
    const currentIds = ['ebxc','plxc','smxc','daxc','ocsp','pac','studio'];
    const needsUpdate = !admin.projects?.length || admin.projects.some(p => !currentIds.includes(p));
    if (needsUpdate) {
      admin.projects   = currentIds;
      admin.department = 'Administration';
      updated = true;
    }
  }

  // Core accounts — plain-text passwords for dev, only added if missing
  const seeds = [
    { email:'andhika.zefanya@astronauts.id', password:'lead123',    name:'Andhika Zefanya', role:'creative_lead',     projects:['ebxc','plxc','smxc','daxc','studio'], department:'In App & Out App 1 & Studio' },
    { email:'vellindia@company.com',          password:'lead123',    name:'Vellindia',       role:'creative_lead',     projects:['ocsp','pac'],                         department:'Out App 2' },
    { email:'designer1@company.com',          password:'design123',  name:'Designer One',    role:'creative_designer', projects:['ebxc','plxc','smxc','daxc','studio'], department:'In App & Out App 1 & Studio' },
    { email:'designer2@company.com',          password:'design123',  name:'Designer Two',    role:'creative_designer', projects:['ebxc','plxc','smxc','daxc','studio'], department:'In App & Out App 1 & Studio' },
    { email:'chandra.hermawan@astronauts.id', password:'design123',  name:'Chandra Hermawan',role:'creative_designer', projects:['ebxc','plxc','smxc','daxc','studio'], department:'In App & Out App 1 & Studio' },
    { email:'requester@company.com',          password:'request123', name:'Requester One',   role:'requester',         projects:[], department:'' },
    { email:'requester2@company.com',         password:'request123', name:'Requester Two',   role:'requester',         projects:[], department:'' }
  ];

  for (const seed of seeds) {
    if (!users.find(u => u.email === seed.email)) {
      users.push({ id: uuidv4(), ...seed });
      updated = true;
    }
  }

  // Link designers to Andhika Zefanya if they have no lead yet
  const azLead = users.find(u => u.email === 'andhika.zefanya@astronauts.id');
  if (azLead) {
    const azDesignerEmails = ['designer1@company.com','designer2@company.com','chandra.hermawan@astronauts.id'];
    for (const u of users) {
      if (u.role === 'creative_designer' && azDesignerEmails.includes(u.email) && !u.leadId) {
        u.leadId = azLead.id;
        updated  = true;
      }
    }
  }

  if (updated) { writeJson(USERS_FILE, users); console.log('[seed] Users initialised/cleaned'); }
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

  // Single-project filter ('studio' is a virtual project — match tickets with studio child issues)
  if (filters.project) {
    if (filters.project === 'studio') {
      list = list.filter(r => r.childIssues?.some(c => c.is_need_studio === true));
    } else {
      list = list.filter(r => r.project === filters.project);
    }
  }

  if (filters.status)     list = list.filter(r => r.status  === filters.status);
  if (filters.assignedTo) list = list.filter(r =>
    r.assignedTo?.id === filters.assignedTo ||
    (r.childIssues || []).some(c => c.assignedTo?.id === filters.assignedTo)
  );
  if (filters.submittedBy)list = list.filter(r => r.submittedBy?.id === filters.submittedBy);

  // projects (plural) filter for creative leads
  // 'studio' is a client-side view-filter on the lead's own pool — it never
  // grants access to tickets outside the lead's regular projects.
  if (filters.projects !== undefined) {
    const regularProjects = filters.projects.filter(p => p !== 'studio');

    if (!regularProjects.length) return [];

    list = list.filter(r => regularProjects.includes(r.project));
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
  const commentObj = {
    id:       uuidv4(),
    text:     comment.text,
    postedAt: new Date().toISOString(),
    postedBy: comment.postedBy
  };
  if (comment.imageData) commentObj.imageData = comment.imageData;
  requests[idx].comments.push(commentObj);
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

  // Recalculate parent story points from all child SPs after any child update
  const hasAnySP = ci.some(c => c.storyPoints != null);
  requests[idx].storyPoints = hasAnySP
    ? ci.reduce((sum, c) => sum + (c.storyPoints || 0), 0)
    : null;

  // Re-derive parent assignedTo from child assignees:
  // non-studio children take priority; most-frequent assignee among them wins.
  // If all children are studio, the studio designer becomes the parent assignee.
  const assignedChildren = ci.filter(c => c.assignedTo?.id);
  if (assignedChildren.length > 0) {
    const nonStudio = assignedChildren.filter(c => !c.is_need_studio);
    const pool      = nonStudio.length > 0 ? nonStudio : assignedChildren;
    const freq = {};
    for (const c of pool) {
      const k = c.assignedTo.id;
      if (!freq[k]) freq[k] = { assignedTo: c.assignedTo, count: 0 };
      freq[k].count++;
    }
    const winner = Object.values(freq).sort((a, b) => b.count - a.count)[0];
    requests[idx].assignedTo = winner?.assignedTo || null;
  } else {
    requests[idx].assignedTo = null;
  }

  // Auto-set parent status = minimum (earliest workflow position) of all child statuses
  if (ci.length > 0) {
    const STATUS_RANK = {
      requested: 0, in_progress: 1, on_review: 2,
      need_revision: 3, revision: 4, revised: 5, approved: 6
    };
    const minStatus = ci.reduce((min, c) =>
      (STATUS_RANK[c.status] ?? 99) < (STATUS_RANK[min] ?? 99) ? c.status : min,
      ci[0].status
    );
    if (minStatus !== requests[idx].status) {
      if (!requests[idx].statusHistory) requests[idx].statusHistory = [];
      requests[idx].statusHistory.push({
        from:      requests[idx].status,
        to:        minStatus,
        changedAt: new Date().toISOString(),
        changedBy: { name: 'System (auto from sub-tasks)', role: 'system' }
      });
      requests[idx].status = minStatus;
    }
  }

  requests[idx].updatedAt = new Date().toISOString();
  writeJson(REQUESTS_FILE, requests);
  return requests[idx];
}

function updateUser(userId, updates) {
  const users = readJson(USERS_FILE);
  const idx   = users.findIndex(u => u.id === userId);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...updates };
  writeJson(USERS_FILE, users);
  const { password, ...safe } = users[idx];
  return safe;
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
  findUserByEmail, findUserById, getAllUsers, getAllLeads, createUser, updateUserLead, updateUser,
  getAllRequests, getRequestById, createRequest, updateRequest,
  addComment, updateChildIssue
};
