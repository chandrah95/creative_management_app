import '/js/api.js';

let projects = [];

async function init() {
  loadUser();
  await loadProjects();
  await loadRequests();
}

function loadUser() {
  const raw = localStorage.getItem('crp_user') || sessionStorage.getItem('crp_user');
  if (!raw) return;
  const user = JSON.parse(raw);
  document.getElementById('userName').textContent = user.name;
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('userAvatar').textContent = user.name[0].toUpperCase();
}

async function loadProjects() {
  try {
    const { data } = await window.api.get('/api/forms/projects');
    projects = data;
    renderProjectNav(data);
    populateProjectFilter(data);
  } catch {}
}

function renderProjectNav(list) {
  const nav = document.getElementById('projectNav');
  nav.innerHTML = list.map(p => `
    <a class="project-nav-item" href="/form?project=${p.id}">
      <span class="project-nav-dot" style="background:${p.color}"></span>
      <span class="project-nav-label">${p.name}</span>
    </a>
  `).join('');
}

function populateProjectFilter(list) {
  const sel = document.getElementById('filterProject');
  list.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

window.loadRequests = async function () {
  const project = document.getElementById('filterProject').value;
  const status  = document.getElementById('filterStatus').value;
  const params  = new URLSearchParams();
  if (project) params.set('project', project);
  if (status)  params.set('status', status);

  const tbody = document.getElementById('requestsBody');
  tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Loading…</td></tr>';

  try {
    const { data } = await window.api.get(`/api/requests?${params}`);
    updateStats(data);
    renderTable(data);
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Failed to load requests.</td></tr>';
  }
};

function updateStats(data) {
  document.getElementById('statTotal').textContent      = data.length;
  document.getElementById('statPending').textContent    = data.filter(r => r.status === 'pending').length;
  document.getElementById('statInProgress').textContent = data.filter(r => r.status === 'in_progress').length;
  document.getElementById('statDone').textContent       = data.filter(r => r.status === 'completed').length;
}

function renderTable(data) {
  const tbody = document.getElementById('requestsBody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No requests found.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(r => {
    const project = projects.find(p => p.id === r.project);
    const title   = r.fields?.title || '(no title)';
    const priority= r.fields?.priority || '';
    const date    = new Date(r.submittedAt).toLocaleDateString();
    return `
      <tr>
        <td><strong>${title}</strong></td>
        <td>${project ? `<span style="color:${project.color};font-weight:600">${project.name}</span>` : r.project}</td>
        <td>${priority ? `<span class="badge badge-${priority}">${priority}</span>` : '—'}</td>
        <td><span class="badge badge-${r.status}">${r.status.replace('_', ' ')}</span></td>
        <td>${date}</td>
        <td>${r.submittedBy?.name || '—'}</td>
      </tr>`;
  }).join('');
}

window.openNewRequest = function () {
  window.location.href = '/form';
};

init();
