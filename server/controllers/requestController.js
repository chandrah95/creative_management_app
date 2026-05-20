const { getAllRequests, getRequestById, createRequest, updateRequest } = require('../storage/localAdapter');

function list(req, res) {
  const { project, status } = req.query;
  const requests = getAllRequests({ project, status });
  res.json({ success: true, data: requests, total: requests.length });
}

function get(req, res) {
  const request = getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  res.json({ success: true, data: request });
}

function create(req, res) {
  const { project, fields, childIssues } = req.body;
  if (!project || !fields) {
    return res.status(400).json({ success: false, error: 'Project and fields are required' });
  }
  const newRequest = createRequest({
    project,
    fields,
    childIssues: childIssues || [],
    submittedBy: { id: req.user.id, email: req.user.email, name: req.user.name }
  });
  res.status(201).json({ success: true, data: newRequest });
}

function update(req, res) {
  const updated = updateRequest(req.params.id, req.body);
  if (!updated) return res.status(404).json({ success: false, error: 'Request not found' });
  res.json({ success: true, data: updated });
}

module.exports = { list, get, create, update };
