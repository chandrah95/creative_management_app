'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const supabase = require('./supabaseClient');
const { v4: uuidv4 } = require('uuid');

// ── Story Points (mirrors localAdapter) ─────────────────────────────────────
const TASK_TYPE_SP  = { image: 1, motion: 2, video: 8, copywriting: 2 };
const OCSP_ASSET_SP = {
  flyer: 2, box_carton: 2, merchandise: 2, presentation: 8, poster: 2,
  tripod_banner: 2, spanduk: 1, billboard: 16, physical_voucher: 1,
  sticker: 2, catalogue: 4, mockup: 1, special_project: 2, key_visual: 3, others: 2
};
const PAC_BRAND_SP = { abasics: 5, astro_goods: 9, astro_cafe: 5, astro_bakery: 5, astro_farm: 5 };
const STUDIO_SP    = { ebxc: 32, plxc: 32, pac: 32, ocsp: 32 };

function computeChildSP(project, child, parentFields = {}) {
  const proj     = (project || '').toLowerCase();
  const tt       = (child.task_type   || '').toLowerCase();
  const at       = (child.asset_type  || child.asset_type_l1 || '').toLowerCase();
  const isStudio = !!child.is_need_studio;
  if (isStudio && STUDIO_SP[proj] != null) return STUDIO_SP[proj];
  switch (proj) {
    case 'ebxc': case 'plxc': case 'smxc': case 'daxc':
      return TASK_TYPE_SP[tt] ?? null;
    case 'pac': {
      if (tt === 'copywriting') return TASK_TYPE_SP.copywriting;
      const brand = (parentFields.brand || child.brand || '').toLowerCase();
      return PAC_BRAND_SP[brand] ?? null;
    }
    case 'ocsp':
      if (tt === 'copywriting') return TASK_TYPE_SP.copywriting;
      return OCSP_ASSET_SP[at] ?? null;
    default: return null;
  }
}

// ── Supabase select fragment ─────────────────────────────────────────────────
const TICKET_SELECT = `
  id, ticket_id, project, status, story_points,
  submitted_by_id, submitted_by_snapshot,
  assigned_to_id,  assigned_to_snapshot,
  submitted_at, updated_at,
  title, description, brief_deck_url,
  campaign_code, campaign_start_date, campaign_end_date,
  platform, posting_type, posting_date,
  sku_number, packaging_type, brand, dimensions, live_date,
  subtasks (
    id, subtask_id, status, story_points,
    assigned_to_id, assigned_to_snapshot,
    is_need_studio, is_need_copywriting,
    task_type, asset_type_l1, asset_type_l2,
    dlp_id, banner_name, category_id, catalogue_id, reference_id,
    objective_type, draft_url, final_url, child_notes, child_due,
    subtask_status_history ( id, from_status, to_status, changed_at, changed_by_id, changed_by_name, changed_by_role ),
    subtask_comments       ( id, text, image_data, posted_at, posted_by_snapshot )
  ),
  ticket_status_history ( id, from_status, to_status, changed_at, changed_by_id, changed_by_name, changed_by_role ),
  ticket_comments       ( id, text, image_data, posted_at, posted_by_snapshot )
`.trim();

// ── Row → local-format helpers ───────────────────────────────────────────────

function histRowToLocal(row) {
  const changedBy = row.changed_by_id
    ? { id: row.changed_by_id, name: row.changed_by_name, role: row.changed_by_role }
    : row.changed_by_name
      ? { name: row.changed_by_name, role: row.changed_by_role }
      : null;
  return { from: row.from_status || null, to: row.to_status, changedAt: row.changed_at, changedBy };
}

function commentRowToLocal(row) {
  const c = { id: row.id, text: row.text || '', postedAt: row.posted_at, postedBy: row.posted_by_snapshot || {} };
  if (row.image_data) c.imageData = row.image_data;
  return c;
}

