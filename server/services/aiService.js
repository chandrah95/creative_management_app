// ── AI Service ─────────────────────────────────────────────────────────────
// Supports OpenAI, Anthropic, and Google Gemini.
// All functions return null on failure — never throws, never blocks request flow.
// To disable AI entirely, delete this file; all hooks fail silently.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const SETTINGS_FILE = path.join(__dirname, '../data/ai_settings.json');

function getSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return null; }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function httpsPost(hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } },
      res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function callAI(prompt) {
  const s = getSettings();
  if (!s?.provider || !s?.apiKey) return null;

  try {
    if (s.provider === 'anthropic') {
      const model = s.model || 'claude-haiku-4-5-20251001';
      const r = await httpsPost('api.anthropic.com', '/v1/messages',
        { 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: 512, messages: [{ role: 'user', content: prompt }] }
      );
      return r.body?.content?.[0]?.text || null;
    }

    if (s.provider === 'openai') {
      const model = s.model || 'gpt-4o-mini';
      const r = await httpsPost('api.openai.com', '/v1/chat/completions',
        { 'Authorization': `Bearer ${s.apiKey}` },
        { model, max_tokens: 512, messages: [{ role: 'user', content: prompt }] }
      );
      return r.body?.choices?.[0]?.message?.content || null;
    }

    if (s.provider === 'gemini') {
      const model = s.model || 'gemini-1.5-flash';
      const r = await httpsPost('generativelanguage.googleapis.com',
        `/v1beta/models/${model}:generateContent?key=${s.apiKey}`,
        {},
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 512 } }
      );
      return r.body?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
  } catch (e) {
    console.error('[AI]', e.message);
  }
  return null;
}

async function enhanceBrief(ticket) {
  const title = ticket.fields?.title || '';
  const desc  = ticket.fields?.description || ticket.fields?.brief || Object.values(ticket.fields || {}).filter(v => typeof v === 'string' && v.length > 10).join(' | ') || '';
  if (!title && !desc) return null;

  return callAI(
    `You are a creative project manager reviewing a new brief. Write 2-3 concise bullet points covering: clarity of scope, suggested priority (low/medium/high/critical), and any missing info to clarify. Be direct.

Title: ${title}
Details: ${desc.substring(0, 400)}

Bullet points only, plain text, no headers.`
  );
}

async function draftRevisionNote(ticket) {
  const title    = ticket.fields?.title || '(untitled)';
  const comments = (ticket.comments || []).slice(-3).map(c => c.text).filter(Boolean).join(' | ');

  return callAI(
    `You are a creative lead sending a ticket back for revision. Write a concise revision note (2-3 sentences) that is constructive and specific. Based on:

Ticket: ${title}
Recent comments: ${comments || 'none'}

Write only the revision note, nothing else.`
  );
}

async function generateWorkloadSummary(designers, tickets) {
  if (!designers.length) return null;

  const lines = designers.map(d => {
    const mine   = tickets.filter(t =>
      t.assignedTo?.id === d.id ||
      (t.childIssues || []).some(c => c.assignedTo?.id === d.id)
    );
    const byStatus = {};
    mine.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
    const sp = mine.reduce((s, t) => s + (t.storyPoints || 0), 0);
    return `${d.name}: ${mine.length} tickets, ${sp} SP — ${JSON.stringify(byStatus)}`;
  }).join('\n');

  return callAI(
    `You are a creative team manager. Summarize the team workload below in 4-6 bullet points. Highlight the most loaded designer, any bottlenecks (many tickets stuck in on_review or need_revision), and give one short recommendation.

${lines}

Bullet points only, plain text.`
  );
}

module.exports = { getSettings, saveSettings, callAI, enhanceBrief, draftRevisionNote, generateWorkloadSummary };
