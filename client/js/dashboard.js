import '/js/api.js';

// ── State ──────────────────────────────────────────────────────────────────

let currentUser         = null;
let projects            = [];
let tickets             = [];
let teamMembers         = [];
let allLeads            = [];
let pendingCommentImage  = null;
let currentModalTicket  = null;
let childDiscTicketId   = null;
let childDiscChildId    = null;
let pendingChildDiscImg = null;
let donutChartInstance   = null;
let subtaskFilterActive  = false;
let requesterActiveTab   = 'mine';  // 'mine' | 'queue'
let queueTickets         = [];
let barChartInstance    = null;
let statusChartInstance = null;

// Cross-filter: set by clicking a chart element; each filters the other charts + ticket list
let crossFilter = { designerId: null, statusKey: null };
let donutMode   = 'tasks'; // 'tasks' | 'subtasks'

// Chart axis descriptors — populated in initCharts(), used by update functions
let donutEntries = []; // [[designerId, {name,...}], ...]
let barEntries   = []; // [[designerId, {name,...}], ...]
let statusKeys   = []; // ['requested','in_progress',...]
let donutColors  = []; // parallel to donutEntries
let barColors    = []; // parallel to barEntries

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

const PRIORITY_OPTIONS = [
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' }
];

const CHART_COLORS = [
  '#6366f1','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6'
];