function subtaskRowToLocal(row) {
  const child = {
    id:                  row.id,
    ticketId:            row.subtask_id,
    status:              row.status,
    storyPoints:         row.story_points,
    assignedTo:          row.assigned_to_snapshot || null,
    is_need_studio:      row.is_need_studio,
    is_need_copywriting: row.is_need_copywriting,
    task_type:           row.task_type,
    asset_type:          row.asset_type_l1  || null,
    asset_type_l2:       row.asset_type_l2  || null,
    comments:      (row.subtask_comments       || []).map(commentRowToLocal),
    statusHistory: (row.subtask_status_history || [])
      .sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at))
      .map(histRowToLocal),
  };
  for (const f of ['dlp_id', 'banner_name', 'category_id', 'catalogue_id',
                    'reference_id', 'objective_type', 'draft_url', 'final_url',
                    'child_notes', 'child_due']) {
    if (row[f] != null) child[f] = row[f];
  }
  return child;
}

const FIELD_COLS = [
  'title', 'description', 'brief_deck_url',
  'campaign_code', 'campaign_start_date', 'campaign_end_date',
  'platform', 'posting_type', 'posting_date',
  'sku_number', 'packaging_type', 'brand', 'dimensions', 'live_date',
];

function ticketRowToLocal(row) {
  const fields = {};
  for (const col of FIELD_COLS) {
    if (row[col] != null) fields[col] = row[col];
  }
  return {
    id:            row.id,
    ticketId:      row.ticket_id,
    status:        row.status,
    assignedTo:    row.assigned_to_snapshot || null,
    submittedBy:   row.submitted_by_snapshot || null,
    comments:      (row.ticket_comments       || []).map(commentRowToLocal),
    statusHistory: (row.ticket_status_history || [])
      .sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at))
      .map(histRowToLocal),
    submittedAt:   row.submitted_at,
    updatedAt:     row.updated_at,
    project:       row.project,
    fields,
    storyPoints:   row.story_points,
    childIssues:   (row.subtasks || [])
      .sort((a, b) => a.subtask_id.localeCompare(b.subtask_id))
      .map(subtaskRowToLocal),
  };
}

function userRowToLocal(row) {
  return {
    id:             row.id,
    email:          row.email,
    name:           row.name,
    role:           row.role,
    projects:       row.projects       || [],
    department:     row.department     || '',
    leadId:         row.lead_id        || null,
    maxStoryPoints: row.max_story_points || 35,
  };
}

// ── Insert payload builders ──────────────────────────────────────────────────

function buildFieldColumns(fields = {}) {
  let dimensions = fields.dimensions;
  if (typeof dimensions === 'string') {
    try   { dimensions = JSON.parse(dimensions); }
    catch { dimensions = dimensions ? [dimensions] : null; }
  }
  if (!Array.isArray(dimensions)) dimensions = dimensions ? [String(dimensions)] : null;
  return {
    title:               fields.title              || null,
    description:         fields.description        || null,
    brief_deck_url:      fields.brief_deck_url     || null,
    campaign_code:       fields.campaign_code      || null,
    campaign_start_date: fields.campaign_start_date || null,
    campaign_end_date:   fields.campaign_end_date  || null,
    platform:     Array.isArray(fields.platform)     ? fields.platform     : fields.platform     ? [fields.platform]     : null,
    posting_type: Array.isArray(fields.posting_type) ? fields.posting_type : fields.posting_type ? [fields.posting_type] : null,
    posting_date:        fields.posting_date       || null,
    sku_number:          fields.sku_number         || null,
    packaging_type:      fields.packaging_type     || null,
    brand:               fields.brand              || null,
    dimensions,
    live_date:           fields.live_date          || null,
  };
}

