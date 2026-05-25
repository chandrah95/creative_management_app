import '/js/api.js';
import { buildFields, collectValues, validateFields } from './FormBuilder.js';

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

function getRequesterAllowedProjects(list) {
  const raw  = localStorage.getItem('crp_user') || sessionStorage.getItem('crp_user');
  const user = raw ? JSON.parse(raw) : {};
  const scope = user.projects?.length ? user.projects : null;
  return list.filter(p => !p.isStudio && !p.isCopywriting && (!scope || scope.includes(p.id)));
}

function renderProjectNav(list) {
  const nav = document.getElementById('projectNav');
  const current = new URLSearchParams(window.location.search).get('project');
  nav.innerHTML = getRequesterAllowedProjects(list).map(p => `
      <a class="project-nav-item ${p.id === current ? 'active' : ''}" href="/form?project=${p.id}">
        <span class="project-nav-dot" style="background:${p.color}"></span>
        <span class="project-nav-label">${p.name}</span>
      </a>
    `).join('');
}

function renderProjectPicker(list) {
  const grid = document.getElementById('projectPickerGrid');
  if (!grid) return;
  grid.innerHTML = getRequesterAllowedProjects(list).map(p => `
      <div class="project-card" onclick="window.location.href='/form?project=${p.id}'">
        <div class="project-card-icon">${p.icon}</div>
        <div class="project-card-name">${p.name}</div>
        <div class="project-card-key" style="color:${p.color}">${p.code || p.jiraProject || ''}</div>
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

// ===== Multi-Text Input (dimensions etc.) =====
window.multitextAdd = function (id) {
  const textInput  = document.getElementById(id + '-input');
  const hiddenInput = document.getElementById(id);
  const tagsWrap   = document.getElementById(id + '-tags');
  if (!textInput || !hiddenInput || !tagsWrap) return;

  const val = textInput.value.trim();
  if (!val) return;

  const items = JSON.parse(hiddenInput.value || '[]');
  items.push(val);
  hiddenInput.value = JSON.stringify(items);
  textInput.value   = '';
  renderMultitextTags(id, items);
  textInput.focus();
};

window.multitextRemove = function (id, idx) {
  const hiddenInput = document.getElementById(id);
  const tagsWrap   = document.getElementById(id + '-tags');
  if (!hiddenInput || !tagsWrap) return;

  const items = JSON.parse(hiddenInput.value || '[]');
  items.splice(idx, 1);
  hiddenInput.value = JSON.stringify(items);
  renderMultitextTags(id, items);
};

function renderMultitextTags(id, items) {
  const tagsWrap = document.getElementById(id + '-tags');
  if (!tagsWrap) return;
  tagsWrap.innerHTML = items.map((item, i) => `
    <span class="multitext-tag">
      ${escHtml(item)}
      <button type="button" class="multitext-tag-remove" onclick="window.multitextRemove('${id}',${i})" title="Remove">×</button>
    </span>`).join('');
}

// ===== Cascading Dropdown =====
window.cascadingDDChange = function (parentSelect) {
  const targetId = parentSelect.dataset.target;
  const groups   = JSON.parse(parentSelect.dataset.groups.replace(/&#39;/g, "'"));
  const child    = document.getElementById(targetId);
  if (!child) return;
  const selected = groups.find(g => g.value === parentSelect.value);
  child.innerHTML = '<option value="">Select type</option>';
  if (selected) {
    child.disabled = false;
    selected.options.forEach(opt => {
      const o = document.createElement('option');
      o.value   = opt.value;
      o.textContent = opt.label;
      child.appendChild(o);
    });
  } else {
    child.disabled = true;
    child.value = '';
  }
  // Reset conditional fields whenever category changes
  if (window.assetSubTypeChanged) window.assetSubTypeChanged(child);
};

// ===== Asset Sub-type → Conditional Fields (EBXC / PLXC) =====
window.assetSubTypeChanged = function (subSelect) {
  const subId    = subSelect.id;                          // e.g. "child_1_asset_type"
  const prefix   = subId.replace('asset_type', '');       // e.g. "child_1_"
  const catSelect = document.getElementById(subId + '_cat');
  const category  = catSelect ? catSelect.value : '';
  window.assetTypeChanged(prefix, category, subSelect.value);
};

window.assetTypeChanged = function (prefix, category, subtype) {
  function setField(name, show, required) {
    const wrap  = document.querySelector(`[data-field="${prefix}${name}"]`);
    const input = document.getElementById(`${prefix}${name}`);
    if (!wrap) return;
    if (show) {
      wrap.style.display = '';
      if (input) required ? input.setAttribute('required', '') : input.removeAttribute('required');
    } else {
      wrap.style.display = 'none';
      if (input) { input.removeAttribute('required'); input.value = ''; }
    }
  }

  setField('dlp_id',      subtype === 'dlp',                                         true);
  setField('banner_name', category === 'banner' && subtype !== 'dlp' && subtype !== '', true);
  setField('category_id', subtype === 'tile_category',                               true);
  setField('catalogue_id',subtype === 'tile_catalogue',                              true);
  setField('reference_id',subtype === 'big_catalogue' || category === 'other',       false);
};

// ===== Task Type → Studio Lock + Asset Type Lock =====
window.taskTypeChanged = function (select) {
  const prefix        = select.id.replace('task_type', '');
  const isCopywriting = select.value === 'copywriting';

  // Lock / unlock studio toggle
  const studioEl   = document.getElementById(prefix + 'is_need_studio');
  const studioWrap = studioEl?.closest('.studio-toggle-wrap');
  if (studioEl) {
    if (isCopywriting) {
      studioEl.checked  = false;
      studioEl.disabled = true;
      studioWrap?.classList.add('toggle-disabled');
    } else {
      studioEl.disabled = false;
      studioWrap?.classList.remove('toggle-disabled');
    }
  }

  // Hide/show asset_type wrapper — hiding it makes validateFields skip it entirely
  const assetWrapper = document.querySelector(`[data-field="${prefix}asset_type"]`);
  if (assetWrapper) {
    assetWrapper.style.display = isCopywriting ? 'none' : '';
  }

  // Also disable/clear the actual inputs (cascading or plain dropdown)
  const assetCat = document.getElementById(prefix + 'asset_type_cat');
  const assetSub = document.getElementById(prefix + 'asset_type');
  if (isCopywriting) {
    if (assetCat) { assetCat.value = ''; assetCat.disabled = true; }
    if (assetSub) { assetSub.innerHTML = '<option value="">Select type</option>'; assetSub.disabled = true; assetSub.value = ''; }
  } else {
    if (assetCat) assetCat.disabled = false;
    // assetSub (cascading) stays disabled until user picks a category; plain dropdown re-enables with wrapper
    if (assetSub && !assetCat) assetSub.disabled = false;
  }
};

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
    <p class="scope-exclusive-warning" id="scope-warning-${idx}" style="display:none">
      ⚠ Studio and Copywriting cannot both be selected for the same sub-task. Please choose one only.
    </p>
  `;
  list.appendChild(card);
  buildFields(formConfig.childIssue.fields, document.getElementById(`child-fields-${idx}`), prefix);
};

window.studioCWExclusive = function (changedInput) {
  const card = changedInput.closest('.child-issue-card');
  if (!card) return;
  const isStudio = changedInput.id.endsWith('is_need_studio');
  const isCW     = changedInput.id.endsWith('is_need_copywriting');
  if (!isStudio && !isCW) return;

  const prefix    = changedInput.id.replace(/is_need_(studio|copywriting)$/, '');
  const studioEl  = document.getElementById(prefix + 'is_need_studio');
  const cwEl      = document.getElementById(prefix + 'is_need_copywriting');
  const studioWrap = studioEl?.closest('.studio-toggle-wrap');
  const cwWrap     = cwEl?.closest('.studio-toggle-wrap');
  const cardIdx   = card.id.replace('child-card-', '');
  const warning   = document.getElementById('scope-warning-' + cardIdx);

  if (changedInput.checked) {
    if (isStudio && cwEl) {
      cwEl.checked  = false;
      cwEl.disabled = true;
      cwWrap?.classList.add('toggle-disabled');
    }
    if (isCW && studioEl) {
      studioEl.checked  = false;
      studioEl.disabled = true;
      studioWrap?.classList.add('toggle-disabled');
    }
    if (warning) warning.style.display = 'block';
  } else {
    if (studioEl) { studioEl.disabled = false; studioWrap?.classList.remove('toggle-disabled'); }
    if (cwEl)     { cwEl.disabled = false;     cwWrap?.classList.remove('toggle-disabled'); }
    if (warning)  warning.style.display = 'none';
  }
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
      else {
        const childData = collectValues(formConfig.childIssue.fields, prefix);
        // Cascading dropdown: getValue returns the L2 sub-type (e.g. "homepage"),
        // but the DB needs asset_type = L1 category ("banner") and asset_type_l2 = L2 sub-type.
        const catEl = document.getElementById(`${prefix}asset_type_cat`);
        if (catEl && catEl.value) {
          childData.asset_type_l2 = childData.asset_type; // move L2 to correct key
          childData.asset_type    = catEl.value;           // L1 category (banner/tile/other)
        }
        childIssues.push(childData);
      }
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