const STATUS_CHART_COLORS = {
  requested:     { bg: 'rgba(139,92,246,0.25)',  border: '#5b21b6' },
  in_progress:   { bg: 'rgba(59,130,246,0.25)',  border: '#1e40af' },
  on_review:     { bg: 'rgba(245,158,11,0.25)',  border: '#92400e' },
  need_revision: { bg: 'rgba(239,68,68,0.25)',   border: '#991b1b' },
  revision:      { bg: 'rgba(249,115,22,0.25)',  border: '#9a3412' },
  revised:       { bg: 'rgba(20,184,166,0.25)',  border: '#065f46' },
  approved:      { bg: 'rgba(16,185,129,0.25)',  border: '#166534' }
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// ── Sort state (per-view, persists across filter changes) ──────────────────
let sortLead     = 'date_desc';
let sortDesigner = 'date_desc';
let sortMine     = 'date_desc';
let sortQueue    = 'date_desc';

const SORT_OPTIONS = [
  { value: 'date_desc',    label: 'Newest first' },
  { value: 'date_asc',     label: 'Oldest first' },
  { value: 'priority',     label: 'Priority level' },
  { value: 'sp_desc',      label: 'Story points ↓' },
  { value: 'sp_asc',       label: 'Story points ↑' },
  { value: 'updated_desc', label: 'Recently edited' },
  { value: 'updated_asc',  label: 'Least recently edited' }
];

function sortSelectHtml(id, currentVal, onchange) {
  const opts = SORT_OPTIONS.map(o =>
    `<option value="${o.value}"${o.value === currentVal ? ' selected' : ''}>${o.label}</option>`
  ).join('');
  return `<select id="${id}" class="filter-select sort-select" onchange="${onchange}">${opts}</select>`;
}

function sortTickets(list, key = 'date_desc') {
  const arr = [...list];
  switch (key) {
    case 'date_asc':
      return arr.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
    case 'priority':
      return arr.sort((a, b) => (PRIORITY_ORDER[a.fields?.priority] ?? 4) - (PRIORITY_ORDER[b.fields?.priority] ?? 4));
    case 'sp_desc':
      return arr.sort((a, b) => (b.storyPoints || 0) - (a.storyPoints || 0));
    case 'sp_asc':
      return arr.sort((a, b) => (a.storyPoints || 0) - (b.storyPoints || 0));
    case 'updated_desc':
      return arr.sort((a, b) => new Date(b.updatedAt || b.submittedAt) - new Date(a.updatedAt || a.submittedAt));
    case 'updated_asc':
      return arr.sort((a, b) => new Date(a.updatedAt || a.submittedAt) - new Date(b.updatedAt || b.submittedAt));
    default: // date_desc
      return arr.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }
}

window.changeSortLead     = v => { sortLead     = v; applyAllFilters(); };
window.changeSortDesigner = v => { sortDesigner = v; filterDesignerTickets(); };
window.changeSortMine     = v => { sortMine     = v; filterRequesterTickets(); };
window.changeSortQueue    = v => { sortQueue    = v; filterQueueTickets(); };

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function init() {
  const raw = localStorage.getItem('crp_user') || sessionStorage.getItem('crp_user');
  if (!raw) return;
  currentUser = JSON.parse(raw);

  document.getElementById('userName').textContent   = currentUser.name || 'User';
  document.getElementById('userAvatar').textContent = (currentUser.name || '?')[0].toUpperCase();
  document.getElementById('userRole').textContent   = ROLE_LABELS[currentUser.role] || currentUser.role;

  const chip = document.getElementById('roleChip');
  chip.textContent = ROLE_LABELS[currentUser.role] || currentUser.role;
  chip.className   = `role-chip role-${currentUser.role}`;

  try {
    const { data } = await window.api.get('/api/forms/projects');
    projects = data;
  } catch {}

  buildSidebar();
  loadNotifications();

  document.addEventListener('click', e => {
    const wrap = document.getElementById('notifWrap');
    if (wrap && !wrap.contains(e.target)) closeNotifPanel();
  });

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
    </a>` : ''}
    ${currentUser.role === 'admin' ? `<a class="project-nav-item" href="/ai-settings">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>
      <span class="project-nav-label">AI Settings</span>
    </a>` : ''}`;

  // Bell is injected by renderLeadView / renderRequesterView after each render
}

async function loadTickets() {
  document.getElementById('contentArea').innerHTML = '<div class="loading-state" aria-live="polite" aria-busy="true">Loading tickets…</div>';
  try {
    const { data } = await window.api.get('/api/requests');
    tickets = data;
    renderView();
  } catch {
    document.getElementById('contentArea').innerHTML =
      '<div class="loading-state error-state" role="alert">Unable to load tickets. Please refresh the page or try again.</div>';
  }
}

// ── View Router ────────────────────────────────────────────────────────────

function renderView() {
  const role = currentUser.role;
  if (role === 'requester')              renderRequesterView();
  else if (role === 'creative_designer') renderDesignerView();
  else                                   renderLeadView();
}

function priorityFilterOpts() {
  return `<option value="">All Priorities</option>${PRIORITY_OPTIONS.map(p => `<option value="${p.value}">${p.label}</option>`).join('')}`;
}

// ── Requester View (tabbed) ────────────────────────────────────────────────

function renderRequesterView() {
  document.getElementById('pageTitle').textContent = 'Dashboard';
  document.getElementById('topBarRight').innerHTML = `<a href="/form" class="btn btn-primary">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
    New Request</a>${notifBellHtml()}`;
  loadNotifications();

  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="req-tab-bar" role="tablist" aria-label="Request views">
      <button class="req-tab${requesterActiveTab === 'mine'  ? ' active' : ''}" role="tab" aria-selected="${requesterActiveTab === 'mine'}" onclick="switchRequesterTab('mine')">My Requests</button>
      <button class="req-tab${requesterActiveTab === 'queue' ? ' active' : ''}" role="tab" aria-selected="${requesterActiveTab === 'queue'}" onclick="switchRequesterTab('queue')">Project Queue</button>
    </div>
    <div id="reqTabContent" role="tabpanel"></div>`;

  if (requesterActiveTab === 'mine') {
    renderMineTab();
  } else {
    renderQueueTab();
  }
}

// ── My Requests tab ────────────────────────────────────────────────────────

function renderMineTab() {
  const el = document.getElementById('reqTabContent');
  if (!el) return;

  if (!tickets.length) {
    el.innerHTML = contextEmptyState('requester', 'mine');
    return;
  }

  const total = tickets.length;
  const pend  = tickets.filter(t => t.status === 'requested').length;
  const act   = tickets.filter(t => t.status !== 'approved').length;
  const appr  = tickets.filter(t => t.status === 'approved').length;

  const myProjects = currentUser.projects?.length
    ? projects.filter(p => currentUser.projects.includes(p.id) && !p.isStudio && !p.isCopywriting)
    : projects.filter(p => !p.isStudio && !p.isCopywriting);

  el.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
      ${statCard(total,'Total Requests','','','','','','req-total')}
      ${statCard(pend,'Pending','','','','','','req-pend')}
      ${statCard(act,'Active','','','','','','req-act')}
      ${statCard(appr,'Approved','','','','','','req-appr')}
    </div>
    <div class="table-toolbar" style="margin-bottom:12px">
      <div class="filter-group">
        ${myProjects.length > 1 ? `<select id="reqFilterProject" class="filter-select" onchange="filterRequesterTickets()">
          <option value="">All Projects</option>
          ${myProjects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>` : ''}
        <select id="reqFilterPriority" class="filter-select" onchange="filterRequesterTickets()">${priorityFilterOpts()}</select>
        <select id="reqFilterStatus" class="filter-select" onchange="filterRequesterTickets()">
          <option value="">All Statuses</option>
          ${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>
      ${sortSelectHtml('mineSort', sortMine, 'changeSortMine(this.value)')}
    </div>
    <div class="ticket-list" id="ticketList"></div>`;

  renderRequesterTickets(sortTickets(tickets, sortMine));
}

function renderRequesterTickets(list) {
  const listEl = document.getElementById('ticketList');
  if (!listEl) return;
  listEl.innerHTML = list.length
    ? list.map(t => requesterBubble(t)).join('')
    : '<div class="empty-list">No tickets match the selected filters.</div>';
}

window.filterRequesterTickets = function () {
  const project  = document.getElementById('reqFilterProject')?.value;
  const priority = document.getElementById('reqFilterPriority')?.value;
  const status   = document.getElementById('reqFilterStatus')?.value;
  let filtered   = tickets;
  if (project)  filtered = filtered.filter(t => t.project === project);
  if (priority) filtered = filtered.filter(t => t.fields?.priority === priority);
  if (status)   filtered = filtered.filter(t => t.status === status);
  renderRequesterTickets(sortTickets(filtered, sortMine));
  updateRequesterStatCards(filtered);
};

// ── Project Queue tab ──────────────────────────────────────────────────────

async function renderQueueTab() {
  const el = document.getElementById('reqTabContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-state" aria-busy="true">Loading project queue…</div>';
  try {
    const { data } = await window.api.get('/api/requests?queue=true');
    queueTickets = data;
    renderQueueContent();
  } catch {
    el.innerHTML = '<div class="loading-state error-state" role="alert">Unable to load project queue. Please try again.</div>';
  }
}

function renderQueueContent() {
  const el = document.getElementById('reqTabContent');
  if (!el) return;

  if (!queueTickets.length) {
    el.innerHTML = contextEmptyState('requester', 'queue');
    return;
  }

  const qTotal = queueTickets.length;
  const qInP   = queueTickets.filter(t => t.status === 'in_progress').length;
  const qRev   = queueTickets.filter(t => t.status === 'on_review' || t.status === 'revised').length;
  const qNR    = queueTickets.filter(t => ['need_revision','revision'].includes(t.status)).length;

  const queueProjects = currentUser.projects?.length
    ? projects.filter(p => currentUser.projects.includes(p.id) && !p.isStudio && !p.isCopywriting)
    : projects.filter(p => !p.isStudio && !p.isCopywriting);

  el.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
      ${statCard(qTotal,'In Queue','','','','','','q-total')}
      ${statCard(qInP,'In Progress','','','','','','q-inp')}
      ${statCard(qRev,'On Review','','','','','','q-rev')}
      ${statCard(qNR,'Needs Revision','','','','','','q-nr')}
    </div>
    <div class="table-toolbar" style="margin-bottom:12px">
      <div class="filter-group">
        ${queueProjects.length > 1 ? `<select id="qFilterProject" class="filter-select" onchange="filterQueueTickets()">
          <option value="">All Projects</option>
          ${queueProjects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>` : ''}
        <select id="qFilterStatus" class="filter-select" onchange="filterQueueTickets()">
          <option value="">All Statuses</option>
          ${Object.entries(STATUS_LABELS).filter(([k]) => k !== 'approved').map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <select id="qFilterPriority" class="filter-select" onchange="filterQueueTickets()">${priorityFilterOpts()}</select>
      </div>
      ${sortSelectHtml('queueSort', sortQueue, 'changeSortQueue(this.value)')}
    </div>
    <p class="section-hint">Read-only view of all active tickets in your project(s). Click any ticket to view details.</p>
    <div class="ticket-list" id="queueTicketList"></div>`;

  renderQueueList(sortTickets(queueTickets, sortQueue));
}

function renderQueueList(list) {
  const el = document.getElementById('queueTicketList');
  if (!el) return;
  el.innerHTML = list.length
    ? list.map(t => queueBubble(t)).join('')
    : '<div class="empty-list">No tickets match the selected filters.</div>';
}

function queueBubble(t) {
  const proj  = projects.find(p => p.id === t.project);
  const title = t.fields?.title || '(no title)';
  const studioCount = (t.childIssues || []).filter(c => c.is_need_studio).length;
  const cwCount     = (t.childIssues || []).filter(c => c.is_need_copywriting).length;
  const subCount    = t.childIssues?.length || 0;
  const approvedSubs = (t.childIssues || []).filter(c => c.status === 'approved').length;

  return `
    <div class="ticket-bubble queue-bubble" onclick="openTicketModal('${t.id}')">
      <div class="ticket-bubble-main">
        <div class="ticket-bubble-left">
          <div>
            ${t.ticketId ? `<span class="ticket-id-badge">${escHtml(t.ticketId)}</span>` : ''}
            <span class="ticket-title">${escHtml(title)}</span>
            <div class="ticket-meta">
              ${proj ? `<span class="meta-tag" style="color:${proj.color}">${proj.name}</span>` : ''}
              ${t.fields?.priority ? `<span class="meta-tag">Priority: ${cap(t.fields.priority)}</span>` : ''}
              ${t.fields?.deadline ? `<span class="meta-tag">Due: ${fmtDate(t.fields.deadline)}</span>` : ''}
              ${t.storyPoints != null ? `<span class="sp-badge">SP: ${t.storyPoints}</span>` : ''}
              ${studioCount ? `<span class="studio-badge">🎬 ${studioCount}</span>` : ''}
              ${cwCount ? `<span class="cw-badge">✍️ ${cwCount}</span>` : ''}
              ${subCount ? `<span class="meta-tag">${approvedSubs}/${subCount} sub-tasks done</span>` : ''}
              ${t.assignedTo
                ? `<span class="assignee-tag">${escHtml(t.assignedTo.name)}</span>`
                : `<span class="unassigned-tag">Unassigned</span>`}
            </div>
          </div>
        </div>
        <div class="ticket-bubble-right">
          <span class="status-badge status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
          <span class="view-link">View →</span>
        </div>
      </div>
    </div>`;
}

window.filterQueueTickets = function () {
  const project  = document.getElementById('qFilterProject')?.value;
  const status   = document.getElementById('qFilterStatus')?.value;
  const priority = document.getElementById('qFilterPriority')?.value;
  let filtered   = queueTickets;
  if (project)  filtered = filtered.filter(t => t.project === project);
  if (status)   filtered = filtered.filter(t => t.status === status);
  if (priority) filtered = filtered.filter(t => t.fields?.priority === priority);
  renderQueueList(sortTickets(filtered, sortQueue));
  const sv = (id, val) => { const e = document.getElementById(`scv-${id}`); if (e) e.textContent = val; };
  sv('q-total', filtered.length);
  sv('q-inp',   filtered.filter(t => t.status === 'in_progress').length);
  sv('q-rev',   filtered.filter(t => t.status === 'on_review' || t.status === 'revised').length);
  sv('q-nr',    filtered.filter(t => ['need_revision','revision'].includes(t.status)).length);
};

window.switchRequesterTab = async function (tab) {
  requesterActiveTab = tab;
  document.querySelectorAll('.req-tab').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.req-tab').forEach(b => {
    const isTarget = b.textContent.toLowerCase().includes(tab === 'mine' ? 'my' : 'queue');
    if (isTarget) {
      b.classList.add('active');
      b.setAttribute('aria-selected', 'true');
    }
  });
  if (tab === 'mine') {
    renderMineTab();
  } else {
    await renderQueueTab();
  }
};

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
            ${t.storyPoints != null ? `<span class="sp-badge">SP: ${t.storyPoints}</span>` : ''}
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
  if (!tickets.length) { area.innerHTML = contextEmptyState('creative_designer'); return; }

  const inP = tickets.filter(t => t.status === 'in_progress').length;
  const att = tickets.filter(t => ['need_revision','revision','revised'].includes(t.status)).length;

  area.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
      ${statCard(tickets.length,'Active Tickets','','','','','','ds-total')}
      ${statCard(inP,'In Progress','','','','','','ds-inp')}
      ${statCard(att,'Needs Attention','','','','','','ds-att')}
    </div>
    <div class="table-toolbar" style="margin-bottom:12px">
      <div class="filter-group">
        <select id="dsFilterPriority" class="filter-select" onchange="filterDesignerTickets()">${priorityFilterOpts()}</select>
        <select id="dsFilterStatus" class="filter-select" onchange="filterDesignerTickets()">
          <option value="">All Statuses</option>
          ${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>
      ${sortSelectHtml('dsSort', sortDesigner, 'changeSortDesigner(this.value)')}
    </div>
    <p class="section-hint">Click ▶ to expand sub-tasks. Click Details to view discussion.</p>
    <div class="ticket-list" id="ticketList"></div>`;

  renderDesignerTickets(sortTickets(tickets, sortDesigner));
}

function renderDesignerTickets(list) {
  const listEl = document.getElementById('ticketList');
  if (!listEl) return;
  listEl.innerHTML = list.length
    ? list.map(t => designerBubble(t)).join('')
    : '<div class="empty-list">No tickets match the selected filters.</div>';
}

window.filterDesignerTickets = function () {
  const priority = document.getElementById('dsFilterPriority')?.value;
  const status   = document.getElementById('dsFilterStatus')?.value;
  let filtered   = tickets;
  if (priority) filtered = filtered.filter(t => t.fields?.priority === priority);
  if (status)   filtered = filtered.filter(t => t.status === status);
  renderDesignerTickets(sortTickets(filtered, sortDesigner));
  updateDesignerStatCards(filtered);
};

function designerBubble(t) {
  const proj   = projects.find(p => p.id === t.project);
  const title  = t.fields?.title || '(no title)';
  const status = t.status;

  // Designer only sees their own assigned sub-tasks
  const myChildren     = (t.childIssues || []).filter(c => c.assignedTo?.id === currentUser.id);
  const hasChildren    = myChildren.length > 0;
  const hasAnyChildren = (t.childIssues || []).length > 0; // total children on the ticket
  const nextStatuses   = DESIGNER_NEXT[status] || [];

  const childrenHtml = hasChildren ? `
    <div class="ticket-children" id="children-${t.id}" style="display:none">
      <div class="children-label">My Sub-tasks (${myChildren.filter(c=>c.status==='approved').length}/${myChildren.length} approved)</div>
      ${myChildren.map(c => childRow(t.id, c)).join('')}
    </div>` : '';

  // Parent status auto-derives from sub-tasks — only show manual move on tickets with no children at all
  const statusActions = !hasAnyChildren && nextStatuses.length ? `
    <div class="ticket-actions">
      ${nextStatuses.map(s => statusTransitionBtn(t.id, s, 'changeStatus')).join('')}
    </div>` : '';

  return `
    <div class="ticket-bubble${hasChildren ? ' has-children' : ''}" id="bubble-${t.id}">
      <div class="ticket-bubble-main" onclick="openTicketModal('${t.id}')">
        <div class="ticket-bubble-left">
          ${hasChildren ? `<button class="toggle-arrow" id="arrow-${t.id}" onclick="event.stopPropagation();toggleChildren('${t.id}',true)">▶</button>` : '<span class="toggle-placeholder"></span>'}
          <div>
            ${t.ticketId ? `<span class="ticket-id-badge">${escHtml(t.ticketId)}</span>` : ''}
            <span class="ticket-title">${escHtml(title)}</span>
            <div class="ticket-meta">
              ${proj ? `<span class="meta-tag" style="color:${proj.color}">${proj.name}</span>` : ''}
              ${t.fields?.priority ? `<span class="meta-tag">Priority: ${cap(t.fields.priority)}</span>` : ''}
              ${t.fields?.deadline ? `<span class="meta-tag">Due: ${fmtDate(t.fields.deadline)}</span>` : ''}
              ${t.storyPoints != null ? `<span class="sp-badge">SP: ${t.storyPoints}</span>` : ''}
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

function destroyCharts() {
  if (donutChartInstance)  { donutChartInstance.destroy();  donutChartInstance  = null; }
  if (barChartInstance)    { barChartInstance.destroy();    barChartInstance    = null; }
  if (statusChartInstance) { statusChartInstance.destroy(); statusChartInstance = null; }
}

function renderLeadView() {
  destroyCharts();

  document.getElementById('pageTitle').textContent = 'Team Tickets';
  document.getElementById('topBarRight').innerHTML = notifBellHtml();
  loadNotifications();

  const area       = document.getElementById('contentArea');
  const unassigned = tickets.filter(t => !t.assignedTo);

  const assigneeMap = new Map(teamMembers.map(m => [m.id, m]));
  tickets.forEach(t => { if (t.assignedTo && !assigneeMap.has(t.assignedTo.id)) assigneeMap.set(t.assignedTo.id, t.assignedTo); });
  const allAssignees = Array.from(assigneeMap.values());

  const total        = tickets.length;
  const unas         = unassigned.length;
  const inP          = tickets.filter(t => t.status === 'in_progress').length;
  const rev          = tickets.filter(t => t.status === 'on_review' || t.status === 'revised').length;
  const totalSubs    = tickets.reduce((s, t) => s + (t.childIssues?.length || 0), 0);
  const unassSubs    = tickets.reduce((s, t) => s + (t.childIssues || []).filter(c => !c.assignedTo).length, 0);

  const teamHtml = teamMembers.filter(m => !m.isStudioPool).map(m => {
    const usedSP    = tickets.filter(t => t.assignedTo?.id === m.id).reduce((s, t) => s + (t.storyPoints || 0), 0);
    const maxSP     = m.maxStoryPoints || 35;
    const loadClass = usedSP > maxSP ? 'sp-overload' : usedSP / maxSP >= 0.8 ? 'sp-high' : '';
    return `
      <div class="team-member-row">
        <div class="team-member-info">
          <span class="team-member-avatar">${m.name[0].toUpperCase()}</span>
          <div>
            <div class="team-member-name">${escHtml(m.name)}</div>
            <div class="team-member-dept">${escHtml(m.email)}</div>
          </div>
        </div>
        <div class="sp-cap-row">
          <span class="sp-cap-used ${loadClass}">${usedSP}</span>
          <span class="sp-cap-sep">/</span>
          <input type="number" class="sp-cap-input" value="${maxSP}" min="1" max="999"
            data-prev="${maxSP}" title="Max SP capacity"
            onchange="updateDesignerCapacity('${m.id}',this)">
          <span class="sp-cap-label">SP cap</span>
          ${usedSP > maxSP ? '<span class="sp-overload-tag">⚠ over</span>' : ''}
        </div>
        ${allLeads.length ? `<div class="team-member-actions" onclick="event.stopPropagation()">
          <select class="assign-select" onchange="transferDesigner('${m.id}',this)">
            <option value="">Transfer to another lead…</option>
            ${allLeads.map(l => `<option value="${l.id}">${escHtml(l.name)}${l.department ? ' · '+escHtml(l.department) : ''}</option>`).join('')}
          </select>
        </div>` : ''}
      </div>`;
  }).join('');

  area.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
      ${statCard(total,'Total Tickets','',totalSubs,'sub-tasks','toggleSubtaskFilter()','subtaskFilterBtn','total')}
      ${statCard(unas,'Unassigned',unas>0?'danger':'',unassSubs,'unassigned sub-tasks','','','unas')}
      ${statCard(inP,'In Progress','','','','','','inp')}
      ${statCard(rev,'Needs Review','','','','','','rev')}
    </div>

    <!-- ① Global filter bar — directly below scorecards, affects charts + ticket list -->
    <div class="table-toolbar" style="margin-bottom:8px">
      <div class="filter-group">
        <select id="filterProject" class="filter-select" onchange="applyAllFilters()">
          <option value="">All Projects</option>
          ${projects.map(p => `<option value="${p.id}">${p.icon ? p.icon+' ' : ''}${p.name}</option>`).join('')}
        </select>
        <select id="filterStatus" class="filter-select" onchange="applyAllFilters()">
          <option value="">All Statuses</option>
          ${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <select id="filterAssignee" class="filter-select" onchange="applyAllFilters()">
          <option value="">All Assignees</option>
          <option value="__unassigned__">— Unassigned —</option>
          ${allAssignees.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
        </select>
        <select id="filterPriority" class="filter-select" onchange="applyAllFilters()">${priorityFilterOpts()}</select>
      </div>
    </div>

    <!-- ② Auto-assign panel (creative lead only) -->
    ${buildAutoAssignPanel(unas, teamMembers)}
    <!-- ② Cross-filter indicator badges -->
    <div id="crossFilterBadges"></div>

    <!-- ③ Charts -->
    <div class="charts-row">
      <div class="chart-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div class="chart-title" style="margin-bottom:0">Ticket Allocation by Designer</div>
          <div class="donut-mode-btns">
            <button class="donut-mode-btn active" id="donutModeTask" onclick="setDonutMode('tasks')">Tasks</button>
            <button class="donut-mode-btn" id="donutModeSub"  onclick="setDonutMode('subtasks')">Sub-tasks</button>
          </div>
        </div>
        <div class="chart-donut-wrap"><canvas id="donutChart" width="240" height="240"></canvas></div>
        <div id="donutDrilldown" class="donut-drilldown" style="display:none"></div>
        <p class="chart-hint">⚡ Click a slice to cross-filter</p>
      </div>
      <div class="chart-card">
        <div class="chart-title">Workload by Story Points</div>
        <div class="bar-chart-wrap" id="barChartWrap" style="position:relative;height:160px">
          <canvas id="barChart"></canvas>
        </div>
        <p class="chart-hint">⚡ Click a bar to cross-filter by designer</p>
      </div>
    </div>

    <div class="chart-card" style="margin-bottom:24px">
      <div class="chart-title">Active Ticket Status Distribution</div>
      <div style="position:relative;height:180px">
        <canvas id="statusChart"></canvas>
      </div>
      <p class="chart-hint">⚡ Click a bar to cross-filter by status</p>
    </div>

    ${teamMembers.length ? `
    <div class="team-section">
      <div class="team-section-header" onclick="toggleTeamSection()">
        <span>My Team <span class="team-count">${teamMembers.length}</span></span>
        <svg id="teamArrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="team-section-body" id="teamSectionBody" style="display:none">
        ${teamHtml}
      </div>
    </div>` : ''}

    ${unas ? `<div class="alert alert-warning" style="margin-bottom:12px">⚠ ${unas} unassigned ticket${unas>1?'s':''} — use the assign dropdown or ⚡ auto-assign.</div>` : ''}
    <div class="pre-list-bar">
      ${sortSelectHtml('leadSort', sortLead, 'changeSortLead(this.value)')}
      ${unas ? `<button class="quick-filter-unassigned" id="unassignedFilterBtn" onclick="toggleUnassignedFilter()" title="Show unassigned tickets only">
        ⚠ Unassigned <span class="quick-filter-badge">${unas}</span>
      </button>` : ''}
    </div>
    <div class="ticket-list" id="ticketList"></div>`;

  initCharts();
  applyAllFilters();
}

window.toggleTeamSection = function () {
  const body  = document.getElementById('teamSectionBody');
  const arrow = document.getElementById('teamArrow');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display      = open ? 'block' : 'none';
  if (arrow) arrow.style.transform = open ? 'rotate(180deg)' : '';
};

// ── Filter Engine ──────────────────────────────────────────────────────────

// Returns tickets filtered by dropdown selects only (no cross-filter)
function getDropdownFilteredTickets() {
  let list = tickets;
  const proj     = document.getElementById('filterProject')?.value  || '';
  const status   = document.getElementById('filterStatus')?.value   || '';
  const assignee = document.getElementById('filterAssignee')?.value || '';
  const priority = document.getElementById('filterPriority')?.value || '';

  if (proj) {
    // Studio and Copywriting are virtual projects — filter by child issue flags
    if (proj === 'studio') {
      list = list.filter(t => (t.childIssues || []).some(c => c.is_need_studio === true));
    } else if (proj === 'copywriting') {
      list = list.filter(t => (t.childIssues || []).some(c => c.is_need_copywriting === true));
    } else {
      list = list.filter(t => t.project === proj);
    }
  }

  if (status)  list = list.filter(t => t.status  === status);
  if (assignee === '__unassigned__') list = list.filter(t => !t.assignedTo);
  else if (assignee) list = list.filter(t => t.assignedTo?.id === assignee);
  if (priority) list = list.filter(t => t.fields?.priority === priority);

  // Sub-task filter: show only tickets that have child issues
  if (subtaskFilterActive) list = list.filter(t => (t.childIssues || []).length > 0);

  return list;
}

// Returns parent tickets where a designer has work — via subtasks OR direct assignment
function ticketsForDesigner(list, designerId) {
  return list.filter(t =>
    t.childIssues?.length
      ? t.childIssues.some(c =>
          designerId === '__unassigned__' ? !c.assignedTo : c.assignedTo?.id === designerId
        )
      : designerId === '__unassigned__' ? !t.assignedTo : t.assignedTo?.id === designerId
  );
}

// Applies cross-filter on top of a base list
function applyCrossFilter(list) {
  if (crossFilter.designerId) list = ticketsForDesigner(list, crossFilter.designerId);
  if (crossFilter.statusKey) {
    const key = crossFilter.statusKey;
    list = list.filter(t => {
      const ch = t.childIssues || [];
      return ch.length > 0 ? ch.some(c => c.status === key) : t.status === key;
    });
  }
  return list;
}

// Central function called by every filter dropdown change AND every chart click
window.applyAllFilters = function () {
  const base     = getDropdownFilteredTickets();
  const combined = applyCrossFilter(base);

  // Ticket list + scorecards reflect the full combined filter
  renderLeadTickets(sortTickets(combined, sortLead));
  updateLeadStatCards(combined);

  // Donut + bar charts: filtered by status cross-filter (but NOT designer cross-filter —
  // designer selection is shown as a visual highlight on those two charts)
  const donutBarSubset = crossFilter.statusKey
    ? base.filter(t => {
        const ch = t.childIssues || [];
        return ch.length > 0 ? ch.some(c => c.status === crossFilter.statusKey) : t.status === crossFilter.statusKey;
      })
    : base;
  updateDonutChartData(donutBarSubset);
  updateBarChartData(donutBarSubset);

  // Status chart: filtered by designer cross-filter (but NOT status cross-filter —
  // status selection is shown as a visual highlight on that chart)
  const statusSubset = crossFilter.designerId
    ? ticketsForDesigner(base, crossFilter.designerId)
    : base;
  updateStatusChartData(statusSubset);

  renderCrossFilterBadges();
};

// ── Cross-filter badge UI ──────────────────────────────────────────────────

function renderCrossFilterBadges() {
  const area = document.getElementById('crossFilterBadges');
  if (!area) return;
  const badges = [];
  if (crossFilter.statusKey) {
    badges.push(`<span class="cross-filter-badge">Status: ${STATUS_LABELS[crossFilter.statusKey]}
      <button onclick="clearCrossFilter('status')" title="Remove">×</button></span>`);
  }
  if (crossFilter.designerId) {
    const name = crossFilter.designerId === '__unassigned__'
      ? 'Unassigned'
      : (teamMembers.find(m => m.id === crossFilter.designerId)?.name || 'Designer');
    badges.push(`<span class="cross-filter-badge">Designer: ${escHtml(name)}
      <button onclick="clearCrossFilter('designer')" title="Remove">×</button></span>`);
  }
  area.innerHTML = badges.length
    ? `<div class="cross-filter-bar">
        <span class="cross-filter-label">Chart filter:</span>
        ${badges.join('')}
        <button class="cross-filter-clear-all" onclick="clearAllCrossFilters()">Clear all</button>
      </div>`
    : '';
}

// Sub-task filter toggle — show only tickets that have child issues
window.toggleSubtaskFilter = function () {
  subtaskFilterActive = !subtaskFilterActive;
  const btn = document.getElementById('subtaskFilterBtn');
  if (btn) btn.classList.toggle('active', subtaskFilterActive);
  applyAllFilters();
};

// Unassigned quick-filter toggle
window.toggleUnassignedFilter = function () {
  const sel = document.getElementById('filterAssignee');
  const btn = document.getElementById('unassignedFilterBtn');
  if (!sel) return;
  const isActive = sel.value === '__unassigned__';
  sel.value = isActive ? '' : '__unassigned__';
  if (btn) btn.classList.toggle('active', !isActive);
  applyAllFilters();
};

window.clearCrossFilter = function (type) {
  if (type === 'status')   { crossFilter.statusKey  = null; }
  if (type === 'designer') { crossFilter.designerId = null; hideDrilldown(); }
  applyAllFilters();
};

window.clearAllCrossFilters = function () {
  crossFilter.designerId = null;
  crossFilter.statusKey  = null;
  hideDrilldown();
  applyAllFilters();
};

function hideDrilldown() {
  const p = document.getElementById('donutDrilldown');
  if (p) p.style.display = 'none';
}

// ── Chart data updaters (in-place, no destroy) ─────────────────────────────

function subCountForDesigner(subset, designerId) {
  let n = 0;
  for (const t of subset) {
    const ch = t.childIssues || [];
    if (ch.length > 0) {
      n += ch.filter(c => designerId === '__unassigned__' ? !c.assignedTo : c.assignedTo?.id === designerId).length;
    } else {
      if (designerId === '__unassigned__' ? !t.assignedTo : t.assignedTo?.id === designerId) n++;
    }
  }
  return n;
}

function updateDonutChartData(subset) {
  if (!donutChartInstance || !donutEntries.length) return;
  const newCounts = donutEntries.map(([id]) =>
    donutMode === 'tasks' ? ticketsForDesigner(subset, id).length : subCountForDesigner(subset, id)
  );
  donutChartInstance.data.datasets[0].data = newCounts;
  // Dim non-selected slices when a designer is selected
  donutChartInstance.data.datasets[0].backgroundColor = donutColors.map((c, i) => {
    if (!crossFilter.designerId) return c;
    return donutEntries[i][0] === crossFilter.designerId ? c : c + '40';
  });
  donutChartInstance.update('none');
}

function updateBarChartData(subset) {
  if (!barChartInstance || !barEntries.length) return;
  const newSP = barEntries.map(([id]) => {
    if (id === '__unassigned__') {
      return ticketsForDesigner(subset, id).reduce((s, t) => s + (t.storyPoints || 0), 0);
    }
    let sp = 0;
    for (const t of subset) {
      const ch = t.childIssues || [];
      if (ch.length > 0) {
        for (const c of ch) { if (c.assignedTo?.id === id) sp += (c.storyPoints || 0); }
      } else {
        if (t.assignedTo?.id === id) sp += (t.storyPoints || 0);
      }
    }
    return sp;
  });
  barChartInstance.data.datasets[0].data = newSP;
  // Dim non-selected bars when a designer is selected
  barChartInstance.data.datasets[0].backgroundColor = barColors.map((c, i) => {
    if (!crossFilter.designerId) return c + 'bb';
    return barEntries[i][0] === crossFilter.designerId ? c + 'dd' : c + '28';
  });
  barChartInstance.data.datasets[0].borderColor = barColors.map((c, i) => {
    if (!crossFilter.designerId) return c;
    return barEntries[i][0] === crossFilter.designerId ? c : c + '40';
  });
  barChartInstance.update('none');
}

function updateStatusChartData(subset) {
  if (!statusChartInstance || !statusKeys.length) return;
  const filterDesigner = (crossFilter.designerId && crossFilter.designerId !== '__unassigned__')
    ? crossFilter.designerId : null;
  const newCounts = statusKeys.map(s => {
    let n = 0;
    for (const t of subset) {
      const ch = t.childIssues || [];
      if (ch.length > 0) {
        const relevant = filterDesigner ? ch.filter(c => c.assignedTo?.id === filterDesigner) : ch;
        n += relevant.filter(c => c.status === s).length;
      } else {
        if (t.status === s) n++;
      }
    }
    return n;
  });
  statusChartInstance.data.datasets[0].data = newCounts;
  // Dim non-selected bars when a status is selected
  statusChartInstance.data.datasets[0].backgroundColor = statusKeys.map((s, i) => {
    const base = STATUS_CHART_COLORS[s]?.bg || 'rgba(99,102,241,0.2)';
    if (!crossFilter.statusKey) return base;
    return s === crossFilter.statusKey ? base : base.replace(/[\d.]+\)$/, '0.07)');
  });
  statusChartInstance.data.datasets[0].borderColor = statusKeys.map(s => {
    const base = STATUS_CHART_COLORS[s]?.border || '#6366f1';
    if (!crossFilter.statusKey) return base;
    return s === crossFilter.statusKey ? base : base + '40';
  });
  statusChartInstance.update('none');
}

window.setDonutMode = function (mode) {
  if (donutMode === mode) return;
  donutMode = mode;
  document.getElementById('donutModeTask')?.classList.toggle('active', mode === 'tasks');
  document.getElementById('donutModeSub')?.classList.toggle('active', mode === 'subtasks');
  applyAllFilters();
};

// ── Charts (initial creation) ──────────────────────────────────────────────

function initCharts() {
  if (!window.Chart) return;

  const donutCanvas  = document.getElementById('donutChart');
  const barCanvas    = document.getElementById('barChart');
  const statusCanvas = document.getElementById('statusChart');
  if (!donutCanvas || !barCanvas || !statusCanvas) return;

  // Build designer aggregation — task count (parent tickets) + subtask count
  // Exclude studio-pool members (shared from another lead) from this lead's workload view
  const designerData = {};
  for (const m of teamMembers.filter(m => !m.isStudioPool)) {
    designerData[m.id] = { name: m.name, count: 0, subtaskCount: 0, storyPoints: 0 };
  }
  designerData['__unassigned__'] = { name: 'Unassigned', count: 0, subtaskCount: 0, storyPoints: 0 };

  for (const t of tickets) {
    const children = t.childIssues || [];
    if (children.length > 0) {
      const seen = {};
      for (const c of children) {
        const key = c.assignedTo?.id || '__unassigned__';
        // Skip sub-tasks assigned to someone outside this lead's team
        if (key !== '__unassigned__' && !designerData[key]) continue;
        if (!designerData[key]) designerData[key] = { name: 'Unassigned', count: 0, subtaskCount: 0, storyPoints: 0 };
        designerData[key].storyPoints  += (c.storyPoints || 0);
        designerData[key].subtaskCount += 1;
        if (!seen[key]) { seen[key] = true; designerData[key].count++; }
      }
    } else {
      const key = t.assignedTo?.id || '__unassigned__';
      if (key !== '__unassigned__' && !designerData[key]) continue;
      if (!designerData[key]) designerData[key] = { name: 'Unassigned', count: 0, subtaskCount: 0, storyPoints: 0 };
      designerData[key].count++;
      designerData[key].subtaskCount += 1;
      designerData[key].storyPoints  += (t.storyPoints || 0);
    }
  }

  // Include designers that have work in EITHER mode
  donutEntries = Object.entries(designerData).filter(([, d]) => d.count > 0 || d.subtaskCount > 0);
  barEntries   = Object.entries(designerData).filter(([k]) => k !== '__unassigned__' || designerData[k].count > 0);
  statusKeys   = Object.keys(STATUS_LABELS).filter(s => s !== 'approved');
  donutColors  = donutEntries.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
  barColors    = barEntries.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  const barWrap = document.getElementById('barChartWrap');
  if (barWrap) barWrap.style.height = `${Math.max(80, barEntries.length * 44 + 40)}px`;

  const hoverCursor = (event, elements) => {
    if (event.native) event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
  };

  // ── Donut chart ──
  donutChartInstance = new window.Chart(donutCanvas, {
    type: 'doughnut',
    data: {
      labels: donutEntries.map(([, d]) => d.name),
      datasets: [{
        data:            donutEntries.map(([, d]) => donutMode === 'tasks' ? d.count : d.subtaskCount),
        backgroundColor: donutColors,
        borderWidth:     2,
        borderColor:     '#fff',
        hoverOffset:     6
      }]
    },
    options: {
      responsive:          false,
      maintainAspectRatio: false,
      plugins: {
        legend:  { position: 'bottom', labels: { font: { size: 11 }, padding: 10, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => {
          const unit = donutMode === 'tasks' ? 'ticket' : 'sub-task';
          return ` ${ctx.label}: ${ctx.raw} ${unit}${ctx.raw !== 1 ? 's' : ''}`;
        }}}
      },
      onHover: hoverCursor,
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        const idx        = elements[0].index;
        const [designerId, entry] = donutEntries[idx];
        if (crossFilter.designerId === designerId) {
          crossFilter.designerId = null;
          hideDrilldown();
        } else {
          crossFilter.designerId = designerId;
          const base = getDropdownFilteredTickets();
          showDonutDrilldown(entry.name, donutColors[idx], ticketsForDesigner(base, designerId));
        }
        applyAllFilters();
      }
    }
  });

  // ── Workload bar chart ──
  barChartInstance = new window.Chart(barCanvas, {
    type: 'bar',
    data: {
      labels: barEntries.map(([, d]) => d.name),
      datasets: [{
        label:           'Story Points',
        data:            barEntries.map(([, d]) => d.storyPoints),
        backgroundColor: barColors.map(c => c + 'bb'),
        borderColor:     barColors,
        borderWidth:     1.5,
        borderRadius:    4
      }]
    },
    options: {
      indexAxis:           'y',
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend:  { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw} SP` } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, grid: { color: '#f1f5f9' } },
        y: { grid: { display: false }, ticks: { font: { size: 12 } } }
      },
      onHover: hoverCursor,
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        const idx        = elements[0].index;
        const [designerId] = barEntries[idx];
        if (crossFilter.designerId === designerId) {
          crossFilter.designerId = null;
          hideDrilldown();
        } else {
          crossFilter.designerId = designerId;
          const base  = getDropdownFilteredTickets();
          const entry = designerData[designerId];
          if (entry) showDonutDrilldown(entry.name, barColors[idx], ticketsForDesigner(base, designerId));
        }
        applyAllFilters();
      }
    }
  });

  // ── Status distribution chart ──
  const statusBgColors = statusKeys.map(s => STATUS_CHART_COLORS[s]?.bg    || 'rgba(99,102,241,0.2)');
  const statusBorders  = statusKeys.map(s => STATUS_CHART_COLORS[s]?.border || '#6366f1');

  statusChartInstance = new window.Chart(statusCanvas, {
    type: 'bar',
    data: {
      labels: statusKeys.map(s => STATUS_LABELS[s]),
      datasets: [{
        label:           'Sub-tasks / Tickets',
        data:            statusKeys.map(s => {
          let n = 0;
          for (const t of tickets) {
            const ch = t.childIssues || [];
            if (ch.length > 0) n += ch.filter(c => c.status === s).length;
            else if (t.status === s) n++;
          }
          return n;
        }),
        backgroundColor: statusBgColors,
        borderColor:     statusBorders,
        borderWidth:     2,
        borderRadius:    6
      }]
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend:  { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw} sub-task${ctx.raw !== 1 ? 's' : ''}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, grid: { color: '#f1f5f9' } }
      },
      onHover: hoverCursor,
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const key = statusKeys[idx];
        crossFilter.statusKey = crossFilter.statusKey === key ? null : key;
        applyAllFilters();
      }
    }
  });
}

function showDonutDrilldown(designerName, color, subset) {
  const panel = document.getElementById('donutDrilldown');
  if (!panel) return;
  const byProject = {};
  for (const t of subset) {
    const proj = projects.find(p => p.id === t.project);
    const name = proj?.name || t.project;
    byProject[name] = (byProject[name] || 0) + 1;
  }
  const rows = Object.entries(byProject)
    .sort((a, b) => b[1] - a[1])
    .map(([proj, cnt]) => `
      <div class="drilldown-item">
        <span class="drilldown-dot" style="background:${color}"></span>
        <span>${escHtml(proj)}</span>
        <span class="drilldown-count">${cnt}</span>
      </div>`).join('');
  panel.innerHTML = `
    <div class="drilldown-title">${escHtml(designerName)} — ${subset.length} ticket${subset.length !== 1 ? 's' : ''}</div>
    ${rows || '<div style="font-size:12px;color:var(--text-muted)">No tickets in current filter</div>'}`;
  panel.style.display = 'block';
}

// ── Lead ticket list ───────────────────────────────────────────────────────

function renderLeadTickets(list) {
  const listEl = document.getElementById('ticketList');
  if (!listEl) return;
  const isStudio = (document.getElementById('filterProject')?.value === 'studio');
  if (!list.length) { listEl.innerHTML = contextEmptyState('creative_lead'); return; }
  listEl.innerHTML = (isStudio
    ? `<div class="studio-view-header">🎬 Studio view — showing only sub-tasks that need Studio team</div>`
    : '') + list.map(t => leadBubble(t, isStudio)).join('');
}

function leadBubble(t, isStudioView = false) {
  const proj         = projects.find(p => p.id === t.project);
  const title        = t.fields?.title || '(no title)';
  const status       = t.status;
  const nextStatuses = LEAD_NEXT[status] || [];

  // In Studio view only show child issues flagged for studio; otherwise show all
  const visibleChildren = isStudioView
    ? (t.childIssues || []).filter(c => c.is_need_studio === true)
    : (t.childIssues || []);
  const hasChildren = visibleChildren.length > 0;

  const studioCount = (t.childIssues || []).filter(c => c.is_need_studio === true).length;

  const assigneeHtml = t.assignedTo
    ? `<span class="assignee-tag">${escHtml(t.assignedTo.name)}</span>`
    : `<span class="unassigned-tag">Unassigned</span>`;

  const assignRow = teamMembers.length ? `
    <div class="assign-row" onclick="event.stopPropagation()">
      <label class="assign-label">Assign:</label>
      <select class="assign-select assign-bold" onchange="assignFromSelect('${t.id}',this)">
        <option value="">— Unassigned —</option>
        ${teamMembers.map(m => `<option value="${m.id}" ${t.assignedTo?.id === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-outline" onclick="autoAssignTicket('${t.id}')" title="Auto-assign using load balancing">⚡ Auto</button>
    </div>` : '';

  // Parent status auto-derives from sub-tasks — only show manual move on tickets without children
  const statusActions = !hasChildren && nextStatuses.length ? `
    <div class="ticket-actions" onclick="event.stopPropagation()">
      ${nextStatuses.map(s => statusTransitionBtn(t.id, s, 'changeStatus')).join('')}
    </div>` : '';

  const childrenLabel = isStudioView
    ? `Studio sub-tasks (${visibleChildren.filter(c=>c.status==='approved').length}/${visibleChildren.length} approved)`
    : `Sub-tasks (${visibleChildren.filter(c=>c.status==='approved').length}/${visibleChildren.length} approved)`;

  const childrenHtml = hasChildren ? `
    <div class="ticket-children" id="children-${t.id}" style="display:none">
      <div class="children-label">${childrenLabel}</div>
      ${visibleChildren.map(c => childRow(t.id, c)).join('')}
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
              ${t.storyPoints != null ? `<span class="sp-badge">SP: ${t.storyPoints}</span>` : ''}
              ${studioCount > 0 && !isStudioView ? `<span class="studio-badge">🎬 ${studioCount} studio</span>` : ''}
              ${assigneeHtml}
            </div>
          </div>
        </div>
        <div class="ticket-bubble-right">
          <span class="status-badge status-${status}">${STATUS_LABELS[status]||status}</span>
          <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();openTicketModal('${t.id}')">Details</button>
          <button class="btn btn-sm btn-delete" onclick="event.stopPropagation();deleteTicket('${t.id}',${JSON.stringify(title)})">🗑</button>
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

// ── Auto-assign panel builder ──────────────────────────────────────────────

function buildAutoAssignPanel(unassignedCount, members) {
  if (!unassignedCount && members.length) return ''; // nothing to assign

  if (!members.length) {
    return `
      <div class="autoassign-panel autoassign-empty" style="margin-bottom:20px">
        <div class="autoassign-panel-left">
          <div class="autoassign-title">⚡ Load-balancing Auto-assign</div>
          <div class="autoassign-desc">No designers in your team yet. Designers must be registered with your account as their Creative Lead before you can assign tickets.</div>
        </div>
      </div>`;
  }

  // Tickets that qualify (have story points) vs those that need SP first
  const unassignedTickets = tickets.filter(t => !t.assignedTo);
  const withSP    = unassignedTickets.filter(t =>
    t.childIssues?.length
      ? t.childIssues.some(c => c.storyPoints != null && c.storyPoints > 0)
      : (t.storyPoints != null && t.storyPoints > 0)
  );
  const withoutSP = unassignedTickets.length - withSP.length;

  // Build live load summary
  const loadsNow = buildDesignerLoads();
  const memberSummary = members.map(m => {
    const d   = loadsNow[m.id] || { usedSP: 0, maxSP: m.maxStoryPoints || 35 };
    const cls = d.usedSP > d.maxSP ? 'overload' : d.usedSP / d.maxSP >= 0.8 ? 'high' : '';
    return `<div class="aap-member">
      <span class="aap-avatar">${m.name[0].toUpperCase()}</span>
      <span class="aap-name">${escHtml(m.name)}</span>
      <span class="aap-sp ${cls}">${d.usedSP}/${d.maxSP} SP</span>
    </div>`;
  }).join('');

  const spNote = withoutSP
    ? `<div class="aap-sp-note">⚠ ${withoutSP} ticket${withoutSP !== 1 ? 's' : ''} have no story points and will be skipped — set SP on those tickets first.</div>`
    : '';

  const btnDisabled = withSP.length === 0 ? 'disabled' : '';

  return `
    <div class="autoassign-panel" style="margin-bottom:20px">
      <div class="autoassign-panel-left">
        <div class="autoassign-title">⚡ Load-balancing Auto-assign</div>
        <div class="autoassign-desc">
          Assigns <strong>${withSP.length}</strong> of ${unassignedCount} unassigned ticket${unassignedCount !== 1 ? 's' : ''}
          (those with story points set) — <strong>critical first</strong>, then high → medium → low.
        </div>
        ${spNote}
        <div class="aap-members">${memberSummary}</div>
      </div>
      <button class="autoassign-btn" id="autoAssignAllBtn" onclick="autoAssignAll()" ${btnDisabled}
        title="${withSP.length === 0 ? 'Set story points on tickets first' : 'Auto-assign tickets with story points using load balancing'}">
        ⚡ Auto-assign ${withSP.length > 0 ? `(${withSP.length})` : ''}
      </button>
    </div>`;
}

// ── Load-balancing auto-assign ─────────────────────────────────────────────

function buildDesignerLoads() {
  const loads = {};
  for (const m of teamMembers) {
    loads[m.id] = { member: m, usedSP: 0, maxSP: m.maxStoryPoints || 35 };
  }
  for (const t of tickets) {
    if (t.childIssues?.length) {
      // Track load at child-issue level (each child has its own assignee + SP)
      for (const c of t.childIssues) {
        if (c.assignedTo?.id && loads[c.assignedTo.id]) {
          loads[c.assignedTo.id].usedSP += (c.storyPoints || 0);
        }
      }
    } else {
      // No children: use parent-level assignee + SP
      if (t.assignedTo?.id && loads[t.assignedTo.id]) {
        loads[t.assignedTo.id].usedSP += (t.storyPoints || 0);
      }
    }
  }
  return loads;
}

// Returns designers whose scope covers this sub-task
function getEligibleDesignersForTask(ticketProject, isStudio, isCopywriting = false) {
  return teamMembers.filter(m => {
    const ps = m.projects || [];
    if (isStudio && isCopywriting) return ps.includes('studio') || ps.includes('copywriting');
    if (isStudio)       return ps.includes('studio');
    if (isCopywriting)  return ps.includes('copywriting');
    return ps.includes(ticketProject);
  });
}

function pickBestDesigner(loads, ticketSP) {
  const sp = ticketSP || 0;
  let best = null;
  let bestRemaining = -Infinity;
  for (const d of Object.values(loads)) {
    const remaining = d.maxSP - d.usedSP;
    if (remaining >= sp && remaining > bestRemaining) { bestRemaining = remaining; best = d.member; }
  }
  if (!best) {
    for (const d of Object.values(loads)) {
      const remaining = d.maxSP - d.usedSP;
      if (remaining > bestRemaining) { bestRemaining = remaining; best = d.member; }
    }
  }
  return best;
}

window.autoAssignTicket = async function (ticketId) {
  if (!teamMembers.length) { alert('No team members to assign to.'); return; }
  const t = tickets.find(x => x.id === ticketId);
  if (!t) return;

  if (t.childIssues?.length) {
    const withSP = t.childIssues.filter(c => c.storyPoints != null && c.storyPoints > 0);
    if (!withSP.length) { alert('Set story points on sub-tasks first before auto-assigning.'); return; }

    const loads      = buildDesignerLoads();
    const bothKids   = withSP.filter(c => c.is_need_studio && c.is_need_copywriting);
    const studioKids = withSP.filter(c => c.is_need_studio && !c.is_need_copywriting);
    const cwKids     = withSP.filter(c => c.is_need_copywriting && !c.is_need_studio);
    const bauKids    = withSP.filter(c => !c.is_need_studio && !c.is_need_copywriting);

    const assignGroupTicket = async (kids, isStudio, isCW) => {
      if (!kids.length) return;
      const totalSP  = kids.reduce((s, c) => s + c.storyPoints, 0);
      const eligible = getEligibleDesignersForTask(t.project, isStudio, isCW);
      if (!eligible.length) return;
      const sub = {};
      for (const m of eligible) sub[m.id] = loads[m.id] || { member: m, usedSP: 0, maxSP: m.maxStoryPoints || 35 };
      const designer = pickBestDesigner(sub, totalSP);
      if (!designer) return;
      for (const c of kids) {
        try {
          await window.api.put(`/api/requests/${ticketId}/children/${c.id}`, {
            assignedTo: { id: designer.id, name: designer.name, email: designer.email }
          });
        } catch (err) { alert(err.message); }
      }
      if (loads[designer.id]) loads[designer.id].usedSP += totalSP;
    };

    await assignGroupTicket(bothKids,   true,  true);
    await assignGroupTicket(studioKids, true,  false);
    await assignGroupTicket(cwKids,     false, true);

    for (const c of bauKids) {
      const designers = getEligibleDesignersForTask(t.project, false, false);
      if (!designers.length) continue;
      const sub = {};
      for (const m of designers) sub[m.id] = loads[m.id] || { member: m, usedSP: 0, maxSP: m.maxStoryPoints || 35 };
      const designer = pickBestDesigner(sub, c.storyPoints);
      if (!designer) continue;
      try {
        await window.api.put(`/api/requests/${ticketId}/children/${c.id}`, {
          assignedTo: { id: designer.id, name: designer.name, email: designer.email }
        });
        if (loads[designer.id]) loads[designer.id].usedSP += c.storyPoints;
      } catch (err) { alert(err.message); }
    }
    await loadTickets();
  } else {
    if (!t.storyPoints) {
      alert('Story points must be set on this ticket before it can be auto-assigned.');
      return;
    }
    const loads    = buildDesignerLoads();
    const designer = pickBestDesigner(loads, t.storyPoints);
    if (!designer) { alert('No available designers.'); return; }
    try {
      await window.api.put(`/api/requests/${ticketId}`, {
        assignedTo: { id: designer.id, name: designer.name, email: designer.email }
      });
      await loadTickets();
    } catch (err) { alert(err.message); }
  }
};

window.autoAssignTicketModal = async function (ticketId) {
  if (!teamMembers.length) { alert('No team members to assign to.'); return; }
  const t = tickets.find(x => x.id === ticketId);

  if (t?.childIssues?.length) {
    const loads      = buildDesignerLoads();
    const spOf       = c => parseInt(document.getElementById(`sp-child-${c.id}`)?.value, 10) || (c.storyPoints || 0);
    const bothKids   = t.childIssues.filter(c => c.is_need_studio && c.is_need_copywriting       && spOf(c) > 0);
    const studioKids = t.childIssues.filter(c => c.is_need_studio && !c.is_need_copywriting     && spOf(c) > 0);
    const cwKids     = t.childIssues.filter(c => c.is_need_copywriting && !c.is_need_studio     && spOf(c) > 0);
    const bauKids    = t.childIssues.filter(c => !c.is_need_studio && !c.is_need_copywriting    && spOf(c) > 0);
    let lastData = null;

    // Shared helper: assign all kids in a scope group to ONE best-fit designer
    const assignGroupModal = async (kids, isStudio, isCW) => {
      if (!kids.length) return;
      const totalSP  = kids.reduce((s, c) => s + spOf(c), 0);
      const eligible = getEligibleDesignersForTask(t.project, isStudio, isCW);
      if (!eligible.length) return;
      const sub = {};
      for (const m of eligible) sub[m.id] = loads[m.id] || { member: m, usedSP: 0, maxSP: m.maxStoryPoints || 35 };
      const designer = pickBestDesigner(sub, totalSP);
      if (!designer) return;
      for (const c of kids) {
        try {
          const { data } = await window.api.put(`/api/requests/${ticketId}/children/${c.id}`, {
            assignedTo: { id: designer.id, name: designer.name, email: designer.email }
          });
          lastData = data;
        } catch {}
      }
      if (!loads[designer.id]) loads[designer.id] = { member: designer, usedSP: 0, maxSP: designer.maxStoryPoints || 10 };
      loads[designer.id].usedSP += totalSP;
    };

    await assignGroupModal(bothKids,   true,  true);  // Both studio+CW → 1 designer from either pool
    await assignGroupModal(studioKids, true,  false); // All studio  → 1 designer
    await assignGroupModal(cwKids,     false, true);  // All CW      → 1 designer
    await assignGroupModal(bauKids,    false, false); // All design  → 1 designer

    if (lastData) { document.getElementById('modalContent').innerHTML = buildModalContent(lastData); setupCommentImagePaste(); }
    await loadTickets();
  } else {
    const sp = parseInt(document.getElementById('storyPointsInput')?.value, 10) || (t?.storyPoints || 0);
    if (!sp) { alert('Set story points before auto-assigning.'); return; }
    const loads = buildDesignerLoads();
    const designer = pickBestDesigner(loads, sp);
    if (!designer) { alert('No available designers.'); return; }
    try {
      const { data } = await window.api.put(`/api/requests/${ticketId}`, {
        assignedTo: { id: designer.id, name: designer.name, email: designer.email }
      });
      document.getElementById('modalContent').innerHTML = buildModalContent(data);
      setupCommentImagePaste();
      await loadTickets();
    } catch (err) { alert(err.message); }
  }
};

window.autoAssignAll = async function () {
  if (!teamMembers.length) { alert('No team members to assign to.'); return; }
  const unassigned = tickets.filter(t => !t.assignedTo);
  if (!unassigned.length) { alert('No unassigned tickets.'); return; }

  // Eligible: tickets with children that have SP, or childless tickets with parent SP
  const withSP    = unassigned.filter(t =>
    t.childIssues?.length
      ? t.childIssues.some(c => c.storyPoints != null && c.storyPoints > 0)
      : (t.storyPoints != null && t.storyPoints > 0)
  );
  const skippedSP = unassigned.length - withSP.length;

  if (!withSP.length) {
    alert(`No unassigned tickets have story points set.\n\nSet story points on sub-tasks first.\n\n${skippedSP} ticket${skippedSP !== 1 ? 's' : ''} skipped (no story points).`);
    return;
  }

  const btn = document.getElementById('autoAssignAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⚡ Assigning…'; }

  const restoreBtn = () => { const b = document.getElementById('autoAssignAllBtn'); if (b) { b.disabled = false; b.textContent = '⚡ Auto-assign'; } };

  const sorted = [...withSP].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.fields?.priority] ?? 4;
    const pb = PRIORITY_ORDER[b.fields?.priority] ?? 4;
    if (pa !== pb) return pa - pb;
    return new Date(a.submittedAt) - new Date(b.submittedAt);
  });

  const loads  = buildDesignerLoads();
  let assigned = 0;

  for (const t of sorted) {
    if (t.childIssues?.length) {
      const bothKids   = t.childIssues.filter(c => c.is_need_studio && c.is_need_copywriting && c.storyPoints > 0);
      const studioKids = t.childIssues.filter(c => c.is_need_studio && !c.is_need_copywriting && c.storyPoints > 0);
      const cwKids     = t.childIssues.filter(c => c.is_need_copywriting && !c.is_need_studio && c.storyPoints > 0);
      const bauKids    = t.childIssues.filter(c => !c.is_need_studio && !c.is_need_copywriting && c.storyPoints > 0);

      const assignGroup = async (kids, isStudio, isCW) => {
        if (!kids.length) return;
        const totalSP  = kids.reduce((s, c) => s + c.storyPoints, 0);
        const eligible = getEligibleDesignersForTask(t.project, isStudio, isCW);
        if (!eligible.length) return;
        const sub = {};
        for (const m of eligible) sub[m.id] = loads[m.id] || { member: m, usedSP: 0, maxSP: m.maxStoryPoints || 35 };
        const designer = pickBestDesigner(sub, totalSP);
        if (!designer) return;
        for (const c of kids) {
          try {
            await window.api.put(`/api/requests/${t.id}/children/${c.id}`, {
              assignedTo: { id: designer.id, name: designer.name, email: designer.email }
            });
            assigned++;
          } catch {}
        }
        if (!loads[designer.id]) loads[designer.id] = { member: designer, usedSP: 0, maxSP: designer.maxStoryPoints || 10 };
        loads[designer.id].usedSP += totalSP;
      };

      await assignGroup(bothKids,   true,  true);  // Both studio+CW: best-fit from either pool
      await assignGroup(studioKids, true,  false); // Studio: one designer per ticket
      await assignGroup(cwKids,     false, true);  // CW: one designer per ticket

      // BAU: assign individually by project scope
      // BAU design: ONE designer for ALL design sub-tasks in this ticket
      await assignGroup(bauKids, false, false);
    } else {
      // No children: assign parent ticket directly
      const designer = pickBestDesigner(loads, t.storyPoints);
      if (!designer) continue;
      try {
        await window.api.put(`/api/requests/${t.id}`, {
          assignedTo: { id: designer.id, name: designer.name, email: designer.email }
        });
        if (!loads[designer.id]) loads[designer.id] = { member: designer, usedSP: 0, maxSP: designer.maxStoryPoints || 10 };
        loads[designer.id].usedSP += t.storyPoints || 0;
        assigned++;
      } catch {}
    }
  }

  try {
    await loadTickets();
    const area   = document.getElementById('contentArea');
    const notice = document.createElement('div');
    notice.className = 'alert alert-success';
    notice.style.marginBottom = '16px';
    let msg = `✓ Auto-assigned ${assigned} sub-task${assigned !== 1 ? 's' : ''} using scope-aware load balancing (priority-ordered).`;
    if (skippedSP) msg += `  ${skippedSP} ticket${skippedSP !== 1 ? 's' : ''} skipped — no story points.`;
    notice.textContent = msg;
    area.insertBefore(notice, area.firstChild);
    setTimeout(() => notice.remove(), 6000);
  } catch (err) {
    restoreBtn();
    alert(err.message);
  }
};

window.updateDesignerCapacity = async function (designerId, input) {
  const cap = parseInt(input.value, 10);
  if (isNaN(cap) || cap < 1) { input.value = input.dataset.prev || 35; return; }
  try {
    await window.api.put(`/api/users/${designerId}/capacity`, { maxStoryPoints: cap });
    const m = teamMembers.find(x => x.id === designerId);
    if (m) m.maxStoryPoints = cap;
    input.dataset.prev = cap;
  } catch (err) {
    alert(err.message);
    input.value = input.dataset.prev || 35;
  }
};

// ── Child rows (shared) ────────────────────────────────────────────────────

function childRow(ticketId, c) {
  const sel = childStatusSelect(ticketId, c);
  return `
    <div class="child-item">
      <span class="child-dot"></span>
      ${c.ticketId ? `<span class="ticket-id-badge ticket-id-sm">${escHtml(c.ticketId)}</span>` : ''}
      <span class="child-title">${escHtml(childLabel(c))}</span>
      <span class="child-due">${c.child_due ? fmtDate(c.child_due) : ''}</span>
      ${c.storyPoints != null ? `<span class="sp-badge" style="font-size:10px;padding:1px 6px">SP:${c.storyPoints}</span>` : ''}
      ${c.assignedTo ? `<span class="assignee-tag" style="font-size:10px;padding:1px 8px">${escHtml(c.assignedTo.name)}</span>` : ''}
      <span class="status-badge status-${c.status} status-sm">${STATUS_LABELS[c.status]||c.status}</span>
      ${sel}
    </div>`;
}

function childNextStatuses(currentStatus, role) {
  if (role === 'creative_designer') return DESIGNER_NEXT[currentStatus] || [];
  if (role === 'creative_lead')     return LEAD_NEXT[currentStatus]     || [];
  if (role === 'admin') return [...(DESIGNER_NEXT[currentStatus]||[]), ...(LEAD_NEXT[currentStatus]||[])];
  return [];
}

// ── Child status dropdown ──────────────────────────────────────────────────

const CHILD_STATUS_COLORS = {
  in_progress:   { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' },
  on_review:     { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
  need_revision: { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
  revision:      { bg: '#ffedd5', color: '#9a3412', border: '#fdba74' },
  revised:       { bg: '#ccfbf1', color: '#065f46', border: '#5eead4' },
  approved:      { bg: '#dcfce7', color: '#166534', border: '#86efac' }
};

function statusTransitionBtn(ticketId, s, fn) {
  const c = CHILD_STATUS_COLORS[s] || {};
  const style = c.bg ? `background:${c.bg};color:${c.color};border-color:${c.border}` : '';
  return `<button class="status-transition-btn" style="${style}"
    onclick="event.stopPropagation();${fn}('${ticketId}','${s}')">${STATUS_LABELS[s]}</button>`;
}

function buildChildStatusButtons(ticketId, childId, nextStatuses, isModal = false) {
  if (!nextStatuses.length) return '';
  const fn = isModal ? 'changeChildStatusModal' : 'changeChildStatus';
  const btns = nextStatuses.map(s => {
    const c = CHILD_STATUS_COLORS[s] || {};
    const style = c.bg ? `background:${c.bg};color:${c.color};border-color:${c.border}` : '';
    return `<button class="status-transition-btn" style="${style}"
      onclick="event.stopPropagation();${fn}('${ticketId}','${childId}','${s}')">${STATUS_LABELS[s]}</button>`;
  }).join('');
  return `<div class="child-status-actions" onclick="event.stopPropagation()">${btns}</div>`;
}

function childStatusSelect(ticketId, c) {
  const next = childNextStatuses(c.status, currentUser.role);
  return buildChildStatusButtons(ticketId, c.id, next, false);
}

function childStatusSelectModal(ticketId, c) {
  const next = childNextStatuses(c.status, currentUser.role);
  return buildChildStatusButtons(ticketId, c.id, next, true);
}

// ── Ticket Modal ───────────────────────────────────────────────────────────

window.openTicketModal = async function (id) {
  pendingCommentImage = null;
  const modal = document.getElementById('ticketModal');
  document.getElementById('modalContent').innerHTML = '<div class="loading-state">Loading…</div>';
  modal.style.display = 'flex';
  try {
    const { data: t } = await window.api.get(`/api/requests/${id}`);
    document.getElementById('modalContent').innerHTML = buildModalContent(t);
    setupCommentImagePaste();
  } catch (err) {
    document.getElementById('modalContent').innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
};

function buildChildDiscussion(ticketId, c) {
  const comments = c.comments || [];
  const count    = comments.length;
  const latest   = comments[count - 1];

  const previewHtml = latest
    ? `<div class="child-latest-comment">
        <span class="child-latest-author">${escHtml(latest.postedBy.name)}:</span>
        <span class="child-latest-text">${escHtml(latest.text || '📎 image')}</span>
      </div>`
    : `<span class="child-no-comment">No discussion yet</span>`;

  return `
    <div class="child-discussion">
      <div class="child-disc-preview">
        <span class="child-disc-label">Discussion</span>
        ${previewHtml}
        <button class="child-disc-open-btn" onclick="openChildDiscussion('${ticketId}','${c.id}')">
          ${count > 0 ? `${count} comment${count !== 1 ? 's' : ''} · View` : 'Start'}
        </button>
      </div>
    </div>`;
}

function buildChildDiscPopupHtml(c) {
  const comments     = c.comments || [];
  const commentsHtml = comments.length
    ? comments.map(cm => `
        <div class="comment-item">
          <div class="comment-header">
            <span class="comment-author">${escHtml(cm.postedBy.name)}</span>
            <span class="role-chip role-${cm.postedBy.role} role-chip-sm">${ROLE_LABELS[cm.postedBy.role]||cm.postedBy.role}</span>
            <span class="comment-time">${fmtDatetime(cm.postedAt)}</span>
          </div>
          ${cm.text ? `<p class="comment-text">${escHtml(cm.text)}</p>` : ''}
          ${cm.imageData ? `<img class="comment-img" src="${cm.imageData}" alt="image" onclick="window.open(this.src,'_blank')">` : ''}
        </div>`).join('')
    : '<p class="no-comments">No comments yet. Be the first to comment.</p>';

  return `
    <div class="child-disc-popup">
      <div class="child-disc-popup-header">
        <div>
          <div class="child-disc-popup-sub">Subtask Discussion</div>
          <div class="child-disc-popup-title">${escHtml(childLabel(c))}</div>
        </div>
        <button class="modal-close" onclick="closeChildDiscussion()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="child-disc-popup-body" id="childDiscBody">${commentsHtml}</div>
      <div class="child-disc-popup-form">
        <div id="childDiscImgPreview"></div>
        <textarea id="childDiscInput" class="comment-textarea"
          placeholder="Add a comment… (paste image to attach)" rows="3"></textarea>
        <button class="btn btn-primary btn-sm" onclick="postChildDiscComment()">Post Comment</button>
      </div>
    </div>`;
}

function buildModalContent(t) {
  currentModalTicket = t;
  const proj   = projects.find(p => p.id === t.project);
  const title  = t.fields?.title || '(no title)';
  const role   = currentUser.role;
  const status = t.status;

  // Declare canDelete early — it is referenced inside childSection (built below)
  const canDelete = role === 'admin' || role === 'creative_lead';

  const nextStatuses  = (role === 'creative_lead' || role === 'admin') ? (LEAD_NEXT[status]||[]) : (DESIGNER_NEXT[status]||[]);
  // Parent status is auto-derived when sub-tasks exist — hide manual move button on parent
  const statusSection = (!t.childIssues?.length && nextStatuses.length && role !== 'requester') ? `
    <div class="modal-section">
      <div class="modal-section-title">Move Status</div>
      <div class="status-actions">
        ${nextStatuses.map(s => statusTransitionBtn(t.id, s, 'changeStatusModal')).join('')}
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
        <button class="btn btn-sm btn-outline" onclick="autoAssignTicketModal('${t.id}')" title="Auto-assign using load balancing">⚡ Auto</button>
      </div>
    </div>` : '';

  const canEditSP    = role === 'creative_lead' || role === 'creative_designer' || role === 'admin';
  const hasChildren  = t.childIssues?.length > 0;
  const totalSP      = t.storyPoints ?? 0;

  // Parent-level SP: aggregated (read-only) when ticket has sub-tasks; editable otherwise
  const spSection = hasChildren ? `
    <div class="modal-section">
      <div class="modal-section-title">Story Points (Total)</div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="sp-badge" style="font-size:13px;padding:4px 14px">SP: ${totalSP}</span>
        <span style="font-size:11px;color:var(--text-muted)">Aggregated from sub-tasks — set SP on each sub-task below</span>
      </div>
    </div>` : canEditSP ? `
    <div class="modal-section">
      <div class="modal-section-title">Story Points</div>
      <div class="sp-row">
        <input type="number" id="storyPointsInput" class="story-points-input"
          value="${t.storyPoints != null ? t.storyPoints : ''}" min="0" max="999" placeholder="—">
        <button class="btn btn-sm btn-outline" onclick="updateStoryPoints('${t.id}')">Save</button>
      </div>
    </div>` : (t.storyPoints != null ? `
    <div class="modal-section">
      <div class="modal-section-title">Story Points</div>
      <span class="sp-badge">SP: ${t.storyPoints}</span>
    </div>` : '');

  // Designers only see sub-tasks assigned to them; leads/admins see all
  const allChildren     = t.childIssues || [];
  const displayChildren = role === 'creative_designer'
    ? allChildren.filter(c => c.assignedTo?.id === currentUser.id)
    : allChildren;

  const childIds = displayChildren.map(c => c.id).join(',');
  const childSectionTitle = role === 'creative_designer'
    ? `My Sub-tasks (${displayChildren.filter(c=>c.status==='approved').length}/${displayChildren.length} approved)`
    : `Sub-tasks (${allChildren.filter(c=>c.status==='approved').length}/${allChildren.length} approved)`;

  const approvedChildCount = (role === 'creative_designer'
    ? allChildren.filter(c => c.assignedTo?.id === currentUser.id)
    : allChildren).filter(c => c.status === 'approved').length;

  const childSection = displayChildren.length ? `
    <div class="modal-section">
      <details class="modal-subtask-details" open>
        <summary class="modal-subtask-summary">
          <span class="summary-arrow">▶</span>
          ${childSectionTitle}&nbsp;&nbsp;&nbsp;${approvedChildCount}/${displayChildren.length} approved
        </summary>
        <div class="modal-children">
          ${displayChildren.map(c => `
            <div class="modal-child-item">
              <div class="modal-child-main">
                ${c.ticketId ? `<span class="ticket-id-badge ticket-id-sm">${escHtml(c.ticketId)}</span>` : ''}
                <span class="child-title">${escHtml(childLabel(c))}</span>
                ${c.child_due ? `<span class="child-due">Due: ${fmtDate(c.child_due)}</span>` : ''}
                <span class="status-badge status-${c.status} status-sm">${STATUS_LABELS[c.status]||c.status}</span>
                ${c.is_need_studio      ? `<span class="studio-badge">🎬 Studio</span>` : ''}
                ${c.is_need_copywriting ? `<span class="cw-badge">✍️ CW</span>` : ''}
                ${canDelete ? `<button class="btn btn-sm btn-delete" style="margin-left:auto;flex-shrink:0;padding:2px 8px;font-size:11px" onclick="deleteSubtask('${t.id}','${c.id}',${JSON.stringify(childLabel(c))})">🗑</button>` : ''}
              </div>
              ${c.child_notes ? `<p class="child-notes">${escHtml(c.child_notes)}</p>` : ''}
              ${(c.is_need_studio || !c.is_need_copywriting) && (role === 'creative_designer' || role === 'creative_lead' || role === 'admin') ? `
              <div class="child-url-row">
                <div class="child-url-item">
                  <span class="child-url-label">📝 Draft:</span>
                  <input type="url" class="child-url-input" id="draft-${c.id}"
                    value="${escHtml(c.draft_url || '')}" placeholder="https://…">
                  <button class="btn btn-sm btn-outline" onclick="saveChildDraftUrl('${t.id}','${c.id}')">Save</button>
                  ${c.draft_url ? `<a href="${escHtml(c.draft_url)}" target="_blank" class="url-link">Open ↗</a>` : ''}
                </div>
                <div class="child-url-item">
                  <span class="child-url-label">✅ Final:</span>
                  <input type="url" class="child-url-input" id="final-${c.id}"
                    value="${escHtml(c.final_url || '')}" placeholder="https://…">
                  <button class="btn btn-sm btn-outline" onclick="saveChildFinalUrl('${t.id}','${c.id}')">Save</button>
                  ${c.final_url ? `<a href="${escHtml(c.final_url)}" target="_blank" class="url-link">Open ↗</a>` : ''}
                </div>
              </div>` : `
              ${(c.is_need_studio || !c.is_need_copywriting) && (c.draft_url || c.final_url) ? `<div class="child-url-row">
                ${c.draft_url ? `<div class="child-url-item"><span class="child-url-label">📝 Draft:</span><a href="${escHtml(c.draft_url)}" target="_blank" class="url-link">${escHtml(c.draft_url)}</a></div>` : ''}
                ${c.final_url ? `<div class="child-url-item"><span class="child-url-label">✅ Final:</span><a href="${escHtml(c.final_url)}" target="_blank" class="url-link">${escHtml(c.final_url)}</a></div>` : ''}
              </div>` : ''}`}
              <div class="child-assign-row">
                <span class="child-sp-label">Assign to:</span>
                ${(role === 'creative_lead' || role === 'admin') ? (() => {
                  const eligible = teamMembers.filter(m => {
                    const ps = m.projects || [];
                    if (c.is_need_studio && c.is_need_copywriting) return ps.includes('studio') || ps.includes('copywriting');
                    if (c.is_need_studio)       return ps.includes('studio');
                    if (c.is_need_copywriting)  return ps.includes('copywriting');
                    return ps.includes(t.project);
                  });
                  return eligible.length
                    ? `<select class="child-assignee-select" onchange="assignChildImmediate('${t.id}','${c.id}',this)">
                         <option value="">— Unassigned —</option>
                         ${eligible.map(m => `<option value="${m.id}" ${c.assignedTo?.id === m.id ? 'selected' : ''}>${escHtml(m.name)}</option>`).join('')}
                       </select>
                       ${c.is_need_studio      ? '<span class="studio-badge" style="font-size:10px">🎬 Studio</span>' : ''}
                       ${c.is_need_copywriting ? '<span class="cw-badge"     style="font-size:10px">✍️ CW</span>'     : ''}`
                    : `<span style="font-size:11px;color:var(--text-muted)">No eligible designers for this scope</span>`;
                })() : `<span class="assignee-tag" style="font-size:11px">${c.assignedTo ? escHtml(c.assignedTo.name) : '—'}</span>`}
              </div>
              <div class="child-sp-row">
                <span class="child-sp-label">Story Points:</span>
                ${canEditSP
                  ? `<input type="number" class="child-sp-input" id="sp-child-${c.id}" data-child-id="${c.id}"
                       value="${c.storyPoints != null ? c.storyPoints : ''}" min="0" max="999" placeholder="—">`
                  : `<span class="sp-badge" style="font-size:11px">${c.storyPoints != null ? 'SP: '+c.storyPoints : '—'}</span>`}
              </div>
              ${role !== 'requester' ? childStatusSelectModal(t.id, c) : ''}
              ${buildChildDiscussion(t.id, c)}
            </div>`).join('')}
        </div>
        ${canEditSP ? `
          <div style="padding:0 14px 14px;display:flex;justify-content:flex-end">
            <button class="btn btn-primary btn-sm" onclick="saveAllChildSP('${t.id}','${childIds}')">
              Save Story Points
            </button>
          </div>` : ''}
      </details>
    </div>` : '';

  const commentsHtml = (t.comments||[]).length
    ? t.comments.map(c => `
        <div class="comment-item">
          <div class="comment-header">
            <span class="comment-author">${escHtml(c.postedBy.name)}</span>
            <span class="role-chip role-${c.postedBy.role} role-chip-sm">${ROLE_LABELS[c.postedBy.role]||c.postedBy.role}</span>
            <span class="comment-time">${fmtDatetime(c.postedAt)}</span>
          </div>
          ${c.text ? `<p class="comment-text">${escHtml(c.text)}</p>` : ''}
          ${c.imageData ? `<img class="comment-img" src="${c.imageData}" alt="image" onclick="window.open(this.src,'_blank')">` : ''}
        </div>`).join('')
    : '<p class="no-comments">No comments yet.</p>';

  return `
    <div class="modal-header">
      <div class="modal-header-top">
        ${proj ? `<span class="meta-tag" style="color:${proj.color};font-weight:700">${proj.name}</span>` : ''}
        <span class="status-badge status-${status}">${STATUS_LABELS[status]||status}</span>
        ${canDelete ? `<button class="btn btn-sm btn-delete" style="margin-left:auto" onclick="deleteTicket('${t.id}',${JSON.stringify(title)})">🗑 Delete</button>` : ''}
      </div>
      ${t.ticketId ? `<div class="modal-ticket-id">${escHtml(t.ticketId)}</div>` : ''}
      <h2 class="modal-title" id="modalTitle">${escHtml(title)}</h2>
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
    ${t.ai_brief_note ? `<div class="modal-section ai-brief-note-section"><div class="modal-section-title"><span aria-hidden="true">🤖</span> AI Brief Notes <span class="ai-generated-tag">AI-Generated</span></div><div class="ai-brief-note-body">${escHtml(t.ai_brief_note)}</div></div>` : ''}
    ${statusSection}${assignSection}${spSection}${childSection}
    ${buildStatusHistory(t)}
    <div class="modal-section">
      <div class="modal-section-title">Discussion</div>
      <div class="comments-list">${commentsHtml}</div>
      <div class="comment-form">
        <textarea id="commentInput" class="comment-textarea" placeholder="Add a comment… (paste an image to attach)" rows="3"></textarea>
        <button class="btn btn-primary btn-sm" onclick="postComment('${t.id}')">Post Comment</button>
      </div>
    </div>`;
}

window.closeTicketModal = function () { document.getElementById('ticketModal').style.display = 'none'; };
window.closeModal = function (e) { if (e.target === document.getElementById('ticketModal')) closeTicketModal(); };

// ── Story Points ───────────────────────────────────────────────────────────

window.updateStoryPoints = async function (ticketId) {
  const input = document.getElementById('storyPointsInput');
  const raw   = input?.value?.trim();
  if (raw === '' || raw == null) return;
  const sp = parseInt(raw, 10);
  if (isNaN(sp) || sp < 0) { alert('Please enter a valid story point value (0 or more).'); return; }
  try {
    const { data } = await window.api.put(`/api/requests/${ticketId}`, { storyPoints: sp });
    document.getElementById('modalContent').innerHTML = buildModalContent(data);
    setupCommentImagePaste();
    await loadTickets();
  } catch (err) { alert(err.message); }
};

window.assignChildImmediate = async function (ticketId, childId, sel) {
  const id         = sel.value;
  const m          = id ? teamMembers.find(x => x.id === id) : null;
  const assignedTo = m ? { id: m.id, name: m.name, email: m.email } : null;

  // Studio/CW rule: all studio (or all CW) sub-tasks in the same parent share ONE assignee
  const t     = tickets.find(x => x.id === ticketId);
  const child = (t?.childIssues || []).find(c => c.id === childId);
  const toAssign = child?.is_need_studio
    ? (t?.childIssues || []).filter(c => c.is_need_studio)
    : child?.is_need_copywriting
      ? (t?.childIssues || []).filter(c => c.is_need_copywriting)
      : [{ id: childId }];

  let lastData = null;
  for (const c of toAssign) {
    try {
      const { data } = await window.api.put(`/api/requests/${ticketId}/children/${c.id}`, { assignedTo });
      lastData = data;
    } catch (err) { alert(err.message); return; }
  }

  if (lastData) {
    document.getElementById('modalContent').innerHTML = buildModalContent(lastData);
    setupCommentImagePaste();
  }
  await loadTickets();
};

// Draft URL → saves + auto-moves in_progress → on_review
window.saveChildDraftUrl = async function (ticketId, childId) {
  const url = document.getElementById(`draft-${childId}`)?.value?.trim();
  if (!url) return;
  const t = tickets.find(x => x.id === ticketId);
  const c = (t?.childIssues || []).find(x => x.id === childId);
  const updates = { draft_url: url };
  if (c?.status === 'in_progress') updates.status = 'on_review';
  try {
    const { data } = await window.api.put(`/api/requests/${ticketId}/children/${childId}`, updates);
    document.getElementById('modalContent').innerHTML = buildModalContent(data);
    setupCommentImagePaste();
    await loadTickets();
  } catch (err) { alert(err.message); }
};

// Final URL → saves + auto-advances status based on current state and role
window.saveChildFinalUrl = async function (ticketId, childId) {
  const url = document.getElementById(`final-${childId}`)?.value?.trim();
  if (!url) return;
  try { new URL(url); } catch { alert('Please enter a valid URL (e.g. https://…)'); return; }
  const t = tickets.find(x => x.id === ticketId);
  const c = (t?.childIssues || []).find(x => x.id === childId);
  const role = currentUser.role;
  const updates = { final_url: url };
  // Auto-advance: leads/admins can approve; designers can only move to revised
  if (role === 'creative_lead' || role === 'admin') {
    if (c?.status === 'on_review' || c?.status === 'revised') updates.status = 'approved';
  } else if (role === 'creative_designer') {
    if (c?.status === 'revision') updates.status = 'revised';
  }
  try {
    const { data } = await window.api.put(`/api/requests/${ticketId}/children/${childId}`, updates);
    document.getElementById('modalContent').innerHTML = buildModalContent(data);
    setupCommentImagePaste();
    await loadTickets();
  } catch (err) { alert(err.message); }
};

window.saveAllChildSP = async function (ticketId, childIdsCsv) {
  const childIds = childIdsCsv.split(',').filter(Boolean);
  const btn = document.querySelector(`button[onclick*="saveAllChildSP"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  let lastData = null;
  for (const childId of childIds) {
    const input = document.getElementById(`sp-child-${childId}`);
    if (!input) continue;
    const raw = input.value.trim();
    if (raw === '') continue;
    const sp = parseInt(raw, 10);
    if (isNaN(sp) || sp < 0) continue;
    try {
      const { data } = await window.api.put(`/api/requests/${ticketId}/children/${childId}`, { storyPoints: sp });
      lastData = data;
    } catch (err) { alert(err.message); }
  }

  if (lastData) {
    document.getElementById('modalContent').innerHTML = buildModalContent(lastData);
    setupCommentImagePaste();
  }
  await loadTickets();
};

// ── Comment Image Paste ────────────────────────────────────────────────────

function setupCommentImagePaste() {
  const textarea = document.getElementById('commentInput');
  if (!textarea) return;
  textarea.addEventListener('paste', handleCommentPaste);
}

async function handleCommentPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file    = item.getAsFile();
      const dataUrl = await resizeImage(file, 400);
      pendingCommentImage = dataUrl;
      showImagePreview(dataUrl);
      break;
    }
  }
}

function resizeImage(file, maxWidth) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width);
      const w     = Math.round(img.width  * scale);
      const h     = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.65));
    };
    img.src = url;
  });
}

