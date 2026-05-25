-- ============================================================
--  Creative Management App — Schema & Data Fixes
--  Generated: 2026-05-25
--  Audit findings from: server/storage/supabaseAdapter.js vs
--                       supabase_schema.sql (schema source of truth)
--
--  HOW TO RUN:
--    1. Open Supabase Dashboard → SQL Editor → New Query
--    2. Run sections ONE AT A TIME — read each comment first
--    3. Do NOT run "FIX 3 – DESTRUCTIVE BACKFILL" without
--       confirming a snapshot backup exists
-- ============================================================


-- ============================================================
-- FIX 1 — COMPOSITE INDEX: subtasks studio+assigned lookup
-- ============================================================
--
-- PROBLEM:
--   _getRequestsWithStudio() runs:
--     SELECT parent_id FROM subtasks
--     WHERE is_need_studio = TRUE AND assigned_to_id IN (...)
--
--   The schema has:
--     idx_subtasks_studio  →  ON subtasks(parent_id) WHERE is_need_studio = TRUE
--   This partial index is on parent_id, NOT on assigned_to_id, so
--   the IN-filter on assigned_to_id requires a full scan of all
--   studio subtasks before applying the ID filter.
--
-- FIX: Create a composite index that covers both columns and
--      eliminates the full-scan on the studio pool.
--
-- RISK: Low — adding an index is non-destructive and reversible.
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subtasks_studio_assignee
  ON subtasks (assigned_to_id)
  WHERE is_need_studio = TRUE;


-- ============================================================
-- FIX 2 — COMPOSITE INDEX: copywriting subtask assignee lookup
-- ============================================================
--
-- PROBLEM:
--   A symmetric gap exists for copywriting subtasks.  Future
--   versions may run similar studio-style cross-project queries
--   for copywriting members.  The existing partial index
--   idx_subtasks_cw only covers parent_id.
--
-- RISK: Low — additive only.
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subtasks_cw_assignee
  ON subtasks (assigned_to_id)
  WHERE is_need_copywriting = TRUE;


-- ============================================================
-- FIX 3 — DATA REPAIR: parent story_points = 0 vs NULL
-- ============================================================
--
-- PROBLEM (adapter bug — deleteSubtask, line ~712):
--   When the last subtask of a ticket is deleted, the adapter
--   runs:
--     const totalSP = children.reduce((s, c) => s + (c.storyPoints || 0), 0);
--     // children is [] → totalSP = 0
--     await supabase.from('tickets').update({ story_points: 0 }).eq('id', ticketId);
--
--   But the contract is: story_points = NULL when no subtasks
--   exist (matching createRequest behavior and the updateChildIssue
--   path which uses `children.some(c => c.storyPoints != null) ?
--   sum : null`).  Writing 0 corrupts the "unscored" sentinel.
--
-- HOW TO IDENTIFY AFFECTED ROWS:
--   Tickets with story_points = 0 but no subtasks.
--
-- FIX: Reset corrupted rows to NULL.
--
-- RISK: Medium — verify the SELECT below before running the UPDATE.
--       If any legitimate ticket genuinely has SP=0 (unlikely by
--       business rules but theoretically possible) it would also
--       be reset.  Cross-check with childIssues count first.
-- ============================================================

-- STEP 3a: Identify affected rows (review before running 3b)
SELECT t.id, t.ticket_id, t.story_points, t.project
FROM   tickets t
WHERE  t.story_points = 0
  AND  NOT EXISTS (
         SELECT 1 FROM subtasks s WHERE s.parent_id = t.id
       );

-- STEP 3b: Repair (run only after confirming 3a output is correct)
UPDATE tickets
SET    story_points = NULL,
       updated_at   = NOW()
WHERE  story_points = 0
  AND  NOT EXISTS (
         SELECT 1 FROM subtasks s WHERE s.parent_id = tickets.id
       );


-- ============================================================
-- FIX 4 — DATA REPAIR: partial assigned_to_snapshot on parent
-- ============================================================
--
-- PROBLEM (adapter bug — deleteSubtask, line ~707-708):
--   When building the children list for recalculation after a
--   delete, the adapter falls back if assigned_to_snapshot is NULL:
--
--     assignedTo: r.assigned_to_snapshot
--              || (r.assigned_to_id ? { id: r.assigned_to_id } : null)
--
--   If a subtask row has assigned_to_id set but assigned_to_snapshot
--   is NULL (can happen if the snapshot was never written or was
--   cleared), the fallback creates a partial object { id } with no
--   name/email/role.  deriveParentAssignedTo() then stores this
--   partial object as the parent ticket's assigned_to_snapshot,
--   corrupting the display snapshot.
--
-- HOW TO IDENTIFY AFFECTED ROWS:
-- ============================================================

-- STEP 4a: Find parent tickets where snapshot is a bare {id} stub
SELECT id, ticket_id, assigned_to_snapshot
FROM   tickets
WHERE  assigned_to_snapshot IS NOT NULL
  AND  (assigned_to_snapshot->>'name') IS NULL;

-- STEP 4b: Find subtasks with assigned_to_id but NULL snapshot
SELECT id, subtask_id, assigned_to_id, assigned_to_snapshot
FROM   subtasks
WHERE  assigned_to_id IS NOT NULL
  AND  assigned_to_snapshot IS NULL;

