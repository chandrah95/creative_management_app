const { findUserById, getAllLeads, getAllUsers, updateUserLead, updateUser } = require('../storage/supabaseAdapter');

async function listLeads(req, res) {
  const leads = await getAllLeads();
  res.json({ success: true, data: leads });
}

async function transferDesigner(req, res) {
  const user     = req.user;
  const designer = await findUserById(req.params.id);

  if (!designer || designer.role !== 'creative_designer') {
    return res.status(404).json({ success: false, error: 'Designer not found' });
  }
  if (user.role === 'creative_lead' && designer.leadId !== user.id) {
    return res.status(403).json({ success: false, error: 'Can only transfer your own team members' });
  }

  const { leadId } = req.body;
  const targetLead = await findUserById(leadId);
  if (!targetLead || targetLead.role !== 'creative_lead') {
    return res.status(400).json({ success: false, error: 'Invalid target lead' });
  }

  const updated = await updateUserLead(req.params.id, leadId);
  res.json({ success: true, data: updated });
}

async function updateCapacity(req, res) {
  const user     = req.user;
  const designer = await findUserById(req.params.id);

  if (!designer || designer.role !== 'creative_designer') {
    return res.status(404).json({ success: false, error: 'Designer not found' });
  }
  if (user.role === 'creative_lead' && designer.leadId !== user.id) {
    return res.status(403).json({ success: false, error: 'Can only update your own team members' });
  }

  const { maxStoryPoints } = req.body;
  if (typeof maxStoryPoints !== 'number' || maxStoryPoints < 1) {
    return res.status(400).json({ success: false, error: 'maxStoryPoints must be a positive integer' });
  }

  const updated = await updateUser(req.params.id, { maxStoryPoints: Math.floor(maxStoryPoints) });
  res.json({ success: true, data: updated });
}

module.exports = { listLeads, transferDesigner, updateCapacity };