function showImagePreview(dataUrl) {
  const form = document.querySelector('.comment-form');
  if (!form) return;
  let preview = document.getElementById('commentImgPreview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id        = 'commentImgPreview';
    preview.className = 'img-preview-wrap';
    form.insertBefore(preview, form.querySelector('button'));
  }
  preview.innerHTML = `
    <img src="${dataUrl}" alt="Preview">
    <button class="img-preview-remove" onclick="clearCommentImage()" title="Remove image">×</button>`;
}

window.clearCommentImage = function () {
  pendingCommentImage = null;
  const preview = document.getElementById('commentImgPreview');
  if (preview) preview.remove();
};

// ── Toast Notifications ────────────────────────────────────────────────────

function showToast(message) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id        = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  // Trigger enter animation on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
  });

  // Auto-dismiss after 3 seconds
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3000);
}

// ── Actions ────────────────────────────────────────────────────────────────

const _statusInFlight = new Set();

window.changeStatus = async function (id, status) {
  const key = `${id}:${status}`;
  if (_statusInFlight.has(key)) return;
  _statusInFlight.add(key);
  try {
    await window.api.put(`/api/requests/${id}`, { status });
    showToast(`Status updated to ${STATUS_LABELS[status] || status}`);
    await loadTickets();
  }
  catch (err) { alert(err.message); }
  finally { _statusInFlight.delete(key); }
};

