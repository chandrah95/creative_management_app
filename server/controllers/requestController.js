const {
  getAllRequests, getRequestById, createRequest, updateRequest,
  addComment, addChildComment, updateChildIssue, getAllUsers, findUserById, autoApproveStaleTickets
} = require('../storage/localAdapter');

// AI hooks — load once; null if service file is missing (easy removal)
let aiService = null;
try { aiService = require('../services/aiService'); } catch {}

const VALID_STATUSES = ['requested', 'in_progress', 'on_review', 'need_revision', 'revision', 'revised', 'approved'];

const DESIGNER_TRANSITIONS = {
  requested:     ['in_progress'],
  in_progress:   ['on_review'],
  need_revision: ['revision'],
  revision:      ['revised']
};

function canDesignerTransition(from, to) {
  return (DESIGNER_TRANSITIONS[from] || []).includes(to);
}

function canLeadTransition(from, to) {
  // Lead can ONLY act after designer submits for review or revises
  const allowed = {
    on_review: ['need_revision', 'approved'],
    revised:   ['need_revision', 'approved']
  };
  return (allowed[from] || []).includes(to);
}

function buildFilters(user, query) {
  const { project, status, includeApproved } = query;
  const filters = {};
  if (project)                    filters.project  = project;
  if (status)                     filters.status   = status;
  if (includeApproved === 'true') filters.includeApproved = true;

  if (user.role === 'creative_designer') {
    filters.assignedTo = user.id;
  } else if (user.role === 'creative_lead') {
    // Always read projects fresh from DB so stale tokens never bypass the filter
    const dbUser = findUserById(user.id);
    filters.projects = dbUser?.projects || user.projects || [];
  } else if (user.role === 'requester') {
    const dbUser = findUserById(user.id);
    const rp     = dbUser?.projects?.length ? dbUser.projects : (user.projects || []);

    if (query.queue === 'true') {
      // Project queue mode: all active tickets visible to this requester's projects
      if (rp.length) {
        filters.projects = rp; // reuse the lead plural-projects filter mechanism
      } else {
        filters.emptyResult = true; // no project scope = empty queue
      }
      // approved tickets are not part of the active queue
    } else {
      // My requests mode: only tickets this requester submitted
      filters.submittedBy     = user.id;
      filters.includeApproved = true;
      if (rp.length) filters.requesterProjects = rp;
    }
  }
  return filters;
}

function checkAccess(user, request) {
  if (user.role === 'admin') return true;
  if (user.role === 'creative_designer')
    return request.assignedTo?.id === user.id ||
      (request.childIssues || []).some(c => c.assignedTo?.id === user.id);
  if (user.role === 'requester') {
    if (request.submittedBy?.id === user.id) return true;
    // Also allow viewing any ticket in their project scope (for the Project Queue tab)
    const dbUser = findUserById(user.id);
    const rp = dbUser?.projects?.length ? dbUser.projects : (user.projects || []);
    return rp.length > 0 && rp.includes(request.project);
  }
  if (user.role === 'creative_lead') {
    const dbUser   = findUserById(user.id);
    const projects = (dbUser?.projects?.length ? dbUser.projects : (user.projects || []))
      .filter(p => p !== 'studio'); // 'studio' is a view filter, not a real project ID
    return projects.length > 0 && projects.includes(request.project);
  }
  return false;
}

function actorOf(user) {
  return { id: user.id, name: user.name, role: user.role };
}

// ── Handlers ─────────────────────────────────────────────────────────────────

function list(req, res) {
  autoApproveStaleTickets(); // silently promote stale on_review/revised tickets
  const requests = getAllRequests(buildFilters(req.user, req.query));
  res.json({ success: true, data: requests, total: requests.length });
}

