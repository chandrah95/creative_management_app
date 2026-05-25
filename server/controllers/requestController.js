const {
  getAllRequests, getRequestById, createRequest, updateRequest,
  addComment, addChildComment, updateChildIssue, getAllUsers, findUserById, autoApproveStaleTickets
} = require('../storage/supabaseAdapter');

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
  const allowed = {
    on_review: ['need_revision', 'approved'],
    revised:   ['need_revision', 'approved']
  };
  return (allowed[from] || []).includes(to);
}

async function buildFilters(user, query) {
  const { project, status, includeApproved } = query;
  const filters = {};
  if (project)                    filters.project  = project;
  if (status)                     filters.status   = status;
  if (includeApproved === 'true') filters.includeApproved = true;

  if (user.role === 'creative_designer') {
    filters.assignedTo = user.id;
  } else if (user.role === 'creative_lead') {
    const dbUser = await findUserById(user.id);
    filters.projects = dbUser?.projects || user.projects || [];

    if (filters.projects.includes('studio')) {
      const members = await getAllUsers({ role: 'creative_designer', leadId: user.id });
      filters.studioMemberIds = members
        .filter(m => (m.projects || []).includes('studio'))
        .map(m => m.id);
    }
  } else if (user.role === 'requester') {
    const dbUser = await findUserById(user.id);
    const rp     = dbUser?.projects?.length ? dbUser.projects : (user.projects || []);

    if (query.queue === 'true') {
      if (rp.length) {
        filters.projects = rp;
      } else {
        filters.emptyResult = true;
      }
    } else {
      filters.submittedBy     = user.id;
      filters.includeApproved = true;
      if (rp.length) filters.requesterProjects = rp;
    }
  }
  return filters;
}

async function checkAccess(user, request) {
  if (user.role === 'admin') return true;
  if (user.role === 'creative_designer')
    return request.assignedTo?.id === user.id ||
      (request.childIssues || []).some(c => c.assignedTo?.id === user.id);
  if (user.role === 'requester') {
    if (request.submittedBy?.id === user.id) return true;
    const dbUser = await findUserById(user.id);
    const rp = dbUser?.projects?.length ? dbUser.projects : (user.projects || []);
    return rp.length > 0 && rp.includes(request.project);
  }
  if (user.role === 'creative_lead') {
    const dbUser       = await findUserById(user.id);
    const leadProjects = dbUser?.projects?.length ? dbUser.projects : (user.projects || []);
    const regular      = leadProjects.filter(p => p !== 'studio' && p !== 'copywriting');
    if (regular.includes(request.project)) return true;

    if (leadProjects.includes('studio')) {
      const members = await getAllUsers({ role: 'creative_designer', leadId: user.id });
      const studioIds = members
        .filter(m => (m.projects || []).includes('studio'))
        .map(m => m.id);
      if (studioIds.length &&
          (request.childIssues || []).some(c => c.is_need_studio && studioIds.includes(c.assignedTo?.id))) {
        return true;
      }
    }
    return false;
  }
  return false;
}