window.changeStatusModal = async function (id, status) {
  const key = `modal:${id}:${status}`;
  if (_statusInFlight.has(key)) return;
  _statusInFlight.add(key);
  try {
    const { data } = await window.api.put(`/api/requests/${id}`, { status });
    document.getElementById('modalContent').innerHTML = buildModalContent(data);
    setupCommentImagePaste();
    showToast(`Status updated to ${STATUS_LABELS[status] || status}`);
    await loadTickets();
  }
  catch (err) { alert(err.message); }
  finally { _statusInFlight.delete(key); }
};

window.changeChildStatus = async function (ticketId, childId, status) {
  const key = `child:${ticketId}:${childId}:${status}`;
  if (_statusInFlight.has(key)) return;
  _statusInFlight.add(key);
  try { await window.api.put(`/api/requests/${ticketId}/children/${childId}`, { status }); await loadTickets(); }
  catch (err) { alert(err.message); }
  finally { _statusInFlight.delete(key); }
};

window.changeChildStatusModal = async function (ticketId, childId, status) {
  const key = `childmodal:${ticketId}:${childId}:${status}`;
  if (_statusInFlight.has(key)) return;
  _statusInFlight.add(key);
  try {
    const { data } = await window.api.put(`/api/requests/${ticketId}/children/${childId}`, { status });
    document.getElementById('modalContent').innerHTML = buildModalContent(data);
    setupCommentImagePaste();
    await loadTickets();
  }
  catch (err) { alert(err.message); }
  finally { _statusInFlight.delete(key); }
};

