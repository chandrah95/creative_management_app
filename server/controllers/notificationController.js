const { getAllRequests, findUserById } = require('../storage/localAdapter');

const REVIEW_STATUSES = new Set(['on_review', 'revised']);

function getStuck(req, res) {
  const { role, id } = req.user;

  // Only relevant for creative leads (need to act) and requesters (their tickets awaiting approval)
  if (role !== 'creative_lead' && role !== 'requester') {
    return res.json({ success: true, data: [] });
  }

  const now    = Date.now();
  const all    = getAllRequests({ includeApproved: false });
  const result = [];

  for (const r of all) {
    if (!REVIEW_STATUSES.has(r.status)) continue;

    // Role-based scope filter
    if (role === 'creative_lead') {
      const dbUser   = findUserById(id);
      const projects = (dbUser?.projects || []).filter(p => p !== 'studio' && p !== 'copywriting');
      if (!projects.includes(r.project)) continue;
    } else {
      // requester: only their own submitted tickets
      if (r.submittedBy?.id !== id) continue;
    }

    // How long has it been waiting in this status (informational, no threshold)
    const hist  = r.statusHistory || [];
    const entry = [...hist].reverse().find(h => h.to === r.status);
    const elapsed     = entry?.changedAt ? now - new Date(entry.changedAt).getTime() : 0;
    const daysWaiting = Math.floor(elapsed / (1000 * 60 * 60 * 24));

    result.push({
      id:          r.id,
      ticketId:    r.ticketId,
      title:       r.fields?.title || '(no title)',
      status:      r.status,
      project:     r.project,
      daysWaiting
    });
  }

  result.sort((a, b) => b.daysWaiting - a.daysWaiting);
  res.json({ success: true, data: result });
}

module.exports = { getStuck };
