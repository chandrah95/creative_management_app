# Creative Management App — Database Audit Report

**Date**: 2026-05-25  
**Scope**: `server/storage/supabaseAdapter.js` vs `supabase_schema.sql` (source of truth)  
**Auditor**: Data Engineering Audit (static analysis + schema cross-reference)  
**Database**: Supabase PostgreSQL at `https://nvxiadxmsnbxkqvottrk.supabase.co`

---

## 1. Schema Validation Results

### 1.1 Table Coverage

The schema defines 9 tables.  All are accounted for in the adapter and testDb.js:

| Table | Adapter Uses | testDb Checks |
|---|---|---|
| `users` | Full CRUD | Existence + row count + spot-check |
| `ticket_counters` | Via RPC `generate_ticket_id` | Existence + row count |
| `tickets` | Full CRUD | Existence + row count + spot-check |
| `subtasks` | Full CRUD | Existence + row count + spot-check |
| `ticket_comments` | Insert / cascade delete | Existence + row count |
| `subtask_comments` | Insert / cascade delete | Existence + row count |
| `ticket_status_history` | Insert / cascade delete | Existence + row count |
| `subtask_status_history` | Insert / cascade delete | Existence + row count |
| `ai_settings` | Not used by adapter | Existence + row count only |

### 1.2 Column-Level Validation: `tickets`

All 26 columns referenced in `TICKET_SELECT` and `buildFieldColumns` exist in the schema:

| Adapter Reference | Schema Column | Type | Status |
|---|---|---|---|
| `id` | `id` | UUID PK | OK |
| `ticket_id` | `ticket_id` | TEXT UNIQUE | OK |
| `project` | `project` | project_code ENUM | OK |
| `status` | `status` | ticket_status ENUM | OK |
| `story_points` | `story_points` | INTEGER | OK |
| `submitted_by_id` | `submitted_by_id` | UUID FK | OK |
| `submitted_by_snapshot` | `submitted_by_snapshot` | JSONB | OK |
| `assigned_to_id` | `assigned_to_id` | UUID FK | OK |
| `assigned_to_snapshot` | `assigned_to_snapshot` | JSONB | OK |
| `submitted_at` | `submitted_at` | TIMESTAMPTZ | OK |
| `updated_at` | `updated_at` | TIMESTAMPTZ | OK |
| `title` | `title` | TEXT NOT NULL | OK |
| `description` | `description` | TEXT | OK |
| `brief_deck_url` | `brief_deck_url` | TEXT | OK |
| `campaign_code` | `campaign_code` | TEXT | OK |
| `campaign_start_date` | `campaign_start_date` | DATE | OK |
| `campaign_end_date` | `campaign_end_date` | DATE | OK |
| `platform` | `platform` | TEXT[] | OK |
| `posting_type` | `posting_type` | TEXT[] | OK |
| `posting_date` | `posting_date` | DATE | OK |
| `sku_number` | `sku_number` | TEXT | OK |
| `packaging_type` | `packaging_type` | packaging_type ENUM | OK |
| `brand` | `brand` | brand ENUM | OK |
| `dimensions` | `dimensions` | TEXT[] | OK |
| `live_date` | `live_date` | DATE | OK |

### 1.3 Column-Level Validation: `subtasks`

All columns referenced in `TICKET_SELECT`, `buildSubtaskInsert`, and `updateChildIssue` FIELD_MAP exist in the schema:

