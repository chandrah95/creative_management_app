const { findUserById, getAllLeads, getAllUsers, updateUserLead } = require('../storage/localAdapter');

function listLeads(req, res) {
  res.json({ success: true, data: getAllLeads() });
}

function transferDesigner(req, res) {
  const user     = req.user;
  const designer = findUserById(req.params.id);

  if (!designer || designer.role !== 'creative_designer') {
    return res.status(404).json({ success: false, error: 'Designer not found' });
  }
  if (user.role === 'creative_lead' && designer.leadId !== user.id) {
    return res.status(403).json({ success: false, error: 'Can only transfer your own team members' });
  }

  const { leadId } = req.body;
  const targetLead = findUserById(leadId);
  if (!targetLead || targetLead.role !== 'creative_lead') {
    return res.status(400).json({ success: false, error: 'Invalid target lead' });
  }

  const updated = updateUserLead(req.params.id, leadId);
  res.json({ success: true, data: updated });
}

module.exports = { listLeads, transferDesigner };