function buildSubtaskInsert(child, parentId, subtaskId) {
  const isCopywriting = (child.task_type || '').toLowerCase() === 'copywriting';
  return {
    parent_id:            parentId,
    subtask_id:           subtaskId,
    status:               'requested',
    story_points:         child.storyPoints         ?? null,
    assigned_to_id:       child.assignedTo?.id      || null,
    assigned_to_snapshot: child.assignedTo           || null,
    is_need_studio:       !!child.is_need_studio,
    is_need_copywriting:  isCopywriting || !!child.is_need_copywriting,
    task_type:            child.task_type            || null,
    asset_type_l1:        child.asset_type           || null,
    asset_type_l2:        child.asset_type_l2        || null,
    dlp_id:               child.dlp_id              || null,
    banner_name:          child.banner_name          || null,
    category_id:          child.category_id          || null,
    catalogue_id:         child.catalogue_id         || null,
    reference_id:         child.reference_id         || null,
    objective_type:       child.objective_type       || null,
    draft_url:            child.draft_url            || null,
    final_url:            child.final_url            || null,
    child_notes:          child.child_notes          || null,
    child_due:            child.child_due            || null,
  };
}

// Derive parent assignedTo from child assignees (mirrors localAdapter priority logic)
function deriveParentAssignedTo(childIssues) {
  const assigned = childIssues.filter(c => c.assignedTo?.id);
  if (!assigned.length) return null;
  const bau  = assigned.filter(c => !c.is_need_studio && !c.is_need_copywriting);
  const cw   = assigned.filter(c =>  c.is_need_copywriting && !c.is_need_studio);
  const pool = bau.length > 0 ? bau : cw.length > 0 ? cw : assigned;
  const freq = {};
  for (const c of pool) {
    const k = c.assignedTo.id;
    if (!freq[k]) freq[k] = { assignedTo: c.assignedTo, count: 0 };
    freq[k].count++;
  }
  return Object.values(freq).sort((a, b) => b.count - a.count)[0]?.assignedTo || null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Users ────────────────────────────────────────────────────────────────────

async function findUserByEmail(email) {
  const { data, error } = await supabase
    .from('users').select('*').eq('email', email).maybeSingle();
  if (error) { console.error('[supabase] findUserByEmail:', error.message); return null; }
  if (!data)  return null;
  return { ...userRowToLocal(data), password: data.password_hash };
}

async function findUserById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('users').select('*').eq('id', id).maybeSingle();
  if (error) { console.error('[supabase] findUserById:', error.message); return null; }
  if (!data)  return null;
  return { ...userRowToLocal(data), password: data.password_hash };
}

async function getAllUsers(filters = {}) {
  let query = supabase
    .from('users')
    .select('id, email, name, role, projects, department, lead_id, max_story_points');
  if (filters.role)   query = query.eq('role',    filters.role);
  if (filters.leadId) query = query.eq('lead_id', filters.leadId);
  const { data, error } = await query;
  if (error) { console.error('[supabase] getAllUsers:', error.message); return []; }
  return (data || []).map(userRowToLocal);
}

async function getAllLeads() {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, projects, department, lead_id, max_story_points')
    .eq('role', 'creative_lead');
  if (error) { console.error('[supabase] getAllLeads:', error.message); return []; }
  return (data || []).map(userRowToLocal);
}

async function createUser(data) {
  const insert = {
    id:               data.id       || uuidv4(),
    email:            data.email,
    password_hash:    data.password,
    name:             data.name,
    role:             data.role     || 'requester',
    projects:         data.projects  || [],
    department:       data.department || '',
    lead_id:          data.leadId   || null,
    max_story_points: data.maxStoryPoints || 35,
  };
  const { data: row, error } = await supabase
    .from('users').insert(insert)
    .select('id, email, name, role, projects, department, lead_id, max_story_points')
    .single();
  if (error) { console.error('[supabase] createUser:', error.message); throw error; }
  return userRowToLocal(row);
}

async function updateUser(userId, updates) {
  const db = {};
  if (updates.name           !== undefined) db.name             = updates.name;
  if (updates.role           !== undefined) db.role             = updates.role;
  if (updates.projects       !== undefined) db.projects         = updates.projects;
  if (updates.department     !== undefined) db.department       = updates.department;
  if (updates.leadId         !== undefined) db.lead_id          = updates.leadId;
  if (updates.maxStoryPoints !== undefined) db.max_story_points = updates.maxStoryPoints;
  if (updates.password       !== undefined) db.password_hash    = updates.password;
  const { data, error } = await supabase
    .from('users').update(db).eq('id', userId)
    .select('id, email, name, role, projects, department, lead_id, max_story_points')
    .single();
  if (error) { console.error('[supabase] updateUser:', error.message); return null; }
  return userRowToLocal(data);
}