-- STEP 4c: Repair tickets — join back to users to rebuild snapshot
--          (run only after reviewing 4a/4b output)
UPDATE tickets t
SET    assigned_to_snapshot = jsonb_build_object(
         'id',    u.id,
         'name',  u.name,
         'email', u.email,
         'role',  u.role
       ),
       updated_at = NOW()
FROM   users u
WHERE  t.assigned_to_id = u.id
  AND  t.assigned_to_snapshot IS NOT NULL
  AND  (t.assigned_to_snapshot->>'name') IS NULL;

-- STEP 4d: Repair subtasks — rebuild snapshot from users table
UPDATE subtasks s
SET    assigned_to_snapshot = jsonb_build_object(
         'id',    u.id,
         'name',  u.name,
         'email', u.email,
         'role',  u.role
       ),
       updated_at = NOW()
FROM   users u
WHERE  s.assigned_to_id = u.id
  AND  s.assigned_to_snapshot IS NULL;


-- ============================================================
-- FIX 5 — SCHEMA: Ensure ticket_status_history rows from the
--          DB trigger always have changed_by_role cast as TEXT
-- ============================================================
--
-- PROBLEM (trigger / adapter mismatch — cosmetic):
--   The DB trigger sync_ticket_status_from_subtasks() writes:
--     changed_by_role = 'system'
--   The column is TEXT — no issue.  But the adapter's
--   histRowToLocal() tries to reconstruct changedBy from
--   changed_by_id, changed_by_name, changed_by_role and the
--   system-generated rows have:
--     changed_by_id   = NULL
--     changed_by_name = 'System (auto from sub-tasks)'
--     changed_by_role = 'system'
--   histRowToLocal() returns { name, role } for these, which is
--   correct.  No SQL change needed — documented here for clarity.
--
-- NO FIX NEEDED — behaviour is correct.
-- ============================================================


-- ============================================================
-- FIX 6 — SCHEMA: Add missing index on tickets(project, status)
-- ============================================================
--
-- PROBLEM:
--   getAllRequests() frequently filters by BOTH project AND status:
--     .eq('project', filters.project)
--     .neq('status', 'approved')
--   The schema has separate single-column indexes
--   idx_tickets_project and idx_tickets_status.  PostgreSQL will
--   use only one for a query, performing a partial scan + filter
--   for the other predicate.  A composite index eliminates this.
--
-- RISK: Low — additive, CONCURRENTLY means no table lock.
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_project_status
  ON tickets (project, status);


-- ============================================================
-- FIX 7 — SCHEMA: Add missing index tickets(submitted_at DESC)
--          composite with status for lead-filtered queries
-- ============================================================
--
-- PROBLEM:
--   _getRequestsWithStudio fetches all non-approved tickets for a
--   set of projects, ordered by submitted_at DESC.  The existing
--   idx_tickets_submitted_at index covers submitted_at DESC but
--   does not include project, so queries that filter by both must
--   do a Bitmap Index Scan merge.  The composite (project,
--   submitted_at DESC) allows an Index Scan Only.
--
-- NOTE: Fix 6 already covers (project, status).  If the planner
--       needs submitted_at ordering, it can sort after the index
--       filter.  Evaluate EXPLAIN ANALYZE output before adding.
--
-- This statement is left commented out — add only if profiling
-- shows the existing indexes are insufficient:
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_project_submitted
--   ON tickets (project, submitted_at DESC);


-- ============================================================
-- FIX 8 — VERIFICATION QUERIES (read-only, safe to run anytime)
-- ============================================================

-- 8a. Count tickets by project and status (health check)
SELECT project, status, COUNT(*) AS cnt
FROM   tickets
GROUP  BY project, status
ORDER  BY project, status;

-- 8b. Tickets with mismatched story_points vs subtask sum
SELECT
  t.id,
  t.ticket_id,
  t.story_points                AS parent_sp,
  COALESCE(SUM(s.story_points), 0) AS subtask_sum,
  COUNT(s.id)                   AS subtask_count
FROM   tickets t
LEFT   JOIN subtasks s ON s.parent_id = t.id
GROUP  BY t.id, t.ticket_id, t.story_points
HAVING t.story_points IS DISTINCT FROM COALESCE(SUM(s.story_points), 0)
   OR  (COUNT(s.id) = 0 AND t.story_points IS NOT NULL);

-- 8c. Subtasks with assigned_to_id set but null snapshot (leads
--     to partial { id } stub on next parent recalculation)
SELECT id, subtask_id, assigned_to_id
FROM   subtasks
WHERE  assigned_to_id IS NOT NULL
  AND  assigned_to_snapshot IS NULL;

-- 8d. Tickets with assigned_to_id set but null or stub snapshot
SELECT id, ticket_id, assigned_to_id, assigned_to_snapshot
FROM   tickets
WHERE  assigned_to_id IS NOT NULL
  AND  (assigned_to_snapshot IS NULL
        OR (assigned_to_snapshot->>'name') IS NULL);

-- 8e. Users without password_hash (should never happen)
SELECT id, email, name, role FROM users
WHERE  password_hash IS NULL OR password_hash = '';

-- 8f. Orphaned subtask_status_history rows (subtask deleted without cascade)
SELECT h.id, h.subtask_id
FROM   subtask_status_history h
WHERE  NOT EXISTS (SELECT 1 FROM subtasks s WHERE s.id = h.subtask_id);

-- 8g. Orphaned ticket_status_history rows
SELECT h.id, h.ticket_id
FROM   ticket_status_history h
WHERE  NOT EXISTS (SELECT 1 FROM tickets t WHERE t.id = h.ticket_id);
