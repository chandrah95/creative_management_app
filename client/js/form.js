import '/js/api.js';
import { buildFields, collectValues, validateFields } from './FormBuilder.js';

let formConfig = null;
let childIssueCount = 0;

async function init() {
  loadUser();
  await loadProjects();

  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('project');
  if (projectId) {
    await loadForm(projectId);
  } else {
    document.getElementById('projectPicker').style.display = 'block';
  }
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
    renderProjectNav(data);
    renderProjectPicker(data);
  } catch {}
}

function renderProjectNav(list) {
  const nav = document.getElementById('projectNav');
  const current = new URLSearchParams(window.location.search).get('project');
  nav.innerHTML = list.map(p => `
    <a class="project-nav-item ${p.id === current ? 'active' : ''}" href="/form?project=${p.id}">
      <span class="project-nav-dot" style="background:${p.color}"></span>
      <span class="project-nav-label">${p.name}</span>
    </a>
  `).join('');
}

function renderProjectPicker(list) {
  const grid = document.getElementById('projectPickerGrid');
  if (!grid) return;
  grid.innerHTML = list.map(p => `
    <div class="project-card" onclick="window.location.href='/form?project=${p.id}'">
      <div class="project-card-icon">${p.icon}</div>
      <div class="project-card-name">${p.name}</div>
      <div class="project-card-key" style="color:${p.color}">${p.jiraProject}</div>
    </div>
  `).join('');
}

async function loadForm(projectId) {
  try {
    const { data } = await window.api.get(`/api/forms/${projectId}`);
    formConfig = data;
    renderForm(data);
  } catch {
    document.getElementById('formContainer').innerHTML =
      '<div class="alert alert-error">Failed to load form configuration.</div>';
    document.getElementById('formContainer').style.display = 'block';
  }
}

function renderForm(config) {
  document.getElementById('breadcrumbProject').textContent = config.name;
  document.getElementById('formTitle').textContent = `New ${config.name} Request`;
  document.getElementById('formProjectBadge').textContent = config.name;

  buildFields(config.fields, document.getElementById('mainFields'));

  if (config.childIssue?.enabled) {
    document.getElementById('childIssueSection').style.display = 'block';
    document.getElementById('addChildLabel').textContent = config.childIssue.label || 'Add Sub-task';
  }

  document.getElementById('formContainer').style.display = 'block';
}

// ===== Child Issues =====
window.addChildIssue = function () {
  if (!formConfig?.childIssue?.fields) return;
  childIssueCount++;
  const idx = childIssueCount;
  const prefix = `child_${idx}_`;
  const list = document.getElementById('childIssuesList');

  const card = document.createElement('div');
  card.className = 'child-issue-card';
  card.id = `child-card-${idx}`;
  card.innerHTML = `
    <div class="child-issue-header">
      <span class="child-issue-number">Sub-task #${idx}</span>
      <button type="button" class="child-remove-btn" onclick="removeChildIssue(${idx})" title="Remove">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="fields-grid" id="child-fields-${idx}"></div>
  `;
  list.appendChild(card);
  buildFields(formConfig.childIssue.fields, document.getElementById(`child-fields-${idx}`), prefix);
};

window.removeChildIssue = function (idx) {
  const card = document.getElementById(`child-card-${idx}`);
  if (card) card.remove();
};

// ===== Form Submit =====
document.getElementById('requestForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!formConfig) return;

  const mainValid = validateFields(formConfig.fields);
  if (!mainValid) return;

  const fields = collectValues(formConfig.fields);

  const childIssues = [];
  if (formConfig.childIssue?.enabled) {
    const cards = document.querySelectorAll('.child-issue-card');
    let childValid = true;
    cards.forEach(card => {
      const idx = card.id.replace('child-card-', '');
      const prefix = `child_${idx}_`;
      const ok = validateFields(formConfig.childIssue.fields, prefix);
      if (!ok) childValid = false;
      else childIssues.push(collectValues(formConfig.childIssue.fields, prefix));
    });
    if (!childValid) return;
  }

  const submitBtn = document.getElementById('submitBtn');
  document.getElementById('submitBtnText').style.display = 'none';
  document.getElementById('submitBtnLoader').style.display = 'inline-block';
  submitBtn.disabled = true;

  try {
    await window.api.post('/api/requests', { project: formConfig.id, fields, childIssues });
    document.getElementById('formContainer').style.display = 'none';
    document.getElementById('successState').style.display = 'block';
  } catch (err) {
    alert(err.message || 'Failed to submit request.');
    document.getElementById('submitBtnText').style.display = 'inline';
    document.getElementById('submitBtnLoader').style.display = 'none';
    submitBtn.disabled = false;
  }
});

window.submitAnother = function () {
  window.location.reload();
};

init();
