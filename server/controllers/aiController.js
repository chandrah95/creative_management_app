const ai = require('../services/aiService');
const { getAllRequests, getAllUsers } = require('../storage/localAdapter');

function getSettings(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
  const s = ai.getSettings();
  if (!s) return res.json({ success: true, data: {} });
  const masked = { ...s };
  if (masked.apiKey) masked.apiKey = masked.apiKey.slice(0, 4) + '••••••••' + masked.apiKey.slice(-4);
  res.json({ success: true, data: masked });
}

function saveSettings(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
  const { provider, apiKey, model } = req.body;
  if (!provider || !apiKey) return res.status(400).json({ success: false, error: 'provider and apiKey are required' });
  const existing = ai.getSettings();
  const finalKey = apiKey.includes('••••') ? (existing?.apiKey || apiKey) : apiKey;
  ai.saveSettings({ provider, apiKey: finalKey, model: model || '' });
  res.json({ success: true });
}

async function testConnection(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
  const result = await ai.callAI('Reply with exactly the word: CONNECTED');
  if (result) {
    res.json({ success: true, message: `Connected. Response: "${result.trim().substring(0, 120)}"` });
  } else {
    res.status(400).json({ success: false, error: 'Connection failed. Check provider, model, and API key.' });
  }
}

async function workloadSummary(req, res) {
  if (req.user.role !== 'admin' && req.user.role !== 'creative_lead') {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  const tickets   = getAllRequests({ includeApproved: false });
  const designers = getAllUsers({ role: 'creative_designer' });
  const summary   = await ai.generateWorkloadSummary(designers, tickets);
  if (!summary) return res.status(503).json({ success: false, error: 'AI not configured or unavailable. Set up provider on the AI Settings page.' });
  res.json({ success: true, data: summary });
}

module.exports = { getSettings, saveSettings, testConnection, workloadSummary };
