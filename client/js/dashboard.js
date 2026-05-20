import '/js/api.js';

// ── State ──────────────────────────────────────────────────────────────────

let currentUser = null;
let projects    = [];
let tickets     = [];
let teamMembers = [];
let allLeads    = [];

const STATUS_LABELS = {
  requested:     'Requested',
  in_progress:   'In Progress',
  on_review:     'On Review',
  need_revision: 'Need Revision',
  revision:      'Revision',
  revised:       'Revised',
  approved:      'Approved'
};

const ROLE_LABELS = {
  admin:             'Administrator',
  creative_lead:     'Creative Lead',
  creative_designer: 'Creative Designer',
  requester:         'Requester'
};

// Strict linear transitions — designer moves forward, lead reviews
const DESIGNER_NEXT = {
  requested:     ['in_progress'],
  in_progress:   ['on_review'],
  need_revision: ['revision'],
  revision:      ['revised']
};

const LEAD_NEXT = {
  on_review: ['need_revision', 'approved'],
  revised:   ['need_revision', 'approved']
};

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function init() {
  const raw = localStorage.getItem('crp_user') || sessionStorage.getItem('crp_user');
  if (!raw) return;
  currentUser = JSON.parse(raw);

  document.getElementById('userName').textContent   = currentUser.name;
  document.getElementById('userAvatar').textContent = currentUser.name[0].toUpperCase();
  document.getElementById('userRole').textContent   = ROLE_LABELS[currentUser.role] || currentUser.role;

  const chip = document.getElementById('roleChip');
  chip.textContent = ROLE_LABELS[currentUser.role] || currentUser.role;
  chip.className   = `role-chip role-${currentUser.role}`;

  try {
    const { data } = await window.api.get('/api/forms/projects');
    projects = data;
  } catch {}

  buildSidebar();

  if (currentUser.role === 'creative_lead' || currentUser.role === 'admin') {
    try {
      const [membersRes, leadsRes] = await Promise.all([
        window.api.get('/api/requests/team-members'),
        window.api.get('/api/users/leads')
      ]);
      teamMembers = membersRes.data;
      allLeads    = leadsRes.data.filter(l => l.id !== currentUser.id);
    } catch {}
  }

  await loadTickets();
}

function buildSidebar() {
  const nav = document.getElementById('sidebarNav');
  const canRequest = currentUser.role === 'requester' || currentUser.role === 'admin';
  nav.innerHTML = `
    <a class="project-nav-item active" href="/dashboard">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      <span class="project-nav-label">My Dashboard</span>
    </a>
    ${canRequest ? `<a class="project-nav-item" href="/form">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      <span class="project-nav-label">New Request</span>
    </a>` : ''}`;
}

async function loadTickets() {
  document.getElementById('contentArea').innerHTML = '<div class="loading-state">Loading…</div>';
  try {
    const { data } = await window.api.get('/api/requests');
    tickets = data;
    renderView();
  } catch {
    document.getElementById('contentArea').innerHTML = '<div class="loading-state">Failed to load tickets.</div>';
  }
}

// ── View Router ────────────────────────────────────────────────────────────

function renderView() {
  const role = currentUser.role;
  if (role === 'requester')          renderRequesterView();
  else if (role === 'creative_designer') renderDesignerView();
  else                                renderLeadView();
}

// ── Requester View ─────────────────────────────────────────────────────────