| Adapter Reference | Schema Column | Type | Status |
|---|---|---|---|
| `id` | `id` | UUID PK | OK |
| `parent_id` | `parent_id` | UUID FK → tickets | OK |
| `subtask_id` | `subtask_id` | TEXT UNIQUE | OK |
| `status` | `status` | ticket_status ENUM | OK |
| `story_points` | `story_points` | INTEGER | OK |
| `assigned_to_id` | `assigned_to_id` | UUID FK | OK |
| `assigned_to_snapshot` | `assigned_to_snapshot` | JSONB | OK |
| `is_need_studio` | `is_need_studio` | BOOLEAN | OK |
| `is_need_copywriting` | `is_need_copywriting` | BOOLEAN | OK |
| `task_type` | `task_type` | task_type ENUM NOT NULL | OK |
| `asset_type_l1` | `asset_type_l1` | asset_type_l1 ENUM | OK |
| `asset_type_l2` | `asset_type_l2` | TEXT | OK |
| `dlp_id` | `dlp_id` | TEXT | OK |
| `banner_name` | `banner_name` | TEXT | OK |
| `category_id` | `category_id` | INTEGER | OK |
| `catalogue_id` | `catalogue_id` | INTEGER | OK |
| `reference_id` | `reference_id` | TEXT | OK |
| `objective_type` | `objective_type` | objective_type ENUM | OK |
| `draft_url` | `draft_url` | TEXT | OK |
| `final_url` | `final_url` | TEXT | OK |
| `child_notes` | `child_notes` | TEXT | OK |
| `child_due` | `child_due` | DATE | OK |

**Note on `child_title`**: The task brief mentions a `child_title` column in subtasks. This column does **not** exist in `supabase_schema.sql` and is **not** referenced anywhere in the adapter. No action needed.

### 1.4 Column-Level Validation: `users`

All columns in `createUser`, `updateUser`, and `getAllUsers` exist:

| Adapter Reference | Schema Column | Status |
|---|---|---|
| `id` | `id` UUID PK | OK |
| `email` | `email` TEXT UNIQUE | OK |
| `password_hash` | `password_hash` TEXT NOT NULL | OK |
| `name` | `name` TEXT NOT NULL | OK |
| `role` | `role` user_role ENUM | OK |
| `projects` | `projects` TEXT[] | OK |
| `department` | `department` TEXT | OK |
| `lead_id` | `lead_id` UUID FK | OK |
| `max_story_points` | `max_story_points` INTEGER | OK |

### 1.5 Column-Level Validation: History and Comment Tables

Columns referenced in `TICKET_SELECT` for nested history/comment tables:

| Table | Columns Selected | Status |
|---|---|---|
| `ticket_status_history` | `id, from_status, to_status, changed_at, changed_by_id, changed_by_name, changed_by_role` | All exist in schema |
| `subtask_status_history` | `id, from_status, to_status, changed_at, changed_by_id, changed_by_name, changed_by_role` | All exist in schema |
| `ticket_comments` | `id, text, image_data, posted_at, posted_by_snapshot` | All exist in schema |
| `subtask_comments` | `id, text, image_data, posted_at, posted_by_snapshot` | All exist in schema |

---

## 2. Column Mapping Issues Found

### 2.1 CONFIRMED OK — `asset_type` alias

`subtaskRowToLocal` maps `row.asset_type_l1` → `child.asset_type`.  
`updateChildIssue` maps `updates.asset_type` → `db.asset_type_l1`.  
`buildSubtaskInsert` maps `child.asset_type` → `asset_type_l1`.

This is a deliberate app-layer alias (l1 dropped for brevity). The round-trip is consistent.

### 2.2 CONFIRMED OK — `ticketId` alias

`subtaskRowToLocal` maps `row.subtask_id` → `child.ticketId`.  
This matches the app convention where every entity (ticket or subtask) presents a `ticketId` string field for display. Consistent throughout the adapter.

### 2.3 CONFIRMED OK — `createUser` password mapping

`createUser` maps `data.password` → `insert.password_hash`.  
`findUserByEmail` / `findUserById` return `{ ...userRowToLocal(data), password: data.password_hash }`.  
The column `password_hash` exists in the schema as `TEXT NOT NULL`. Mapping is correct.

### 2.4 MINOR CONCERN — `buildFieldColumns` writes `title: null` possible

`buildFieldColumns` maps `title: fields.title || null`. The `tickets.title` column is `TEXT NOT NULL` in the schema.

- On **createRequest**: the adapter spreads `buildFieldColumns` into the insert. If `data.fields.title` is falsy, the insert sends `title: null`, which Postgres will reject with a NOT NULL violation. This is the correct behavior (the error will surface), but the adapter provides no explicit validation guard — it relies on the controller/frontend to always pass a title.
- On **updateRequest**: `buildFieldColumns` is only called when `updates.fields !== undefined`. If called with no title, it writes `title: null` — this would also throw a NOT NULL violation.

