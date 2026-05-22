import '/js/api.js';

const ROLE_LABELS = {
  admin: 'Administrator', creative_lead: 'Creative Lead',
  creative_designer: 'Creative Designer', requester: 'Requester'
};

const MODEL_OPTIONS = {
  anthropic: [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fastest / Cheapest)' },
    { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 (Balanced)' },
    { value: 'claude-opus-4-7',           label: 'Claude Opus 4.7 (Most capable)' }
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fastest / Cheapest)' },
    { value: 'gpt-4o',      label: 'GPT-4o (Balanced)' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Legacy)' }
  ],
  gemini: [
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Fastest / Cheapest)' },
    { value: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro (Balanced)' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Latest)' }
  ]
};

let currentUser = null;
let savedModel  = '';

async function init() {
  const raw = localStorage.getItem('crp_user') || sessionStorage.getItem('crp_user');
  if (!raw) { window.location.href = '/'; return; }
  currentUser = JSON.parse(raw);

  if (currentUser.role !== 'admin') {
    window.location.href = '/dashboard';
    return;
  }

  document.getElementById('userName').textContent   = currentUser.name;
  document.getElementById('userAvatar').textContent = currentUser.name[0].toUpperCase();
  document.getElementById('userRole').textContent   = ROLE_LABELS[currentUser.role] || currentUser.role;
  const chip = document.getElementById('roleChip');
  chip.textContent = ROLE_LABELS[currentUser.role] || currentUser.role;
  chip.className   = `role-chip role-${currentUser.role}`;

  buildSidebar();
  await loadSettings();
}

function buildSidebar() {
  document.getElementById('sidebarNav').innerHTML = `
    <a class="project-nav-item" href="/dashboard">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      <span class="project-nav-label">My Dashboard</span>
    </a>
    <a class="project-nav-item" href="/form">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      <span class="project-nav-label">New Request</span>
    </a>
    <a class="project-nav-item active" href="/ai-settings">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>
      <span class="project-nav-label">AI Settings</span>
    </a>`;
}

async function loadSettings() {
  try {
    const { data } = await window.api.get('/api/ai/settings');
    if (data.provider) {
      document.getElementById('providerSelect').value = data.provider;
      updateModelOptions(data.provider);
      savedModel = data.model || '';
      if (savedModel) document.getElementById('modelSelect').value = savedModel;
      if (data.apiKey) document.getElementById('apiKeyInput').placeholder = data.apiKey;
    }
  } catch {}
}

window.onProviderChange = function () {
  const provider = document.getElementById('providerSelect').value;
  updateModelOptions(provider);
};

function updateModelOptions(provider) {
  const sel  = document.getElementById('modelSelect');
  const opts = MODEL_OPTIONS[provider] || [];
  sel.innerHTML = opts.length
    ? opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('')
    : '<option value="">— Select provider first —</option>';
  if (savedModel && opts.find(o => o.value === savedModel)) sel.value = savedModel;
}

window.saveSettings = async function () {
  const provider = document.getElementById('providerSelect').value;
  const model    = document.getElementById('modelSelect').value;
  const apiKey   = document.getElementById('apiKeyInput').value.trim();

  if (!provider) return showStatus('Select a provider.', 'error');
  if (!model)    return showStatus('Select a model.', 'error');
  if (!apiKey && !document.getElementById('apiKeyInput').placeholder.includes('••••')) {
    return showStatus('Enter your API key.', 'error');
  }

  const keyToSend = apiKey || document.getElementById('apiKeyInput').placeholder;
  try {
    await window.api.post('/api/ai/settings', { provider, model, apiKey: keyToSend });
    savedModel = model;
    showStatus('Settings saved.', 'success');
    document.getElementById('apiKeyInput').value = '';
    await loadSettings();
  } catch (err) {
    showStatus(err.message, 'error');
  }
};

window.testConnection = async function () {
  showStatus('Testing connection…', 'info');
  try {
    const { message } = await window.api.post('/api/ai/test', {});
    showStatus(message, 'success');
  } catch (err) {
    showStatus(err.message, 'error');
  }
};

window.generateSummary = async function () {
  const btn = document.getElementById('summaryBtn');
  const out = document.getElementById('summaryOutput');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  out.style.display = 'none';
  try {
    const { data } = await window.api.get('/api/ai/workload-summary');
    const text  = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const lines = text.split('\n').filter(l => l.trim());
    out.innerHTML = lines.map(l => `<div class="ai-summary-line">${escHtml(l)}</div>`).join('');
    out.style.display = 'block';
  } catch (err) {
    out.innerHTML = `<div style="color:#dc2626">${escHtml(err.message)}</div>`;
    out.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Summary';
  }
};

function showStatus(msg, type) {
  const el = document.getElementById('configStatus');
  el.textContent = msg;
  el.className   = `ai-status ai-status-${type}`;
  el.style.display = 'block';
  if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