function renderRequesterView() {
  document.getElementById('pageTitle').textContent = 'My Requests';
  document.getElementById('topBarRight').innerHTML = `<a href="/form" class="btn btn-primary">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
    New Request</a>`;

  const area = document.getElementById('contentArea');
  if (!tickets.length) { area.innerHTML = emptyState('No requests yet', 'Submit your first creative request.', '/form', 'New Request'); return; }

  const total = tickets.length;
  const pend  = tickets.filter(t => t.status === 'requested').length;
  const act   = tickets.filter(t => !['approved'].includes(t.status)).length;
  const appr  = tickets.filter(t => t.status === 'approved').length;

  area.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
      ${statCard(total,'Total Requests')}${statCard(pend,'Pending')}${statCard(act,'Active')}${statCard(appr,'Approved')}
    </div>
    <div class="ticket-list" id="ticketList"></div>`;

  tickets.forEach(t => document.getElementById('ticketList').insertAdjacentHTML('beforeend', requesterBubble(t)));
}

function requesterBubble(t) {
  const proj  = projects.find(p => p.id === t.project);
  const title = t.fields?.title || '(no title)';
  return `
    <div class="ticket-bubble" onclick="openTicketModal('${t.id}')">
      <div class="ticket-bubble-main">
        <div class="ticket-bubble-left">
          <div>
            ${t.ticketId ? `<span class="ticket-id-badge">${escHtml(t.ticketId)}</span>` : ''}
            <span class="ticket-title">${escHtml(title)}</span>
          </div>
          <div class="ticket-meta">
            ${proj ? `<span class="meta-tag" style="color:${proj.color}">${proj.name}</span>` : ''}
            ${t.fields?.priority ? `<span class="meta-tag">Priority: ${cap(t.fields.priority)}</span>` : ''}
            ${t.fields?.deadline ? `<span class="meta-tag">Due: ${fmtDate(t.fields.deadline)}</span>` : ''}
          </div>
        </div>
        <div class="ticket-bubble-right">
          <span class="status-badge status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
          <span class="view-link">View →</span>
        </div>
      </div>
    </div>`;
}

// ── Designer View ──────────────────────────────────────────────────────────

function renderDesignerView() {
  document.getElementById('pageTitle').textContent = 'My Assigned Tickets';
  document.getElementById('topBarRight').innerHTML = '';

  const area = document.getElementById('contentArea');
  if (!tickets.length) { area.innerHTML = emptyState('No tickets assigned', 'Your creative lead will assign tickets to you shortly.'); return; }

  const inP = tickets.filter(t => t.status === 'in_progress').length;
  const att = tickets.filter(t => ['need_revision','revision','revised'].includes(t.status)).length;

  area.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
      ${statCard(tickets.length,'Active Tickets')}${statCard(inP,'In Progress')}${statCard(att,'Needs Attention')}
    </div>
    <p class="section-hint">Click ▶ to expand sub-tasks. Click Details to view discussion.</p>
    <div class="ticket-list" id="ticketList"></div>`;

  tickets.forEach(t => document.getElementById('ticketList').insertAdjacentHTML('beforeend', designerBubble(t)));
}