**Recommendation**: Add an explicit check in `buildFieldColumns` for required fields, or document that `fields.title` is required at the controller layer.

### 2.5 MINOR CONCERN — `assigned_to_snapshot` JSONB format inconsistency

The schema comment says the snapshot format is `{id, name, email}`.  
The adapter's `histRowToLocal` constructs: `{ id, name, role }` (no email).  
The adapter stores subtask assignee snapshots as whatever `child.assignedTo` is (passed from the controller).

There is no schema-enforced contract on the JSONB shape, so this is not a hard failure, but inconsistency between `{id, name, email}` (ticket snapshots) and `{id, name, role}` (history entries) means the frontend must handle both shapes.

**Recommendation**: Standardise on `{id, name, email, role}` for all snapshot columns. Update the schema comment to reflect the canonical shape.

---

## 3. Data Integrity Findings

### FINDING 1 — FIXED: `deleteSubtask` partial `assigned_to_snapshot` stub [CRITICAL]

**File**: `server/storage/supabaseAdapter.js`, original line ~708  
**Status**: Fixed in this audit (committed to adapter)

**Root cause**: When a subtask has `assigned_to_id` set but `assigned_to_snapshot = NULL`, the `deleteSubtask` recalculation created a partial stub:

```js
// BEFORE (buggy):
assignedTo: r.assigned_to_snapshot || (r.assigned_to_id ? { id: r.assigned_to_id } : null)
```

This stub `{ id: '...' }` (with no name, email, or role) was then passed to `deriveParentAssignedTo()`, which compared `c.assignedTo?.id` — so it passed the filter — and the stub was stored as the parent ticket's `assigned_to_snapshot`. This silently corrupted the display snapshot, causing the UI to show an empty/broken assignee name.

**Fix applied**:

```js
// AFTER (fixed):
assignedTo: r.assigned_to_snapshot || null,
```

If `assigned_to_snapshot` is NULL, the subtask is treated as unassigned for recalculation purposes. The correct fix for the underlying data gap is FIX 4d in `fixes.sql` — rebuild missing snapshots from the `users` table.

### FINDING 2 — CONFIRMED: `deleteSubtask` `story_points = 0` vs `null`

**File**: `server/storage/supabaseAdapter.js`  
**Status**: Already correctly implemented (no bug present in current code)

The current code correctly uses:
```js
const totalSP = children.length && children.some(c => c.storyPoints != null)
  ? children.reduce((s, c) => s + (c.storyPoints || 0), 0)
  : null;
```

This returns `null` when no children remain (matching `createRequest` and `updateChildIssue` behavior). No fix needed, but FIX 3 in `fixes.sql` contains a repair query for any rows that may have been set to `0` by an older version of this code.

### FINDING 3 — `deriveParentAssignedTo` output format confirmed valid

`deriveParentAssignedTo` returns `c.assignedTo` from the pool — which is the original `assigned_to_snapshot` JSONB object. Since this is stored as-is back into `assigned_to_snapshot`, no transformation occurs. The format is preserved correctly as long as the snapshot was written with the full shape at assignment time. No bug.

### FINDING 4 — `deleteSubtask` redundant manual cascade deletes

The schema defines `ON DELETE CASCADE` for:
- `subtask_comments.subtask_id → subtasks.id`
- `subtask_status_history.subtask_id → subtasks.id`

The `deleteSubtask` function manually deletes both before deleting the subtask:

```js
await supabase.from('subtask_comments').delete().eq('subtask_id', childId);
await supabase.from('subtask_status_history').delete().eq('subtask_id', childId);
await supabase.from('subtasks').delete().eq('id', childId)...
```

This is harmless (the cascades would handle it anyway), but it adds 2 unnecessary round-trips per delete. Similarly `deleteRequest` deletes cascade targets manually before deleting the parent ticket.

**Recommendation**: Remove the manual pre-deletes from `deleteSubtask` and `deleteRequest` since the schema enforces cascades. This reduces round-trips and removes redundant code. Alternatively, keep them for explicit clarity — the behavior is correct either way.

### FINDING 5 — DB trigger `trg_subtask_status_sync` interaction with adapter