function actorOf(user) {
  return { id: user.id, name: user.name, role: user.role };
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function list(req, res) {
  await autoApproveStaleTickets();
  const filters  = await buildFilters(req.user, req.query);
  const requests = await getAllRequests(filters);
  res.json({ success: true, data: requests, total: requests.length });
}

async function get(req, res) {
  const request = await getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  if (!(await checkAccess(req.user, request))) return res.status(403).json({ success: false, error: 'Access denied' });
  res.json({ success: true, data: request });
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

async function create(req, res) {
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
  const newRequest = await createRequest({
    project, fields, childIssues: childIssues || [],
    submittedBy: { id: req.user.id, email: req.user.email, name: req.user.name }
  });
  res.status(201).json({ success: true, data: newRequest });

  if (aiService) {
    aiService.enhanceBrief(newRequest).then(note => {
      if (note) updateRequest(newRequest.id, { ai_brief_note: note });
    }).catch(() => {});
  }
}

async function update(req, res) {
  const user    = req.user;
  const request = await getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  if (!(await checkAccess(user, request))) return res.status(403).json({ success: false, error: 'Access denied' });
  if (user.role === 'requester') return res.status(403).json({ success: false, error: 'Requesters cannot update tickets' });

  const { status, assignedTo } = req.body;
  const updates = {};

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
  const updated   = await updateRequest(req.params.id, { ...rest, ...updates }, changedBy);
  res.json({ success: true, data: updated });

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

async function postComment(req, res) {
  const user    = req.user;
  const request = await getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  if (!(await checkAccess(user, request))) return res.status(403).json({ success: false, error: 'Access denied' });

  const { text, imageData } = req.body;
  if (!text?.trim() && !imageData) return res.status(400).json({ success: false, error: 'Comment text or image is required' });
  if (imageData && Buffer.byteLength(imageData, 'utf8') > MAX_IMAGE_BYTES) {
    return res.status(413).json({ success: false, error: 'Image too large. Maximum size is 2 MB.' });
  }

  const updated = await addComment(req.params.id, {
    text:      text?.trim() || '',
    imageData: imageData    || null,
    postedBy:  { id: user.id, name: user.name, email: user.email, role: user.role }
  });
  res.json({ success: true, data: updated });
}

async function postChildComment(req, res) {
  const user    = req.user;
  const request = await getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  if (!(await checkAccess(user, request))) return res.status(403).json({ success: false, error: 'Access denied' });

  const { text, imageData } = req.body;
  if (!text?.trim() && !imageData) return res.status(400).json({ success: false, error: 'Comment text or image is required' });
  if (imageData && Buffer.byteLength(imageData, 'utf8') > MAX_IMAGE_BYTES) {
    return res.status(413).json({ success: false, error: 'Image too large. Maximum size is 2 MB.' });
  }

  const updated = await addChildComment(req.params.id, req.params.childId, {
    text:      text?.trim() || '',
    imageData: imageData    || null,
    postedBy:  { id: user.id, name: user.name, email: user.email, role: user.role }
  });
  if (!updated) return res.status(404).json({ success: false, error: 'Child issue not found' });
  res.json({ success: true, data: updated });
}

async function updateChild(req, res) {
  const user    = req.user;
  const request = await getRequestById(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
  if (!(await checkAccess(user, request))) return res.status(403).json({ success: false, error: 'Access denied' });
  if (user.role === 'requester') return res.status(403).json({ success: false, error: 'Access denied' });

  if (req.body.assignedTo !== undefined && user.role !== 'creative_lead' && user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Only creative leads can assign sub-tasks' });
  }

  const ALLOWED = ['status', 'assignedTo', 'storyPoints', 'draft_url', 'final_url',
                   'child_title', 'child_due', 'child_notes', 'is_need_studio', 'is_need_copywriting',
                   'task_type', 'asset_type', 'asset_type_l2', 'objective_type', 'packaging_type', 'brand',
                   'platform', 'posting_type', 'posting_date',
                   'dlp_id', 'banner_name', 'category_id', 'catalogue_id', 'reference_id',
                   'campaign_code'];
  const updates = {};
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const changedBy = updates.status ? actorOf(user) : null;
  const updated   = await updateChildIssue(req.params.id, req.params.childId, updates, changedBy);
  if (!updated) return res.status(404).json({ success: false, error: 'Child issue not found' });
  res.json({ success: true, data: updated });
}

async function getTeamMembers(req, res) {
  const user = req.user;
  if (user.role !== 'creative_lead' && user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  if (user.role === 'admin') {
    const all = await getAllUsers({ role: 'creative_designer' });
    return res.json({ success: true, data: all });
  }

  const ownTeam    = await getAllUsers({ role: 'creative_designer', leadId: user.id });
  const allDesigners = await getAllUsers({ role: 'creative_designer' });
  const studioPool = allDesigners
    .filter(m => m.leadId !== user.id && (m.projects || []).includes('studio'))
    .map(m => ({ ...m, isStudioPool: true }));

  const seen     = new Set(ownTeam.map(m => m.id));
  const combined = [...ownTeam, ...studioPool.filter(m => !seen.has(m.id))];
  res.json({ success: true, data: combined });
}

module.exports = { list, get, create, update, postComment, postChildComment, updateChild, getTeamMembers };