window.assignFromSelect = async function (ticketId, sel) {
  const id         = sel.value;
  const assignedTo = id ? (() => { const m = teamMembers.find(x => x.id === id); return m ? { id: m.id, name: m.name, email: m.email } : null; })() : null;
  try { await window.api.put(`/api/requests/${ticketId}`, { assignedTo }); await loadTickets(); }
  catch (err) { alert(err.message); sel.value = ''; }
};

window.assignTicketModal = async function (ticketId, sel) {
  const id         = sel.value;
  const assignedTo = id ? (() => { const m = teamMembers.find(x => x.id === id); return m ? { id: m.id, name: m.name, email: m.email } : null; })() : null;
  try {
    const { data } = await window.api.put(`/api/requests/${ticketId}`, { assignedTo });
    document.getElementById('modalContent').innerHTML = buildModalContent(data);
    setupCommentImagePaste();
    await loadTickets();
  }
  catch (err) { alert(err.message); }
};

window.deleteSubtask = async function (ticketId, childId, label) {
  if (!confirm(`Delete sub-task "${label}"?\n\nThis will remove the sub-task, its comments, and history. This cannot be undone.`)) return;
  try {
    const { data } = await window.api.delete(`/api/requests/${ticketId}/children/${childId}`);
    document.getElementById('modalContent').innerHTML = buildModalContent(data);
    setupCommentImagePaste();
    showToast('Sub-task deleted');
    await loadTickets();
  } catch (err) { alert(err.message); }
};