async function updateUserLead(userId, newLeadId) {
  const lead = await findUserById(newLeadId);
  const db = {
    lead_id:    newLeadId,
    projects:   lead?.projects   || [],
    department: lead?.department || '',
  };
  const { data, error } = await supabase
    .from('users').update(db).eq('id', userId)
    .select('id, email, name, role, projects, department, lead_id, max_story_points')
    .single();
  if (error) { console.error('[supabase] updateUserLead:', error.message); return null; }
  return userRowToLocal(data);
}

// ── Requests ─────────────────────────────────────────────────────────────────

async function getAllRequests(filters = {}) {
  if (filters.emptyResult) return [];

  // Complex cross-project studio case → two-query approach
  if (filters.projects !== undefined && filters.studioMemberIds?.length) {
    return _getRequestsWithStudio(filters);
  }

  let query = supabase
    .from('tickets')
    .select(TICKET_SELECT)
    .order('submitted_at', { ascending: false });

  if (filters.status)           query = query.eq('status', filters.status);
  if (!filters.includeApproved) query = query.neq('status', 'approved');

  // Simple single-project filter (non-virtual)
  if (filters.project && filters.project !== 'studio' && filters.project !== 'copywriting') {
    query = query.eq('project', filters.project);
  }

  // Lead's real projects (no studio cross-project member IDs)
  if (filters.projects !== undefined && !filters.studioMemberIds?.length) {
    const real = filters.projects.filter(p => p !== 'studio' && p !== 'copywriting');
    if (!real.length) return [];
    query = query.in('project', real);
  }

  // Designer: also returns tickets where they're a subtask assignee — pre-filter with extra query
  if (filters.assignedTo) {
    const { data: subs } = await supabase
      .from('subtasks').select('parent_id').eq('assigned_to_id', filters.assignedTo);
    const extraIds = [...new Set((subs || []).map(s => s.parent_id))];
    if (extraIds.length) {
      query = query.or(`assigned_to_id.eq.${filters.assignedTo},id.in.(${extraIds.join(',')})`);
    } else {
      query = query.eq('assigned_to_id', filters.assignedTo);
    }
  }

  // Requester: own tickets
  if (filters.submittedBy) query = query.eq('submitted_by_id', filters.submittedBy);

  const { data, error } = await query;
  if (error) { console.error('[supabase] getAllRequests:', error.message); return []; }

  let list = (data || []).map(ticketRowToLocal);

  // JS-level virtual project filters
  if (filters.project === 'studio') {
    list = list.filter(r => r.childIssues?.some(c => c.is_need_studio));
  } else if (filters.project === 'copywriting') {
    list = list.filter(r => r.childIssues?.some(c => c.is_need_copywriting));
  }

  if (filters.requesterProjects?.length) {
    list = list.filter(r => filters.requesterProjects.includes(r.project));
  }

  return list;
}