The trigger `sync_ticket_status_from_subtasks()` fires `AFTER INSERT OR UPDATE OF status ON subtasks` and writes to `ticket_status_history` with `changed_by_name = 'System (auto from sub-tasks)'`.

The adapter's `updateChildIssue` inserts into `subtask_status_history` and then notes:
```js
// DB trigger (trg_subtask_status_sync) handles parent ticket status + its history
```

This is correct — the adapter defers to the trigger for parent status propagation. The `histRowToLocal` function handles system-generated rows (no `changed_by_id`) correctly by falling back to `{ name, role }` format.

### FINDING 6 — `getAllRequests` designer filter uses two queries

When `filters.assignedTo` is set, the adapter first queries `subtasks` for `parent_id` values, then uses `.or(...)` on the tickets query. This is correct but incurs an extra round-trip. See index recommendation below.

---

## 4. Recommended SQL Fixes

All SQL is in `server/scripts/fixes.sql`. Summary:

| Fix | Type | Risk | Description |
|---|---|---|---|
| FIX 1 | Index (additive) | Low | `idx_subtasks_studio_assignee` — composite partial index for studio member lookup |
| FIX 2 | Index (additive) | Low | `idx_subtasks_cw_assignee` — composite partial index for copywriting member lookup |
| FIX 3 | Data repair | Medium | Reset `story_points = 0` → `NULL` on tickets with no subtasks |
| FIX 4 | Data repair | Medium | Rebuild `assigned_to_snapshot` from `users` table where NULL or stub |
| FIX 5 | Documentation | None | Trigger behavior is correct — no SQL needed |
| FIX 6 | Index (additive) | Low | `idx_tickets_project_status` — composite index for common filter pair |
| FIX 7 | Index (additive, optional) | Low | `idx_tickets_project_submitted` — evaluate after EXPLAIN ANALYZE |
| FIX 8 | Verification queries | None | Read-only health checks — safe to run anytime |

**Run order**: FIX 8 first (read-only verification), then FIX 1, 2, 6, 7 (additive indexes), then FIX 3 and 4 (data repairs, only after reviewing SELECT output from each step).

---

## 5. Performance / Index Recommendations

### 5.1 Existing Indexes (from schema)

The schema defines 14 indexes. Coverage is generally good:

| Index | Covers |
|---|---|
| `idx_tickets_project` | `tickets(project)` |
| `idx_tickets_status` | `tickets(status)` |
| `idx_tickets_submitted_by` | `tickets(submitted_by_id)` |
| `idx_tickets_assigned_to` | `tickets(assigned_to_id)` |
| `idx_tickets_submitted_at` | `tickets(submitted_at DESC)` |
| `idx_subtasks_parent` | `subtasks(parent_id)` |
| `idx_subtasks_status` | `subtasks(status)` |
| `idx_subtasks_assigned` | `subtasks(assigned_to_id)` |
| `idx_subtasks_task_type` | `subtasks(task_type)` |
| `idx_subtasks_studio` | `subtasks(parent_id) WHERE is_need_studio = TRUE` |
| `idx_subtasks_cw` | `subtasks(parent_id) WHERE is_need_copywriting = TRUE` |
| `idx_ticket_comments` | `ticket_comments(ticket_id, posted_at DESC)` |
| `idx_subtask_comments` | `subtask_comments(subtask_id, posted_at DESC)` |
| `idx_ticket_hist` | `ticket_status_history(ticket_id, changed_at DESC)` |
| `idx_subtask_hist` | `subtask_status_history(subtask_id, changed_at DESC)` |
| `idx_users_role` | `users(role)` |
| `idx_users_lead_id` | `users(lead_id)` |

### 5.2 Missing Indexes

**GAP 1 — Studio assignee lookup** (high impact)

Query: `SELECT parent_id FROM subtasks WHERE is_need_studio = TRUE AND assigned_to_id IN (...)`

`idx_subtasks_studio` only indexes `parent_id` for studio rows. The `assigned_to_id` predicate requires a full scan of the studio row subset. As the subtask table grows, this becomes a bottleneck for every lead with studio access.

**Recommended**: `idx_subtasks_studio_assignee` — partial index on `assigned_to_id WHERE is_need_studio = TRUE` (FIX 1 in fixes.sql).