window.deleteTicket = async function (id, title) {
  if (!confirm(`Are you sure to delete "${title}"?`)) return;
  try {
    await window.api.delete(`/api/requests/${id}`);
    closeTicketModal();
    showToast('Ticket deleted');
    await loadTickets();
  } catch (err) { alert(err.message); }
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
  if (!text && !pendingCommentImage) return;
  const body = { text: text || '' };
  if (pendingCommentImage) body.imageData = pendingCommentImage;
  try {
    const { data } = await window.api.post(`/api/requests/${ticketId}/comments`, body);
    pendingCommentImage = null;
    document.getElementById('modalContent').innerHTML = buildModalContent(data);
    setupCommentImagePaste();
  }
  catch (err) {
    alert(err.message);
    // Clear stale pending image so a retry doesn't re-attach an image the server never received
    pendingCommentImage = null;
    const preview = document.getElementById('commentImgPreview');
    if (preview) preview.remove();
  }
};

window.openChildDiscussion = function (ticketId, childId) {
  // Clear any stale image from a previously open discussion
  pendingChildDiscImg = null;

  childDiscTicketId = ticketId;
  childDiscChildId  = childId;
  const c = (currentModalTicket?.childIssues || []).find(x => x.id === childId);
  if (!c) return;

  let overlay = document.getElementById('childDiscOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id        = 'childDiscOverlay';
    overlay.className = 'child-disc-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeChildDiscussion(); });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML    = buildChildDiscPopupHtml(c);
  overlay.style.display = 'flex';
  setupChildDiscPaste();
  const body = overlay.querySelector('#childDiscBody');
  if (body) body.scrollTop = body.scrollHeight;
  overlay.querySelector('#childDiscInput')?.focus();
};

window.closeChildDiscussion = function () {
  const overlay = document.getElementById('childDiscOverlay');
  if (overlay) overlay.style.display = 'none';
  pendingChildDiscImg = null;
};

window.postChildDiscComment = async function () {
  if (!childDiscTicketId || !childDiscChildId) return;
  const input = document.getElementById('childDiscInput');
  const text  = input?.value?.trim();
  if (!text && !pendingChildDiscImg) return;
  const body = { text: text || '' };
  if (pendingChildDiscImg) body.imageData = pendingChildDiscImg;
  try {
    const { data } = await window.api.post(
      `/api/requests/${childDiscTicketId}/children/${childDiscChildId}/comments`, body
    );
    pendingChildDiscImg = null;
    // Refresh modal inline preview
    document.getElementById('modalContent').innerHTML = buildModalContent(data);
    setupCommentImagePaste();
    // Re-render popup with fresh child data
    const c = (data.childIssues || []).find(x => x.id === childDiscChildId);
    if (c) {
      const overlay = document.getElementById('childDiscOverlay');
      if (overlay) {
        overlay.innerHTML    = buildChildDiscPopupHtml(c);
        overlay.style.display = 'flex';
        setupChildDiscPaste();
        const bd = overlay.querySelector('#childDiscBody');
        if (bd) bd.scrollTop = bd.scrollHeight;
        overlay.querySelector('#childDiscInput')?.focus();
      }
    }
  }
  catch (err) { alert(err.message); }
};

function setupChildDiscPaste() {
  const ta = document.getElementById('childDiscInput');
  if (!ta) return;
  ta.removeEventListener('paste', handleChildDiscPaste);
  ta.addEventListener('paste', handleChildDiscPaste);
}

async function handleChildDiscPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const dataUrl       = await resizeImage(item.getAsFile(), 400);
      pendingChildDiscImg = dataUrl;
      const preview       = document.getElementById('childDiscImgPreview');
      if (preview) {
        preview.className = 'img-preview-wrap';
        preview.innerHTML = `<img src="${dataUrl}" alt="Preview">
          <button class="img-preview-remove" onclick="clearChildDiscImg()" title="Remove">×</button>`;
      }
      break;
    }
  }
}