// Sub-function: lead with studio cross-project access
async function _getRequestsWithStudio(filters) {
  const real      = filters.projects.filter(p => p !== 'studio' && p !== 'copywriting');
  const studioIds = filters.studioMemberIds;

  const baseQ = () => {
    let q = supabase.from('tickets').select(TICKET_SELECT);
    if (!filters.includeApproved) q = q.neq('status', 'approved');
    return q;
  };

  const [regularRes, studioSubRes] = await Promise.all([
    real.length
      ? baseQ().in('project', real).order('submitted_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from('subtasks').select('parent_id')
      .eq('is_need_studio', true)
      .in('assigned_to_id', studioIds),
  ]);

  if (regularRes.error)  console.error('[supabase] _getRequestsWithStudio regular:', regularRes.error.message);
  if (studioSubRes.error) console.error('[supabase] _getRequestsWithStudio studio subs:', studioSubRes.error.message);

  const regularTickets = (regularRes.data || []).map(ticketRowToLocal);
  const seenIds        = new Set(regularTickets.map(t => t.id));
  const crossIds       = [...new Set((studioSubRes.data || []).map(s => s.parent_id))].filter(id => !seenIds.has(id));

  let crossTickets = [];
  if (crossIds.length) {
    const { data, error } = await baseQ().in('id', crossIds);
    if (error) console.error('[supabase] _getRequestsWithStudio cross:', error.message);
    crossTickets = (data || []).map(ticketRowToLocal);
  }

  return [...regularTickets, ...crossTickets]
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

async function getRequestById(id) {
  const { data, error } = await supabase
    .from('tickets').select(TICKET_SELECT).eq('id', id).maybeSingle();
  if (error) { console.error('[supabase] getRequestById:', error.message); return null; }
  return data ? ticketRowToLocal(data) : null;
}

async function createRequest(data) {
  const now = new Date().toISOString();

  // Atomic ticket ID via DB function
  const { data: ticketId, error: idErr } = await supabase
    .rpc('generate_ticket_id', { p_project: data.project });
  if (idErr) { console.error('[supabase] generate_ticket_id:', idErr.message); throw idErr; }

  const ticketUUID = uuidv4();

  // Insert parent ticket
  const ticketInsert = {
    id:                   ticketUUID,
    ticket_id:            ticketId,
    project:              data.project,
    status:               'requested',
    story_points:         null,
    submitted_by_id:      data.submittedBy?.id || null,
    submitted_by_snapshot: data.submittedBy    || null,
    assigned_to_id:       null,
    assigned_to_snapshot: null,
    submitted_at:         now,
    ...buildFieldColumns(data.fields || {}),
  };
  const { error: ticketErr } = await supabase.from('tickets').insert(ticketInsert);
  if (ticketErr) { console.error('[supabase] createRequest ticket:', ticketErr.message); throw ticketErr; }

  // Parent status history
  await supabase.from('ticket_status_history').insert({
    ticket_id:       ticketUUID,
    from_status:     null,
    to_status:       'requested',
    changed_at:      now,
    changed_by_id:   data.submittedBy?.id   || null,
    changed_by_name: data.submittedBy?.name || null,
    changed_by_role: data.submittedBy?.role || null,
  });

  // Build subtasks
  const subtaskRows  = [];
  const historyRows  = [];
  const subtaskUUIDs = [];

  const childIssues = (data.childIssues || []).map((child, idx) => {
    const isCW = (child.task_type || '').toLowerCase() === 'copywriting';
    const merged = { ...child, is_need_copywriting: isCW || !!child.is_need_copywriting };
    const sp     = computeChildSP(data.project, merged, data.fields || {});
    const subId  = `${ticketId}-${String(idx + 1).padStart(2, '0')}`;
    const subUUID = uuidv4();
    subtaskUUIDs.push(subUUID);

    subtaskRows.push({
      id: subUUID,
      story_points: sp !== null ? sp : (child.storyPoints ?? null),
      ...buildSubtaskInsert(merged, ticketUUID, subId),
    });
    historyRows.push({
      subtask_id:      subUUID,
      from_status:     null,
      to_status:       'requested',
      changed_at:      now,
      changed_by_name: null,
      changed_by_role: null,
    });
    return {
      ...merged,
      id:            subUUID,
      ticketId:      subId,
      status:        'requested',
      storyPoints:   sp !== null ? sp : (child.storyPoints ?? null),
      statusHistory: [{ from: null, to: 'requested', changedAt: now }],
      comments:      [],
    };
  });

  if (subtaskRows.length) {
    const { error: subErr } = await supabase.from('subtasks').insert(subtaskRows);
    if (subErr) { console.error('[supabase] createRequest subtasks:', subErr.message); throw subErr; }
    await supabase.from('subtask_status_history').insert(historyRows);
  }

  // Update parent SP
  const totalSP = childIssues.length && childIssues.some(c => c.storyPoints != null)
    ? childIssues.reduce((s, c) => s + (c.storyPoints || 0), 0)
    : null;
  if (totalSP !== null) {
    await supabase.from('tickets').update({ story_points: totalSP }).eq('id', ticketUUID);
  }

  return {
    id:            ticketUUID,
    ticketId,
    status:        'requested',
    assignedTo:    null,
    submittedBy:   data.submittedBy || null,
    comments:      [],
    statusHistory: [{ from: null, to: 'requested', changedAt: now, changedBy: data.submittedBy || null }],
    submittedAt:   now,
    project:       data.project,
    fields:        data.fields || {},
    storyPoints:   totalSP,
    childIssues,
  };
}

async function updateRequest(id, updates, changedBy = null) {
  const now = new Date().toISOString();
  const db  = { updated_at: now };

  // Capture old status before writing (needed for history from-value)
  let oldStatus = null;
  if (updates.status !== undefined) {
    const { data: cur } = await supabase.from('tickets').select('status').eq('id', id).maybeSingle();
    oldStatus = cur?.status || null;
    db.status = updates.status;
  }

  if (updates.storyPoints !== undefined) db.story_points        = updates.storyPoints;
  if (updates.assignedTo  !== undefined) {
    db.assigned_to_id       = updates.assignedTo?.id || null;
    db.assigned_to_snapshot = updates.assignedTo     || null;
  }
  if (updates.fields !== undefined) Object.assign(db, buildFieldColumns(updates.fields));
  // ai_brief_note: not yet in schema — silently ignored

  const { error } = await supabase.from('tickets').update(db).eq('id', id);
  if (error) { console.error('[supabase] updateRequest:', error.message); return null; }

  // Insert status history entry
  if (updates.status !== undefined && updates.status !== oldStatus) {
    await supabase.from('ticket_status_history').insert({
      ticket_id:       id,
      from_status:     oldStatus,
      to_status:       updates.status,
      changed_at:      now,
      changed_by_id:   changedBy?.id   || null,
      changed_by_name: changedBy?.name || null,
      changed_by_role: changedBy?.role || null,
    });
  }

  return getRequestById(id);
}

async function addComment(requestId, comment) {
  if (!comment.postedBy?.id) return null;
  const now = new Date().toISOString();
  const { error } = await supabase.from('ticket_comments').insert({
    id:                 uuidv4(),
    ticket_id:          requestId,
    text:               comment.text      || null,
    image_data:         comment.imageData || null,
    posted_by_id:       UUID_RE.test(comment.postedBy.id) ? comment.postedBy.id : null,
    posted_by_snapshot: comment.postedBy,
    posted_at:          now,
  });
  if (error) { console.error('[supabase] addComment:', error.message); return null; }
  await supabase.from('tickets').update({ updated_at: now }).eq('id', requestId);
  return getRequestById(requestId);
}

async function addChildComment(requestId, childId, comment) {
  if (!comment.postedBy?.id) return null;
  const now = new Date().toISOString();

  // Verify child belongs to this parent
  const { data: child } = await supabase
    .from('subtasks').select('id').eq('id', childId).eq('parent_id', requestId).maybeSingle();
  if (!child) return null;

  const { error } = await supabase.from('subtask_comments').insert({
    id:                 uuidv4(),
    subtask_id:         childId,
    text:               comment.text      || null,
    image_data:         comment.imageData || null,
    posted_by_id:       UUID_RE.test(comment.postedBy.id) ? comment.postedBy.id : null,
    posted_by_snapshot: comment.postedBy,
    posted_at:          now,
  });
  if (error) { console.error('[supabase] addChildComment:', error.message); return null; }
  await supabase.from('tickets').update({ updated_at: now }).eq('id', requestId);
  return getRequestById(requestId);
}

async function updateChildIssue(requestId, childId, updates, changedBy = null) {
  const now = new Date().toISOString();

  // Fetch old status for history
  const { data: oldSub } = await supabase
    .from('subtasks').select('status').eq('id', childId).maybeSingle();
  const oldStatus = oldSub?.status || null;

  // Build subtask update payload
  const db = {};
  const FIELD_MAP = {
    status:              'status',
    storyPoints:         'story_points',
    draft_url:           'draft_url',
    final_url:           'final_url',
    child_due:           'child_due',
    child_notes:         'child_notes',
    is_need_studio:      'is_need_studio',
    is_need_copywriting: 'is_need_copywriting',
    task_type:           'task_type',
    asset_type_l2:       'asset_type_l2',
    objective_type:      'objective_type',
    dlp_id:              'dlp_id',
    banner_name:         'banner_name',
    category_id:         'category_id',
    catalogue_id:        'catalogue_id',
    reference_id:        'reference_id',
  };
  for (const [local, col] of Object.entries(FIELD_MAP)) {
    if (updates[local] !== undefined) db[col] = updates[local];
  }
  // asset_type (local) → asset_type_l1 (DB)
  if (updates.asset_type !== undefined) db.asset_type_l1 = updates.asset_type;
  // assignedTo snapshot
  if (updates.assignedTo !== undefined) {
    db.assigned_to_id       = updates.assignedTo?.id || null;
    db.assigned_to_snapshot = updates.assignedTo     || null;
  }

  const { error: subErr } = await supabase.from('subtasks').update(db).eq('id', childId);
  if (subErr) { console.error('[supabase] updateChildIssue:', subErr.message); return null; }

  // Insert subtask status history
  if (updates.status !== undefined && updates.status !== oldStatus) {
    await supabase.from('subtask_status_history').insert({
      subtask_id:      childId,
      from_status:     oldStatus,
      to_status:       updates.status,
      changed_at:      now,
      changed_by_id:   changedBy?.id   || null,
      changed_by_name: changedBy?.name || null,
      changed_by_role: changedBy?.role || null,
    });
    // DB trigger (trg_subtask_status_sync) handles parent ticket status + its history
  }

  // Recalculate parent SP and assignedTo from all siblings
  const { data: allSubs, error: sibErr } = await supabase
    .from('subtasks')
    .select('story_points, assigned_to_id, assigned_to_snapshot, is_need_studio, is_need_copywriting')
    .eq('parent_id', requestId);

  if (!sibErr && allSubs) {
    const children = allSubs.map(s => ({
      assignedTo:          s.assigned_to_snapshot || null,
      is_need_studio:      s.is_need_studio,
      is_need_copywriting: s.is_need_copywriting,
      storyPoints:         s.story_points,
    }));
    const totalSP = children.some(c => c.storyPoints != null)
      ? children.reduce((s, c) => s + (c.storyPoints || 0), 0)
      : null;
    const parentAssignedTo = deriveParentAssignedTo(children);
    await supabase.from('tickets').update({
      story_points:         totalSP,
      assigned_to_id:       parentAssignedTo?.id || null,
      assigned_to_snapshot: parentAssignedTo     || null,
      updated_at:           now,
    }).eq('id', requestId);
  }

  return getRequestById(requestId);
}

// Delegates to the DB function (scheduled or called on-demand)
async function autoApproveStaleTickets() {
  const { error } = await supabase.rpc('auto_approve_stale_subtasks');
  if (error) console.error('[supabase] autoApproveStaleTickets:', error.message);
}

// No-op — schema is managed externally via Supabase SQL editor
function initStorage() {
  console.log('[supabase] Using Supabase storage — schema managed externally');
}

module.exports = {
  initStorage,
  findUserByEmail, findUserById, getAllUsers, getAllLeads,
  createUser, updateUser, updateUserLead,
  getAllRequests, getRequestById, createRequest, updateRequest,
  addComment, addChildComment, updateChildIssue,
  autoApproveStaleTickets,
};
