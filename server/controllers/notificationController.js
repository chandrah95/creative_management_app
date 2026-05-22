const { getAllRequests } = require('../storage/localAdapter');

const STUCK_STATUSES  = new Set(['on_review', 'revised']);
const STUCK_MS        = 4 * 24 * 60 * 60 * 1000; // 4 days

function getStuck(req, res) {
  const { role, id } = req.user;

  // Only relevant for designer and requester — others get an empty list
  if (role !== 'creative_designer' && role !== 'requester') {
    return res.json({ success: true, data: [] });
  }

  const now    = Date.now();
  const all    = getAllRequests({ includeApproved: false });
  const result = [];

  for (const r of all) {
    if (!STUCK_STATUSES.has(r.status)) continue;

    // Ownership filter
    if (role === 'creative_designer') {
      const mine = r.assignedTo?.id === id ||
        (r.childIssues || []).some(c => c.assignedTo?.id === id);
      if (!mine) continue;
    } else {
      if (r.submittedBy?.id !== id) continue;
    }

    // Find when the ticket last entered its current status
    const hist  = r.statusHistory || [];
    const entry = [...hist].reverse().find(h => h.to === r.status);
    if (!entry?.changedAt) continue;

    const elapsed = now - new Date(entry.changedAt).getTime();
    if (elapsed < STUCK_MS) continue;

    result.push({
      id:       r.id,
      ticketId: r.ticketId,
      title:    r.fields?.title || '(no title)',
      status:   r.status,
      project:  r.project,
      daysStuck: Math.floor(elapsed / (1000 * 60 * 60 * 24))
    });
  }

  result.sort((a, b) => b.daysStuck - a.daysStuck);
  res.json({ success: true, data: result });
}

module.exports = { getStuck };