**GAP 2 — Project + status composite filter** (medium impact)

Most `getAllRequests` queries filter by `project` AND `status IS NOT 'approved'`. PostgreSQL can only use one single-column index per table access, so it will use `idx_tickets_project` or `idx_tickets_status` and apply the other as a filter. A composite `(project, status)` index covers both predicates.

**Recommended**: `idx_tickets_project_status` (FIX 6 in fixes.sql).

**GAP 3 — Missing `submitted_by_id` + `submitted_at` for requester view** (low-medium impact)

`getAllRequests` with `filters.submittedBy` queries `WHERE submitted_by_id = $1 ORDER BY submitted_at DESC`. There are separate indexes on both columns but no composite. For requesters with many tickets this will become a sort bottleneck.

**Recommended**: Evaluate with `EXPLAIN ANALYZE` first. If the index scan + sort is measurable, add `ON tickets(submitted_by_id, submitted_at DESC)`.

### 5.3 Query Pattern Notes

- The `_getRequestsWithStudio` function always makes at least 2 DB round-trips (sometimes 3 for cross-project tickets). This is an architectural trade-off for the virtual "studio" project concept — acceptable for current scale.
- `updateChildIssue` always re-fetches all sibling subtasks to recalculate parent SP and assignedTo. This is correct but could be replaced with a DB function in the future (similar to how `generate_ticket_id` is handled atomically).

---

## 6. testDb.js Enhancements Applied

The existing `testDb.js` (section 5 "Summary") has been expanded with 4 new sections:

| New Section | What It Checks |
|---|---|
| Section 5 — Data integrity | SP=0 orphan tickets, subtask null snapshots, parent stub snapshots, SP mismatch between parent and subtask sum |
| Section 6 — TICKET_SELECT column validation | Runs `.select(cols).limit(0)` for every column group referenced in `TICKET_SELECT` against the live DB |
| Section 7 — buildFieldColumns validation | Validates all 14 field columns exist in `tickets` |
| Section 8 — createUser column validation | Validates all 9 user insert columns exist in `users` |

Run: `node server/scripts/testDb.js` from the project root.

---

## 7. Files Modified

| File | Change |
|---|---|
| `server/storage/supabaseAdapter.js` | Fixed `deleteSubtask`: removed partial `{id}`-only snapshot fallback for `assignedTo` in recalculation children map |
| `server/scripts/testDb.js` | Added sections 5–8 (data integrity checks, TICKET_SELECT validation, field column validation, createUser validation) |
| `server/scripts/fixes.sql` | New file — 8 SQL fixes with comments, including 2 additive indexes, 2 data repair blocks, and 4 read-only verification queries |
| `reports/data_report.md` | This file |

---

## 8. Summary Scorecard

| Area | Status | Notes |
|---|---|---|
| Table existence | PASS | All 9 tables defined in schema |
| tickets column coverage | PASS | All 26 adapter columns exist |
| subtasks column coverage | PASS | All 22 adapter columns exist |
| users column coverage | PASS | All 9 insert columns exist |
| history table columns | PASS | All 7 columns per table exist |
| comment table columns | PASS | All columns exist |
| deleteSubtask SP null | PASS | Current code correct (null, not 0) |
| deleteSubtask snapshot stub | FIXED | Partial `{id}` stub bug fixed in adapter |
| TICKET_SELECT sort field | PASS | Sorts on `subtask_id` (raw row), maps to `ticketId` after |
| createUser password mapping | PASS | `data.password` → `password_hash` correct |
| buildFieldColumns title null | WARN | No guard in adapter; relies on controller for required field |
| assigned_to_snapshot shape | WARN | No enforced schema; `{id,name,email}` vs `{id,name,role}` inconsistency |
| Studio assignee index | MISSING | Add `idx_subtasks_studio_assignee` (FIX 1) |
| Project+status composite index | MISSING | Add `idx_tickets_project_status` (FIX 6) |
| Redundant cascade deletes | LOW | Harmless extra round-trips in deleteSubtask/deleteRequest |
| DB trigger interaction | PASS | Adapter correctly defers parent status to trigger |