window.clearChildDiscImg = function () {
  pendingChildDiscImg = null;
  const preview = document.getElementById('childDiscImgPreview');
  if (preview) { preview.className = ''; preview.innerHTML = ''; }
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

function statCard(value, label, variant, subValue, subLabel, subAction, subId, scId) {
  const sub = subValue != null ? `
    <div class="stat-sub${subAction ? ' stat-sub-clickable' : ''}"
      ${subAction ? `onclick="${subAction}" id="${subId || ''}"` : ''}>
      <span class="stat-sub-value"${scId ? ` id="scs-${scId}"` : ''}>${subValue}</span> ${subLabel || ''}
    </div>` : '';
  return `<div class="stat-card${variant ? ' stat-card-'+variant : ''}"${scId ? ` data-sc="${scId}"` : ''}>
    <div class="stat-value"${scId ? ` id="scv-${scId}"` : ''}>${value}</div>
    <div class="stat-label">${label}</div>
    ${sub}
  </div>`;
}

// Update lead stat card values in-place (avoids full re-render on filter change)
function updateLeadStatCards(filtered) {
  const sv = (id, val) => { const e = document.getElementById(`scv-${id}`); if (e) e.textContent = val; };
  const ss = (id, val) => { const e = document.getElementById(`scs-${id}`); if (e) e.textContent = val; };
  const totalSubs = filtered.reduce((s, t) => s + (t.childIssues?.length || 0), 0);
  const unassSubs = filtered.reduce((s, t) => s + (t.childIssues || []).filter(c => !c.assignedTo).length, 0);
  sv('total', filtered.length);               ss('total', totalSubs);
  sv('unas',  filtered.filter(t => !t.assignedTo).length); ss('unas', unassSubs);
  sv('inp',   filtered.filter(t => t.status === 'in_progress').length);
  sv('rev',   filtered.filter(t => t.status === 'on_review' || t.status === 'revised').length);
}

function updateRequesterStatCards(filtered) {
  const sv = (id, val) => { const e = document.getElementById(`scv-${id}`); if (e) e.textContent = val; };
  sv('req-total', filtered.length);
  sv('req-pend',  filtered.filter(t => t.status === 'requested').length);
  sv('req-act',   filtered.filter(t => t.status !== 'approved').length);
  sv('req-appr',  filtered.filter(t => t.status === 'approved').length);
}

function updateDesignerStatCards(filtered) {
  const sv = (id, val) => { const e = document.getElementById(`scv-${id}`); if (e) e.textContent = val; };
  sv('ds-total', filtered.length);
  sv('ds-inp',   filtered.filter(t => t.status === 'in_progress').length);
  sv('ds-att',   filtered.filter(t => ['need_revision','revision','revised'].includes(t.status)).length);
}

function emptyState(title, msg, link, linkLabel) {
  return `<div class="empty-state-full" role="status">
    <div class="empty-icon" aria-hidden="true">📭</div>
    <h3>${title}</h3>
    <p>${msg}</p>
    ${link ? `<a href="${link}" class="btn btn-primary" style="margin-top:16px">${linkLabel}</a>` : ''}
  </div>`;
}

function contextEmptyState(role, view) {
  if (role === 'creative_designer') {
    return emptyState('No tickets assigned yet', 'Your creative lead will assign tickets here. Check back soon.');
  }
  if (role === 'requester') {
    if (view === 'mine') {
      return emptyState('No requests yet', 'Submit your first creative request to get started.', '/form', 'New Request →');
    }
    // queue
    return emptyState('No active tickets in your project queue', 'Tickets submitted by your team will appear here.');
  }
  // creative_lead / admin
  return emptyState('All caught up!', 'No active tickets match your current filters.');
}

function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function childLabel(c) {
  if (c.child_title) return c.child_title;
  const parts = [];
  if (c.task_type) parts.push(c.task_type.charAt(0).toUpperCase() + c.task_type.slice(1));
  const asset = c.asset_type || c.objective_type || c.packaging_type || '';
  if (asset) parts.push(asset.replace(/_/g, ' '));
  if (!asset && c.platform) parts.push(c.platform);
  return parts.join(' · ') || '—';
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

// ── Notifications ──────────────────────────────────────────────────────────

function notifBellHtml() {
  return `<div class="notif-wrap" id="notifWrap">
    <button class="notif-btn" title="Stuck ticket reminders" aria-label="Notifications" aria-haspopup="true" aria-expanded="false" id="notifToggleBtn" onclick="toggleNotifPanel()">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 01-3.46 0"/>
      </svg>
      <span class="notif-badge" id="notifBadge" style="display:none" aria-label="unread notifications">0</span>
    </button>
    <div class="notif-panel" id="notifPanel" style="display:none" role="region" aria-label="Tickets awaiting approval">
      <div class="notif-panel-head">
        <span>Needs Approval</span>
        <button class="notif-refresh" onclick="event.stopPropagation();loadNotifications()" title="Refresh" aria-label="Refresh notifications">↻</button>
      </div>
      <div class="notif-list" id="notifList"><div class="notif-empty">Loading…</div></div>
    </div>
  </div>`;
}

window.loadNotifications = async function () {
  try {
    const { data } = await window.api.get('/api/notifications/stuck');
    updateNotifUI(data);
  } catch {}
};

function updateNotifUI(items) {
  const badge = document.getElementById('notifBadge');
  const list  = document.getElementById('notifList');
  if (!badge || !list) return;

  if (items.length) {
    badge.textContent   = items.length > 9 ? '9+' : String(items.length);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  list.innerHTML = items.length
    ? items.map(n => {
        const urgencyClass = n.daysWaiting >= 2 ? 'notif-item-danger' : 'notif-item-warning';
        const waitLabel    = n.daysWaiting === 0 ? 'Today' : `${n.daysWaiting} day${n.daysWaiting !== 1 ? 's' : ''} waiting`;
        return `
        <div class="notif-item ${urgencyClass}" role="button" tabindex="0"
             onclick="closeNotifPanel();openTicketModal('${n.id}')"
             onkeydown="if(event.key==='Enter'||event.key===' '){closeNotifPanel();openTicketModal('${n.id}')}"
             aria-label="Needs approval: ${escHtml(n.title)}">
          <div class="notif-item-top">
            ${n.ticketId ? `<span class="notif-ticket-id">${escHtml(n.ticketId)}</span>` : ''}
            <span class="notif-title">${escHtml(n.title)}</span>
          </div>
          <div class="notif-meta">
            <span class="status-badge status-${n.status} status-sm">${STATUS_LABELS[n.status]||n.status}</span>
            <span class="notif-days">${waitLabel}</span>
          </div>
        </div>`;
      }).join('')
    : '<div class="notif-empty">No tickets awaiting approval.</div>';
}

window.toggleNotifPanel = function () {
  const panel = document.getElementById('notifPanel');
  const btn   = document.getElementById('notifToggleBtn');
  if (!panel) return;
  const isOpen = panel.style.display === 'none';
  panel.style.display = isOpen ? 'block' : 'none';
  if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (isOpen) loadNotifications();
};

window.closeNotifPanel = function () {
  const panel = document.getElementById('notifPanel');
  const btn   = document.getElementById('notifToggleBtn');
  if (panel) panel.style.display = 'none';
  if (btn) btn.setAttribute('aria-expanded', 'false');
};

init();