function get(req, res) {
  const request = getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  if (!checkAccess(req.user, request)) return res.status(403).json({ success: false, error: 'Access denied' });
  res.json({ success: true, data: request });
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB base64 limit

function create(req, res) {
  const { project, fields, childIssues } = req.body;
  if (!project || !fields) return res.status(400).json({ success: false, error: 'Project and fields are required' });
  if (typeof project !== 'string' || project.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Invalid project' });
  }
  if (typeof fields !== 'object' || Array.isArray(fields)) {
    return res.status(400).json({ success: false, error: 'Fields must be an object' });
  }
  if (!fields.title?.trim()) {
    return res.status(400).json({ success: false, error: 'Title is required' });
  }
  if (req.user.role === 'creative_designer' || req.user.role === 'creative_lead') {
    return res.status(403).json({ success: false, error: 'Only requesters can create tickets' });
  }
  const newRequest = createRequest({
    project, fields, childIssues: childIssues || [],
    submittedBy: { id: req.user.id, email: req.user.email, name: req.user.name }
  });
  res.status(201).json({ success: true, data: newRequest });

  // AI: brief enhancement — non-blocking, fires after response is sent
  if (aiService) {
    aiService.enhanceBrief(newRequest).then(note => {
      if (note) updateRequest(newRequest.id, { ai_brief_note: note });
    }).catch(() => {});
  }
}

function update(req, res) {
  const user    = req.user;
  const request = getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  if (!checkAccess(user, request)) return res.status(403).json({ success: false, error: 'Access denied' });
  if (user.role === 'requester') return res.status(403).json({ success: false, error: 'Requesters cannot update tickets' });

  const { status, assignedTo } = req.body;
  const updates = {};

  // Whitelist allowed top-level update fields to prevent arbitrary field injection
  const ALLOWED_UPDATE_FIELDS = ['storyPoints', 'assignedTo', 'status', 'ai_brief_note', 'fields'];
  const rest = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (key !== 'status' && key !== 'assignedTo' && req.body[key] !== undefined) {
      rest[key] = req.body[key];
    }
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
    if (user.role === 'creative_designer' && !canDesignerTransition(request.status, status)) {
      return res.status(403).json({ success: false, error: `Cannot move from ${request.status} to ${status}` });
    }
    if (user.role === 'creative_lead' && !canLeadTransition(request.status, status)) {
      return res.status(403).json({ success: false, error: `Cannot move from ${request.status} to ${status}` });
    }
    updates.status = status;
  }

  if (assignedTo !== undefined) {
    if (user.role !== 'creative_lead' && user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only creative leads can assign tickets' });
    }
    updates.assignedTo = assignedTo;
  }

  const changedBy = updates.status ? actorOf(user) : null;
  const updated   = updateRequest(req.params.id, { ...rest, ...updates }, changedBy);
  res.json({ success: true, data: updated });

  // AI: revision note — fires only when status moves TO need_revision
  if (aiService && updates.status === 'need_revision' && request.status !== 'need_revision') {
    aiService.draftRevisionNote(updated).then(note => {
      if (note) addComment(req.params.id, {
        text: `💡 AI Revision Suggestion: ${note}`,
        imageData: null,
        postedBy: { id: 'ai', name: 'AI Assistant', email: '', role: 'ai' }
      });
    }).catch(() => {});
  }
}

function postComment(req, res) {
  const user    = req.user;
  const request = getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  if (!checkAccess(user, request)) return res.status(403).json({ success: false, error: 'Access denied' });

  const { text, imageData } = req.body;
  if (!text?.trim() && !imageData) return res.status(400).json({ success: false, error: 'Comment text or image is required' });
  if (imageData && Buffer.byteLength(imageData, 'utf8') > MAX_IMAGE_BYTES) {
    return res.status(413).json({ success: false, error: 'Image too large. Maximum size is 2 MB.' });
  }

  const updated = addComment(req.params.id, {
    text:      text?.trim() || '',
    imageData: imageData    || null,
    postedBy:  { id: user.id, name: user.name, email: user.email, role: user.role }
  });
  res.json({ success: true, data: updated });
}

function postChildComment(req, res) {
  const user    = req.user;
  const request = getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  if (!checkAccess(user, request)) return res.status(403).json({ success: false, error: 'Access denied' });

  const { text, imageData } = req.body;
  if (!text?.trim() && !imageData) return res.status(400).json({ success: false, error: 'Comment text or image is required' });
  if (imageData && Buffer.byteLength(imageData, 'utf8') > MAX_IMAGE_BYTES) {
    return res.status(413).json({ success: false, error: 'Image too large. Maximum size is 2 MB.' });
  }

  const updated = addChildComment(req.params.id, req.params.childId, {
    text:      text?.trim() || '',
    imageData: imageData    || null,
    postedBy:  { id: user.id, name: user.name, email: user.email, role: user.role }
  });
  if (!updated) return res.status(404).json({ success: false, error: 'Child issue not found' });
  res.json({ success: true, data: updated });
}

function updateChild(req, res) {
  const user    = req.user;
  const request = getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  if (!checkAccess(user, request)) return res.status(403).json({ success: false, error: 'Access denied' });
  if (user.role === 'requester') return res.status(403).json({ success: false, error: 'Access denied' });

  // Only leads and admins can assign sub-tasks
  if (req.body.assignedTo !== undefined && user.role !== 'creative_lead' && user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Only creative leads can assign sub-tasks' });
  }

  // Whitelist allowed fields — prevents arbitrary field injection
  const ALLOWED = ['status', 'assignedTo', 'storyPoints', 'draft_url', 'final_url',
                   'child_title', 'child_due', 'child_notes', 'is_need_studio', 'is_need_copywriting'];
  const updates = {};
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const changedBy = updates.status ? actorOf(user) : null;
  const updated   = updateChildIssue(req.params.id, req.params.childId, updates, changedBy);
  if (!updated) return res.status(404).json({ success: false, error: 'Child issue not found' });
  res.json({ success: true, data: updated });
}

function getTeamMembers(req, res) {
  const user = req.user;
  if (user.role !== 'creative_lead' && user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  const filters = { role: 'creative_designer' };
  if (user.role === 'creative_lead') filters.leadId = user.id;
  const members = getAllUsers(filters);
  res.json({ success: true, data: members });
}

module.exports = { list, get, create, update, postComment, postChildComment, updateChild, getTeamMembers };