function designerBubble(t) {
  const proj         = projects.find(p => p.id === t.project);
  const title        = t.fields?.title || '(no title)';
  const status       = t.status;
  const hasChildren  = t.childIssues?.length > 0;
  const nextStatuses = DESIGNER_NEXT[status] || [];

  const childrenHtml = hasChildren ? `
    <div class="ticket-children" id="children-${t.id}" style="display:none">
      <div class="children-label">Sub-tasks</div>
      ${t.childIssues.map(c => childRow(t.id, c)).join('')}
    </div>` : '';

  const statusActions = nextStatuses.length ? `
    <div class="ticket-actions">
      <span class="action-label">Move to:</span>
      ${nextStatuses.map(s => `<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();changeStatus('${t.id}','${s}')">${STATUS_LABELS[s]}</button>`).join('')}
    </div>` : '';

  return `
    <div class="ticket-bubble${hasChildren ? ' has-children' : ''}" id="bubble-${t.id}">
      <div class="ticket-bubble-main" onclick="toggleChildren('${t.id}',${hasChildren})">
        <div class="ticket-bubble-left">
          ${hasChildren ? `<button class="toggle-arrow" id="arrow-${t.id}" onclick="event.stopPropagation();toggleChildren('${t.id}',true)">▶</button>` : '<span class="toggle-placeholder"></span>'}
          <div>
            ${t.ticketId ? `<span class="ticket-id-badge">${escHtml(t.ticketId)}</span>` : ''}
            <span class="ticket-title">${escHtml(title)}</span>
            <div class="ticket-meta">
              ${proj ? `<span class="meta-tag" style="color:${proj.color}">${proj.name}</span>` : ''}
              ${t.fields?.priority ? `<span class="meta-tag">Priority: ${cap(t.fields.priority)}</span>` : ''}
              ${t.fields?.deadline ? `<span class="meta-tag">Due: ${fmtDate(t.fields.deadline)}</span>` : ''}
              ${hasChildren ? `<span class="meta-tag">${t.childIssues.length} sub-task${t.childIssues.length > 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="ticket-bubble-right">
          <span class="status-badge status-${status}">${STATUS_LABELS[status] || status}</span>
          <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();openTicketModal('${t.id}')">Details</button>
        </div>
      </div>
      ${statusActions}
      ${childrenHtml}
    </div>`;
}

window.toggleChildren = function (ticketId, hasChildren) {
  if (!hasChildren) { openTicketModal(ticketId); return; }
  const el = document.getElementById(`children-${ticketId}`);
  const ar = document.getElementById(`arrow-${ticketId}`);
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display  = open ? 'block' : 'none';
  if (ar) ar.textContent = open ? '▼' : '▶';
};

// ── Lead View ──────────────────────────────────────────────────────────────

function renderLeadView() {
  document.getElementById('pageTitle').textContent = 'Team Tickets';
  document.getElementById('topBarRight').innerHTML = '';

  const area       = document.getElementById('contentArea');
  const unassigned = tickets.filter(t => !t.assignedTo);

  const assigneeMap = new Map(teamMembers.map(m => [m.id, m]));
  tickets.forEach(t => { if (t.assignedTo && !assigneeMap.has(t.assignedTo.id)) assigneeMap.set(t.assignedTo.id, t.assignedTo); });
  const allAssignees = Array.from(assigneeMap.values());

  const total = tickets.length;
  const unas  = unassigned.length;
  const inP   = tickets.filter(t => t.status === 'in_progress').length;
  const rev   = tickets.filter(t => t.status === 'on_review' || t.status === 'revised').length;

  area.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
      ${statCard(total,'Total Tickets')}${statCard(unas,'Unassigned',unas>0?'danger':'')}${statCard(inP,'In Progress')}${statCard(rev,'Needs Review')}
    </div>

    ${teamMembers.length ? `
    <div class="team-section">
      <div class="team-section-header" onclick="toggleTeamSection()">
        <span>My Team <span class="team-count">${teamMembers.length}</span></span>
        <svg id="teamArrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="team-section-body" id="teamSectionBody" style="display:none">
        ${teamMembers.map(m => `
          <div class="team-member-row">
            <div class="team-member-info">
              <span class="team-member-avatar">${m.name[0].toUpperCase()}</span>
              <div>
                <div class="team-member-name">${escHtml(m.name)}</div>
                <div class="team-member-dept">${escHtml(m.email)}</div>
              </div>
            </div>
            ${allLeads.length ? `<div class="team-member-actions" onclick="event.stopPropagation()">
              <select class="assign-select" onchange="transferDesigner('${m.id}',this)">
                <option value="">Transfer to another lead…</option>
                ${allLeads.map(l => `<option value="${l.id}">${escHtml(l.name)}${l.department ? ' · '+escHtml(l.department) : ''}</option>`).join('')}
              </select>
            </div>` : ''}
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="table-toolbar">
      <div class="filter-group">
        <select id="filterProject" class="filter-select" onchange="filterLeadTickets()">
          <option value="">All Projects</option>
          ${projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
        <select id="filterStatus" class="filter-select" onchange="filterLeadTickets()">
          <option value="">All Statuses</option>
          ${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <select id="filterAssignee" class="filter-select" onchange="filterLeadTickets()">
          <option value="">All Assignees</option>
          <option value="__unassigned__">— Unassigned —</option>
          ${allAssignees.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
        </select>
      </div>
    </div>
    ${unas ? `<div class="alert alert-warning" style="margin-bottom:16px">⚠ ${unas} unassigned ticket${unas>1?'s':''} — use the assign dropdown on each ticket.</div>` : ''}
    <div class="ticket-list" id="ticketList"></div>`;

  renderLeadTickets(tickets);
}

window.toggleTeamSection = function () {
  const body  = document.getElementById('teamSectionBody');
  const arrow = document.getElementById('teamArrow');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display      = open ? 'block' : 'none';
  if (arrow) arrow.style.transform = open ? 'rotate(180deg)' : '';
};

window.filterLeadTickets = function () {
  const proj     = document.getElementById('filterProject')?.value;
  const status   = document.getElementById('filterStatus')?.value;
  const assignee = document.getElementById('filterAssignee')?.value;
  let filtered   = tickets;
  if (proj)    filtered = filtered.filter(t => t.project === proj);
  if (status)  filtered = filtered.filter(t => t.status  === status);
  if (assignee === '__unassigned__') filtered = filtered.filter(t => !t.assignedTo);
  else if (assignee) filtered = filtered.filter(t => t.assignedTo?.id === assignee);
  renderLeadTickets(filtered);
};

function renderLeadTickets(list) {
  const listEl = document.getElementById('ticketList');
  if (!listEl) return;
  listEl.innerHTML = list.length
    ? list.map(t => leadBubble(t)).join('')
    : '<div class="empty-list">No tickets match the selected filters.</div>';
}

function leadBubble(t) {
  const proj         = projects.find(p => p.id === t.project);
  const title        = t.fields?.title || '(no title)';
  const status       = t.status;
  const nextStatuses = LEAD_NEXT[status] || [];
  const hasChildren  = t.childIssues?.length > 0;

  const assigneeHtml = t.assignedTo
    ? `<span class="assignee-tag">${escHtml(t.assignedTo.name)}</span>`
    : `<span class="unassigned-tag">Unassigned</span>`;

  // Single dropdown — "Unassigned" option doubles as the unassign action
  const assignRow = teamMembers.length ? `
    <div class="assign-row" onclick="event.stopPropagation()">
      <label class="assign-label">Assign:</label>
      <select class="assign-select assign-bold" onchange="assignFromSelect('${t.id}',this)">
        <option value="">— Unassigned —</option>
        ${teamMembers.map(m => `<option value="${m.id}" ${t.assignedTo?.id === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}
      </select>
    </div>` : '';

  const statusActions = nextStatuses.length ? `
    <div class="ticket-actions" onclick="event.stopPropagation()">
      <span class="action-label">Move to:</span>
      ${nextStatuses.map(s => `<button class="btn btn-sm btn-outline" onclick="changeStatus('${t.id}','${s}')">${STATUS_LABELS[s]}</button>`).join('')}
    </div>` : '';

  const childrenHtml = hasChildren ? `
    <div class="ticket-children" id="children-${t.id}" style="display:none">
      <div class="children-label">Sub-tasks (${t.childIssues.filter(c=>c.status==='approved').length}/${t.childIssues.length} approved)</div>
      ${t.childIssues.map(c => childRow(t.id, c)).join('')}
    </div>` : '';

  return `
    <div class="ticket-bubble${hasChildren?' has-children':''}" id="bubble-${t.id}">
      <div class="ticket-bubble-main" onclick="openTicketModal('${t.id}')">
        <div class="ticket-bubble-left">
          ${hasChildren ? `<button class="toggle-arrow" id="arrow-${t.id}" onclick="event.stopPropagation();toggleLeadChildren('${t.id}')">▶</button>` : '<span class="toggle-placeholder"></span>'}
          <div>
            ${t.ticketId ? `<span class="ticket-id-badge">${escHtml(t.ticketId)}</span>` : ''}
            <span class="ticket-title">${escHtml(title)}</span>
            <div class="ticket-meta">
              ${proj ? `<span class="meta-tag" style="color:${proj.color}">${proj.name}</span>` : ''}
              ${t.fields?.priority ? `<span class="meta-tag">Priority: ${cap(t.fields.priority)}</span>` : ''}
              ${t.fields?.deadline ? `<span class="meta-tag">Due: ${fmtDate(t.fields.deadline)}</span>` : ''}
              ${assigneeHtml}
            </div>
          </div>
        </div>
        <div class="ticket-bubble-right">
          <span class="status-badge status-${status}">${STATUS_LABELS[status]||status}</span>
          <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();openTicketModal('${t.id}')">Details</button>
        </div>
      </div>
      ${assignRow}
      ${statusActions}
      ${childrenHtml}
    </div>`;
}

window.toggleLeadChildren = function (id) {
  const el = document.getElementById(`children-${id}`);
  const ar = document.getElementById(`arrow-${id}`);
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? 'block' : 'none';
  if (ar) ar.textContent = open ? '▼' : '▶';
};

// ── Child row (shared) ─────────────────────────────────────────────────────

function childRow(ticketId, c) {
  const sel = childStatusSelect(ticketId, c);
  return `
    <div class="child-item">
      <span class="child-dot"></span>
      ${c.ticketId ? `<span class="ticket-id-badge ticket-id-sm">${escHtml(c.ticketId)}</span>` : ''}
      <span class="child-title">${escHtml(c.child_title || '—')}</span>
      <span class="child-due">${c.child_due ? fmtDate(c.child_due) : ''}</span>
      <span class="status-badge status-${c.status} status-sm">${STATUS_LABELS[c.status]||c.status}</span>
      ${sel}
    </div>`;
}

// Linear child status — only shows valid next step(s) for current role
function childNextStatuses(currentStatus, role) {
  if (role === 'creative_designer') return DESIGNER_NEXT[currentStatus] || [];
  if (role === 'creative_lead')     return LEAD_NEXT[currentStatus]     || [];
  if (role === 'admin') return [...(DESIGNER_NEXT[currentStatus]||[]), ...(LEAD_NEXT[currentStatus]||[])];
  return [];
}

function childStatusSelect(ticketId, c) {
  const next = childNextStatuses(c.status, currentUser.role);
  if (!next.length) return '';
  const opts = [`<option value="" disabled selected>Move to…</option>`,
    ...next.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`)].join('');
  return `<select class="child-status-select" onchange="event.stopPropagation();changeChildStatus('${ticketId}','${c.id}',this.value)">${opts}</select>`;
}

function childStatusSelectModal(ticketId, c) {
  const next = childNextStatuses(c.status, currentUser.role);
  if (!next.length) return '';
  const opts = [`<option value="" disabled selected>Move to…</option>`,
    ...next.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`)].join('');
  return `<select class="child-status-select" onchange="changeChildStatusModal('${ticketId}','${c.id}',this.value)">${opts}</select>`;
}

// ── Ticket Modal ───────────────────────────────────────────────────────────

window.openTicketModal = async function (id) {
  const modal = document.getElementById('ticketModal');
  document.getElementById('modalContent').innerHTML = '<div class="loading-state">Loading…</div>';
  modal.style.display = 'flex';
  try {
    const { data: t } = await window.api.get(`/api/requests/${id}`);
    document.getElementById('modalContent').innerHTML = buildModalContent(t);
  } catch (err) {
    document.getElementById('modalContent').innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
};

function buildModalContent(t) {
  const proj   = projects.find(p => p.id === t.project);
  const title  = t.fields?.title || '(no title)';
  const role   = currentUser.role;
  const status = t.status;

  const nextStatuses = (role === 'creative_lead' || role === 'admin') ? (LEAD_NEXT[status]||[]) : (DESIGNER_NEXT[status]||[]);
  const statusSection = (nextStatuses.length && role !== 'requester') ? `
    <div class="modal-section">
      <div class="modal-section-title">Move Status</div>
      <div class="status-actions">
        ${nextStatuses.map(s => `<button class="btn btn-outline btn-sm" onclick="changeStatusModal('${t.id}','${s}')">${STATUS_LABELS[s]}</button>`).join('')}
      </div>
    </div>` : '';

  const assignSection = ((role === 'creative_lead' || role === 'admin') && teamMembers.length) ? `
    <div class="modal-section">
      <div class="modal-section-title">Assignment</div>
      <div class="assign-row">
        <select class="assign-select assign-bold" onchange="assignTicketModal('${t.id}',this)">
          <option value="">— Unassigned —</option>
          ${teamMembers.map(m => `<option value="${m.id}" ${t.assignedTo?.id===m.id?'selected':''}>${m.name}</option>`).join('')}
        </select>
      </div>
    </div>` : '';

  const childSection = t.childIssues?.length ? `
    <div class="modal-section">
      <div class="modal-section-title">Sub-tasks (${t.childIssues.filter(c=>c.status==='approved').length}/${t.childIssues.length} approved)</div>
      <div class="modal-children">
        ${t.childIssues.map(c => `
          <div class="modal-child-item">
            <div class="modal-child-main">
              ${c.ticketId ? `<span class="ticket-id-badge ticket-id-sm">${escHtml(c.ticketId)}</span>` : ''}
              <span class="child-title">${escHtml(c.child_title||'—')}</span>
              ${c.child_due ? `<span class="child-due">Due: ${fmtDate(c.child_due)}</span>` : ''}
              <span class="status-badge status-${c.status} status-sm">${STATUS_LABELS[c.status]||c.status}</span>
            </div>
            ${c.child_notes ? `<p class="child-notes">${escHtml(c.child_notes)}</p>` : ''}
            ${role !== 'requester' ? childStatusSelectModal(t.id, c) : ''}
          </div>`).join('')}
      </div>
    </div>` : '';

  const commentsHtml = (t.comments||[]).length
    ? t.comments.map(c => `
        <div class="comment-item">
          <div class="comment-header">
            <span class="comment-author">${escHtml(c.postedBy.name)}</span>
            <span class="role-chip role-${c.postedBy.role} role-chip-sm">${ROLE_LABELS[c.postedBy.role]||c.postedBy.role}</span>
            <span class="comment-time">${fmtDatetime(c.postedAt)}</span>
          </div>
          <p class="comment-text">${escHtml(c.text)}</p>
        </div>`).join('')
    : '<p class="no-comments">No comments yet.</p>';

  return `
    <div class="modal-header">
      <div class="modal-header-top">
        ${proj ? `<span class="meta-tag" style="color:${proj.color};font-weight:700">${proj.name}</span>` : ''}
        <span class="status-badge status-${status}">${STATUS_LABELS[status]||status}</span>
      </div>
      ${t.ticketId ? `<div class="modal-ticket-id">${escHtml(t.ticketId)}</div>` : ''}
      <h2 class="modal-title">${escHtml(title)}</h2>
      <div class="ticket-meta" style="margin-top:8px">
        ${t.fields?.priority ? `<span class="meta-tag">Priority: ${cap(t.fields.priority)}</span>` : ''}
        ${t.fields?.deadline ? `<span class="meta-tag">Deadline: ${fmtDate(t.fields.deadline)}</span>` : ''}
        <span class="meta-tag">By: ${escHtml(t.submittedBy?.name||'—')}</span>
        ${t.assignedTo ? `<span class="meta-tag">Assigned: ${escHtml(t.assignedTo.name)}</span>` : '<span class="unassigned-tag">Unassigned</span>'}
        <span class="meta-tag">Submitted: ${fmtDate(t.submittedAt)}</span>
      </div>
    </div>
    ${t.fields?.description ? `<div class="modal-section"><div class="modal-section-title">Description</div><p class="modal-text">${escHtml(t.fields.description)}</p></div>` : ''}
    ${t.fields?.notes ? `<div class="modal-section"><div class="modal-section-title">Notes</div><p class="modal-text">${escHtml(t.fields.notes)}</p></div>` : ''}
    ${statusSection}${assignSection}${childSection}
    ${buildStatusHistory(t)}
    <div class="modal-section">
      <div class="modal-section-title">Discussion</div>
      <div class="comments-list">${commentsHtml}</div>
      <div class="comment-form">
        <textarea id="commentInput" class="comment-textarea" placeholder="Add a comment…" rows="3"></textarea>
        <button class="btn btn-primary btn-sm" onclick="postComment('${t.id}')">Post Comment</button>
      </div>
    </div>`;
}

window.closeTicketModal = function () { document.getElementById('ticketModal').style.display = 'none'; };
window.closeModal = function (e) { if (e.target === document.getElementById('ticketModal')) closeTicketModal(); };

// ── Actions ────────────────────────────────────────────────────────────────

window.changeStatus = async function (id, status) {
  try { await window.api.put(`/api/requests/${id}`, { status }); await loadTickets(); }
  catch (err) { alert(err.message); }
};

window.changeStatusModal = async function (id, status) {
  try { const { data } = await window.api.put(`/api/requests/${id}`, { status }); document.getElementById('modalContent').innerHTML = buildModalContent(data); await loadTickets(); }
  catch (err) { alert(err.message); }
};

window.changeChildStatus = async function (ticketId, childId, status) {
  try { await window.api.put(`/api/requests/${ticketId}/children/${childId}`, { status }); await loadTickets(); }
  catch (err) { alert(err.message); }
};

window.changeChildStatusModal = async function (ticketId, childId, status) {
  try { const { data } = await window.api.put(`/api/requests/${ticketId}/children/${childId}`, { status }); document.getElementById('modalContent').innerHTML = buildModalContent(data); await loadTickets(); }
  catch (err) { alert(err.message); }
};

// Shared assign handler: empty value = unassign
window.assignFromSelect = async function (ticketId, sel) {
  const id       = sel.value;
  const assignedTo = id ? (() => { const m = teamMembers.find(x => x.id === id); return m ? { id: m.id, name: m.name, email: m.email } : null; })() : null;
  try { await window.api.put(`/api/requests/${ticketId}`, { assignedTo }); await loadTickets(); }
  catch (err) { alert(err.message); sel.value = ''; }
};

window.assignTicketModal = async function (ticketId, sel) {
  const id       = sel.value;
  const assignedTo = id ? (() => { const m = teamMembers.find(x => x.id === id); return m ? { id: m.id, name: m.name, email: m.email } : null; })() : null;
  try { const { data } = await window.api.put(`/api/requests/${ticketId}`, { assignedTo }); document.getElementById('modalContent').innerHTML = buildModalContent(data); await loadTickets(); }
  catch (err) { alert(err.message); }
};

window.transferDesigner = async function (designerId, sel) {
  const newLeadId = sel.value;
  if (!newLeadId) return;
  const lead = allLeads.find(l => l.id === newLeadId);
  if (!confirm(`Transfer ${sel.closest('.team-member-row')?.querySelector('.team-member-name')?.textContent} to ${lead?.name}?`)) { sel.value = ''; return; }
  try {
    await window.api.put(`/api/users/${designerId}/lead`, { leadId: newLeadId });
    teamMembers = teamMembers.filter(m => m.id !== designerId);
    renderView();
  } catch (err) { alert(err.message); sel.value = ''; }
};

window.postComment = async function (ticketId) {
  const input = document.getElementById('commentInput');
  const text  = input?.value?.trim();
  if (!text) return;
  try { const { data } = await window.api.post(`/api/requests/${ticketId}/comments`, { text }); document.getElementById('modalContent').innerHTML = buildModalContent(data); }
  catch (err) { alert(err.message); }
};

// ── Helpers ────────────────────────────────────────────────────────────────

function buildStatusHistory(t) {
  const history = t.statusHistory || [];
  if (!history.length) return '';
  return `<div class="modal-section">
    <div class="modal-section-title">Status History</div>
    <div class="status-history">
      ${history.map(h => `
        <div class="history-row">
          <span class="history-from">${h.from ? (STATUS_LABELS[h.from]||h.from) : 'Created'}</span>
          <span class="history-arrow">→</span>
          <span class="history-to status-badge status-${h.to} status-sm">${STATUS_LABELS[h.to]||h.to}</span>
          <span class="history-meta">${fmtDatetime(h.changedAt)}${h.changedBy?.name ? ' · '+escHtml(h.changedBy.name) : ''}</span>
        </div>`).join('')}
    </div>
  </div>`;
}

function statCard(value, label, variant) {
  return `<div class="stat-card${variant ? ' stat-card-'+variant : ''}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function emptyState(title, msg, link, linkLabel) {
  return `<div class="empty-state-full"><div class="empty-icon">📭</div><h3>${title}</h3><p>${msg}</p>${link ? `<a href="${link}" class="btn btn-primary" style="margin-top:16px">${linkLabel}</a>` : ''}</div>`;
}

function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d) ? str : d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function fmtDatetime(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d) ? str : d.toLocaleDateString('en-GB', { day:'numeric', month:'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

function cap(str) { return str ? str[0].toUpperCase() + str.slice(1) : str; }

init();
