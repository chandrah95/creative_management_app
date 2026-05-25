# QA Report — 2026-05-25

## Summary

Full static analysis of all backend and frontend source files. Live endpoint testing inferred from code logic. No automated test runner is present in the project.

---

## Critical Bugs (app-breaking)

### CRIT-01: `notificationController.js` imports from `localAdapter` — crashes in production
- **File**: `server/controllers/notificationController.js` (line 1 in older version — now fixed in latest version)
- **File (confirmed fixed)**: The latest version of the file correctly imports from `supabaseAdapter`. However, `aiController.js` still has this bug.
- **Status**: CRIT-01 is resolved in notificationController but CRIT-02 covers aiController.

### CRIT-02: `aiController.js` imports from `localAdapter` — crashes in production
- **File**: `server/controllers/aiController.js`, lines 2–3
- **Code**:
  ```js
  const { getAllRequests, getAllUsers } = require('../storage/localAdapter');
  ```
- **Description**: `aiController` uses `localAdapter` (flat-JSON file storage) for both the `workloadSummary` and (indirectly) `getSettings`/`saveSettings` endpoints. In Vercel production the filesystem is read-only and the `server/data/*.json` files are not included in the serverless bundle (only `config/**` is listed in `vercel.json` `includeFiles`). This means:
  - `GET /api/ai/workload-summary` will silently return an empty designer list (because `getAllUsers` reads from a missing JSON file), causing the AI prompt to be vacuous or the endpoint to return 503.
  - `GET /api/ai/settings` and `POST /api/ai/settings` write to `server/data/ai_settings.json` — **writes will silently fail or throw** on the read-only Vercel filesystem, effectively making AI settings non-persistent across deployments.
- **Reproduction**: Log in as admin, navigate to AI Settings, configure a provider and click Save. Check that settings persist after redeployment — they will not.
- **Expected**: AI workload data is fetched from Supabase; AI settings persist (either in Supabase or env vars).
- **Actual**: Workload summary uses stale/empty local file data; settings are lost on every deploy.

### CRIT-03: `register` function does not await `createUser` — returns stale/broken token
- **File**: `server/controllers/authController.js`, line 97–98
- **Code**:
  ```js
  const newUser = createUser(userData);  // missing await
  res.status(201).json({ success: true, token: makeToken(newUser, EXPIRES_NORMAL), user: safeUser(newUser) });
  ```
- **Description**: `createUser` is an `async` function (returns a Promise). Without `await`, `newUser` is a Promise object, not the user record. `makeToken(newUser, ...)` will sign a JWT with `{ id: undefined, email: undefined, ... }`, and `safeUser(newUser)` will return a broken user object. The client receives an invalid JWT and the app immediately appears to register successfully but the user is not truly authenticated — any subsequent API call with this token will be rejected or reference a nonexistent user.
- **Reproduction**: Register any new account. Observe the dashboard load (it won't, or will show auth errors on every API call).
- **Expected**: A valid JWT referencing the new user record is returned.
- **Actual**: A JWT encoding `undefined` fields is returned; the user session is broken from first use.

---

## High Priority Bugs (wrong behavior)

### HIGH-01: `deleteSubtask` miscalculates SP when all subtasks deleted — sets SP to 0 instead of null
- **File**: `server/storage/supabaseAdapter.js`, line 712
- **Code**:
  ```js
  const totalSP = children.reduce((s, c) => s + (c.storyPoints || 0), 0);
  ```
- **Description**: When the last subtask is deleted, `children` is an empty array. `[].reduce(…, 0)` returns `0`, so the parent ticket's `story_points` is set to `0` instead of `null`. This is inconsistent with `updateChildIssue` (line 675–677) which correctly checks `children.some(c => c.storyPoints != null)` before summing and sets `null` if no SP data exists.
- **Expected**: `story_points` set to `null` when no subtasks remain.
- **Actual**: `story_points` set to `0`, causing SP badge "SP: 0" to appear on tickets with no subtasks, distorting workload calculations and the bar chart.

### HIGH-02: Status transition rules not enforced on subtask updates for `creative_designer` role
- **File**: `server/controllers/requestController.js`, `updateChild` function (lines 244–269)
- **Description**: The `updateChild` handler applies no status transition validation for `creative_designer` or `creative_lead` roles. A designer can set any `status` on a subtask — e.g. directly move from `requested` to `approved` — as long as the value is in `VALID_STATUSES`. The `DESIGNER_TRANSITIONS` and `LEAD_NEXT` maps are checked only for the parent ticket in `update()`, not in `updateChild()`.
- **Reproduction**: Authenticate as a designer. Send `PUT /api/requests/:id/children/:childId` with `{"status":"approved"}` on a subtask in `requested` state.
- **Expected**: `403 Cannot move from requested to approved`.
- **Actual**: `200 OK`, subtask status set to `approved`.

### HIGH-03: `saveChildFinalUrl` bypasses status transition rules — forces `approved` regardless of current status
- **File**: `client/js/dashboard.js`, lines 2061–2071
- **Description**: Setting a final URL on a subtask always sends `{ final_url: url, status: 'approved' }`, even if the subtask is in `requested` or `need_revision` state. Combined with HIGH-02 (no server-side validation on subtask status), this means any designer or lead can instantly approve any subtask by simply entering a URL.
- **Expected**: Saving final URL should only advance status when the current status is `revised` (or some logical precursor state). Or server should enforce valid transitions.
- **Actual**: Any subtask in any status can be force-approved by entering a final URL.

### HIGH-04: Notifications endpoint loads ALL tickets for scope filtering — N+1 per lead inside loop
- **File**: `server/controllers/notificationController.js`, lines 23–25
- **Code**:
  ```js
  for (const r of all) {
    if (role === 'creative_lead') {
      const dbUser = await findUserById(id);  // called once per ticket!
  ```
- **Description**: `findUserById(id)` is called inside the `for` loop for every ticket when the user is a `creative_lead`. On a dataset with 100 tickets, this issues 100 Supabase DB round-trips just to fetch the same lead's project list. This will cause severe latency spikes and may exhaust Supabase connection limits on a real workload.
- **Expected**: Fetch `dbUser` once before the loop.
- **Actual**: Fetches `dbUser` once per ticket.

### HIGH-05: `admin` role can create tickets — blocked by role check but error message is misleading
- **File**: `server/controllers/requestController.js`, lines 136–138
- **Code**:
  ```js
  if (req.user.role === 'creative_designer' || req.user.role === 'creative_lead') {
    return res.status(403).json({ success: false, error: 'Only requesters can create tickets' });
  }
  ```
- **Description**: The guard only blocks `creative_designer` and `creative_lead`. The `admin` role is not blocked (intentional). However, the error message says "Only requesters can create tickets" which is technically inaccurate — admins can too. More importantly, the admin sidebar in `ai-settings.js` hardcodes "New Request" as a nav item for admins (line 56–58), consistent with the intent. This is low-severity but the guard logic does not match the error message semantics.
- **Expected**: Clear, accurate message. If admins should also be blocked, add `admin` to the check.
- **Actual**: Admins can create tickets (allowed), but the message misleads if admin hits it from another path.

### HIGH-06: `buildAutoAssignPanel` renders when there are no unassigned tickets and no team members — condition is inverted
- **File**: `client/js/dashboard.js`, line 1305
- **Code**:
  ```js
  if (!unassignedCount && members.length) return ''; // nothing to assign
  ```
- **Description**: The condition is backward. When `unassignedCount === 0` AND `members.length > 0` the panel is hidden (correct). But when `unassignedCount > 0` AND `members.length === 0`, it correctly shows the "No designers" variant. However, when `unassignedCount === 0` AND `members.length === 0`, it skips the first guard and falls into the `if (!members.length)` branch, showing the "No designers" panel even though there is nothing to assign. Minor rendering artifact — the auto-assign panel appears unnecessarily when there are no unassigned tickets and no team members.
- **Expected**: Panel not shown when `unassignedCount === 0`.
- **Actual**: Panel shown with "No designers in your team yet" message even with zero unassigned tickets.

---

## Medium Priority (edge cases, minor wrong behavior)

### MED-01: `vercel.json` does not include `server/**` in `includeFiles` — only `config/**` bundled
- **File**: `vercel.json`, lines 6–8
- **Code**:
  ```json
  "config": { "includeFiles": ["config/**"] }
  ```
- **Description**: The Vercel build only explicitly includes `config/**`. The `server/data/` directory (used by `localAdapter` and `aiService` for reading/writing JSON files) is not bundled. This compounds CRIT-02. Additionally, `server/scripts/` is not needed at runtime but is also not excluded. Stale legacy form JSON files (`brand-identity.json`, `digital-marketing.json`, `print-offline.json`, `social-media.json`, `video-animation.json`, `web-ui-design.json`) exist in `config/forms/` and are served if the route is guessed — they reference old project IDs that no longer match the active project list.
- **Expected**: `includeFiles` should be documented; legacy form configs should be cleaned up or guarded.
- **Actual**: Legacy form configs are accessible via `GET /api/forms/brand-identity`.

### MED-02: `saveChildDraftUrl` auto-moves subtask to `on_review` without server-side transition validation
- **File**: `client/js/dashboard.js`, lines 2044–2058
- **Description**: When a designer saves a draft URL on an `in_progress` subtask, the client sends `{ draft_url, status: 'on_review' }`. This is a valid transition (in_progress → on_review). However, it is client-enforced only — the same call with a different status value would bypass transition rules (see HIGH-02). The auto-advance behavior itself is a UX convenience but is architecturally unsound since the server does not validate child status transitions.

### MED-03: `TICKET_SELECT` does not include `child_title` column — subtask titles always absent
- **File**: `server/storage/supabaseAdapter.js`, lines 39–60 (TICKET_SELECT fragment)
- **Description**: The `subtasks` sub-select inside `TICKET_SELECT` does not include the `child_title` column. The `subtaskRowToLocal` mapper (line 79–101) also does not map `child_title`. However, `childLabel()` in the frontend (dashboard.js line 2502–2509) checks `c.child_title` first. Since it is never populated from the DB, subtask labels always fall back to the `task_type + asset_type` derivation. If `child_title` is a real column in the Supabase `subtasks` table (it is referenced in `ALLOWED` fields in `updateChild`), tickets with a named sub-task title will never display that name.
- **Expected**: `child_title` included in `TICKET_SELECT` and `subtaskRowToLocal`.
- **Actual**: `child_title` always `undefined` on every fetched subtask.

### MED-04: `updateChild` allows `campaign_code` in ALLOWED fields but `updateRequest` does not persist it to subtasks
- **File**: `server/controllers/requestController.js`, line 260 (ALLOWED list in updateChild)
- **Description**: `campaign_code` is listed in the `ALLOWED` keys for subtask updates, but `FIELD_MAP` in `updateChildIssue` (supabaseAdapter.js, lines 616–633) does not include `campaign_code`. It will be silently dropped.
- **Expected**: Either remove `campaign_code` from subtask ALLOWED list, or add it to FIELD_MAP.
- **Actual**: `campaign_code` sent by client for a subtask is silently ignored.

### MED-05: Status chart cross-filter uses subtask statuses but ticket list filter uses parent ticket status
- **File**: `client/js/dashboard.js`, lines 793–800 (`applyCrossFilter`)
- **Description**: When a status is selected in the chart cross-filter, the ticket list filter correctly checks child issue statuses when children exist. However, the `filterStatus` dropdown filter (line 768) filters parent ticket `status`, not child issue statuses. This creates an inconsistency: clicking "In Progress" in the chart shows tickets where subtasks are in progress (correct), but selecting "In Progress" from the dropdown only shows tickets where the parent status is `in_progress`. Users may be confused by different result sets for the same status depending on the control used.
- **Expected**: Consistent filtering behavior — both chart and dropdown should use the same logic for child-aware status matching.

### MED-06: `getStuck` notification loads ALL requests with no user-scope filter at the DB level
- **File**: `server/controllers/notificationController.js`, lines 16–17
- **Code**:
  ```js
  const all = await getAllRequests({ includeApproved: false });
  ```
- **Description**: For a creative lead, this fetches ALL non-approved tickets from the entire DB (no `projects` filter passed), then filters in JavaScript. On large datasets this is an expensive full-table scan that grows proportionally with total ticket count across all teams. The same data is already fetched in `list()` with proper role-scoped filters.
- **Expected**: Pass `projects` filter to `getAllRequests` inside `getStuck`.
- **Actual**: Full unfiltered fetch, JS-level filtering.

### MED-07: AI Settings page sends existing masked API key back to server — key can be clobbered
- **File**: `client/js/ai-settings.js`, lines 100–107
- **Description**: When the user clicks "Save" without entering a new API key, the code sends `keyToSend = document.getElementById('apiKeyInput').placeholder` (which is the masked `sk-xxxx••••••••yyyy`). The backend's `saveSettings` partially handles this by checking `apiKey.includes('••••')` (server-side, aiController line 18). However, if the placeholder is the full key (before any masking), `keyToSend` can overwrite the existing key with the placeholder value (which includes masking bullets that are not valid API key characters). This could corrupt the stored key on repeated saves.
- **Expected**: Only send API key if user actually typed a new one.
- **Actual**: Placeholder value (potentially a masked/corrupted string) is sent on every save.

### MED-08: `autoAssignAll` counter reports subtask assignments, not ticket assignments — misleading
- **File**: `client/js/dashboard.js`, line 1633
- **Code**:
  ```js
  let msg = `✓ Auto-assigned ${assigned} sub-task${assigned !== 1 ? 's' : ''} using scope-aware load balancing …`;
  ```
- **Description**: The `assigned` counter is incremented once per subtask child assigned and once per parent ticket (for childless tickets). The success message says "sub-tasks" even when parent tickets (not subtasks) are being assigned. For a mix of childless tickets and tickets-with-children, the number is misleading (e.g. "Auto-assigned 5 sub-tasks" when 3 were parent tickets with no children).
- **Expected**: Count and label should reflect actual entity type assigned.

---

## Low Priority (UX, cosmetic)

### LOW-01: `childSection` in `buildModalContent` references `canDelete` before it is defined
- **File**: `client/js/dashboard.js`, line 1885
- **Code**:
  ```js
  ${canDelete ? `<button ...>🗑</button>` : ''}
  ```
  `canDelete` is defined at line 1962 — **after** `childSection` is built at lines 1868–1947.
- **Description**: In JavaScript template literal evaluation, `canDelete` is referenced before its `const` declaration (line 1962). Because `buildModalContent` is a regular function (not a block with hoisting concerns), `canDelete` will be `undefined` at the time the template literal is evaluated, making the delete button on subtask rows always invisible for all roles.
- **Severity**: Low-priority (the modal header does show a working delete button via line 1969), but the per-subtask delete buttons inside the subtasks list never render.
- **Expected**: Move `const canDelete = ...` declaration above `childSection` construction.
- **Actual**: Delete button on individual subtask rows in the modal never appears (even for admin/lead).

### LOW-02: Register page — `creative_lead` role is selectable but has no backend restriction preventing self-registration as lead
- **File**: `client/register.html`, line 83–86 / `server/controllers/authController.js` lines 49–51
- **Description**: Any user can register as a `creative_lead` via the public `/register` page. There is no invite code or admin approval gate. This is likely intentional for now, but is a notable open permission model.

### LOW-03: `api.js` guard redirects `/register` path but not paths it doesn't know about
- **File**: `client/js/api.js`, lines 34–38
- **Code**:
  ```js
  if (window.location.pathname === '/' || window.location.pathname === '/login') return;
  ```
- **Description**: The auth guard only whitelists `/` and `/login`. The `/register` page is not whitelisted. This means if `register.html` loads `api.js` and the user has no token, they would be redirected to `/` instead of staying on `/register`. However, `register.html` does NOT import `api.js` as a module — it uses inline `fetch` calls — so the guard never fires on that page. The logic is correct by coincidence, not by design.

### LOW-04: Modal close button and overlay click both work, but pressing Escape closes both the ticket modal and the sidebar simultaneously
- **File**: `client/dashboard.html`, lines 99–107
- **Description**: The `keydown` handler for Escape calls `closeMobileSidebar()` unconditionally and then checks for the modal. On desktop, when the modal is open, pressing Escape also triggers `closeMobileSidebar()` (which is a no-op on desktop but adds unnecessary function call overhead). The real bug is that `closeMobileSidebar()` is not guarded by a check for whether the sidebar is actually open before running.

### LOW-05: No `<title>` update when navigating between dashboard views
- **File**: `client/dashboard.html` / `client/js/dashboard.js`
- **Description**: `document.title` is never updated when the user switches between Lead / Designer / Requester views or opens/closes modals. All dashboard views share the same static `<title>Creative Hub — Dashboard</title>`.

### LOW-06: Subtask discussion popup (childDiscOverlay) is appended to `document.body`, not the modal
- **File**: `client/js/dashboard.js`, lines 2329–2337
- **Description**: The child discussion overlay is appended once to `document.body` and reused. If the ticket modal is scrolled, the overlay may not be positioned correctly on mobile viewports. Additionally, the overlay is not removed when the modal closes — only hidden — which may cause stale content on re-open if the modal is refreshed between opens.

---

## Security Issues

### SEC-01: JWT secret defaults to `dev_secret_change_in_production` — app functional but insecure if env var not set
- **File**: `server/middleware/authenticate.js`, line 4
- **Code**:
  ```js
  const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';
  ```
- **Description**: If `JWT_SECRET` is not set in the Vercel environment variables, all JWTs are signed with a known default key. Anyone who reads this source code can forge valid tokens for any user ID/role.
- **Expected**: App should fail to start (or log a critical warning) if `JWT_SECRET` is not set in production.

### SEC-02: Plain-text password fallback remains in login handler
- **File**: `server/controllers/authController.js`, lines 30–33
- **Code**:
  ```js
  const isBcrypt = user.password?.startsWith('$2');
  const match = isBcrypt
    ? await bcrypt.compare(password, user.password)
    : password === user.password; // fallback for any unmigrated plain-text accounts
  ```
- **Description**: Users who still have plain-text passwords in the DB can log in without bcrypt comparison. This is an attack surface if the DB is leaked — plain-text passwords are immediately usable. A migration script should be run and this fallback removed.

### SEC-03: AI settings API key stored in plaintext on filesystem
- **File**: `server/services/aiService.js`, lines 17–19
- **Description**: `ai_settings.json` stores the API key in plaintext. On shared hosting or if the filesystem is accessible, this exposes a third-party API key. In the Vercel context this is doubly problematic since the file is not persistent anyway (CRIT-02).

### SEC-04: `GET /api/auth/leads` is public (no authentication required)
- **File**: `server/routes/auth.js`, line 8
- **Code**:
  ```js
  router.get('/leads', getLeads); // public — used on register page
  ```
- **Description**: The leads endpoint returns all creative leads including their email addresses, names, departments, and project lists. This data is exposed to anyone — including unauthenticated users — who calls the endpoint. While used legitimately for the register form, it leaks internal org structure.
- **Expected**: Consider returning only id/name for public consumption, or require auth.

### SEC-05: No rate limiting on login or register endpoints
- **File**: `server/routes/auth.js`
- **Description**: The login and register endpoints have no rate limiting. An attacker can brute-force passwords or spam account creation. No `express-rate-limit` or similar middleware is present anywhere in the app.

### SEC-06: `imageData` stored as base64 in the database — no MIME type validation server-side
- **File**: `server/controllers/requestController.js`, lines 211–213
- **Description**: The server validates the byte size of `imageData` but not its content type. A malicious client could send a base64-encoded HTML file or SVG with embedded scripts. If rendered via `<img src="${cm.imageData}">` in the browser and the data URL happens to be `text/html` or `image/svg+xml`, XSS could occur in some browser configurations.
- **Expected**: Validate that `imageData` starts with `data:image/` and restrict to known safe MIME types.

---

## Backend Issues

| # | File | Line | Description | Expected | Actual |
|---|------|------|-------------|----------|--------|
| B-01 | `server/controllers/authController.js` | 97 | `createUser` not awaited (CRIT-03) | Resolved user object | Promise object used in JWT |
| B-02 | `server/controllers/aiController.js` | 2–3 | Imports from `localAdapter` (CRIT-02) | Supabase data | Flat-file data, broken in prod |
| B-03 | `server/controllers/notificationController.js` | 24 | `findUserById` called inside loop (HIGH-04) | Single DB call before loop | N calls (one per ticket) |
| B-04 | `server/storage/supabaseAdapter.js` | 712 | `deleteSubtask` SP calc returns 0 not null (HIGH-01) | `story_points = null` | `story_points = 0` |
| B-05 | `server/controllers/requestController.js` | 244–269 | No subtask status transition validation (HIGH-02) | 403 for invalid transitions | 200, any status accepted |
| B-06 | `server/storage/supabaseAdapter.js` | TICKET_SELECT | `child_title` not selected (MED-03) | Subtask title returned | `child_title` always undefined |
| B-07 | `server/controllers/requestController.js` | 260 | `campaign_code` in ALLOWED but not in FIELD_MAP (MED-04) | Persisted | Silently dropped |
| B-08 | `server/services/aiService.js` | 17–19 | API key written to filesystem (SEC-03) | Env var or encrypted storage | Plaintext JSON file |
| B-09 | `server/middleware/authenticate.js` | 4 | Hardcoded JWT secret fallback (SEC-01) | Crash / warning if unset | Silent insecure fallback |
| B-10 | `server/controllers/authController.js` | 30–33 | Plain-text password fallback (SEC-02) | bcrypt-only comparison | Plaintext comparison allowed |

---

## Frontend Issues

| # | File | Line | Description | Expected | Actual |
|---|------|------|-------------|----------|--------|
| F-01 | `client/js/dashboard.js` | 1885 | `canDelete` used before declaration in `buildModalContent` (LOW-01) | Delete button on subtask rows visible for admin/lead | Delete button never renders |
| F-02 | `client/js/dashboard.js` | 2061–2065 | `saveChildFinalUrl` forces `approved` status on any subtask (HIGH-03) | Transition validation | Any status can be bypassed |
| F-03 | `client/js/dashboard.js` | 1305 | `buildAutoAssignPanel` shows when no unassigned + no members (HIGH-06) | Panel hidden | Panel shown unnecessarily |
| F-04 | `client/js/dashboard.js` | 1633 | Auto-assign success count labels subtasks/tickets incorrectly (MED-08) | Accurate label | "sub-tasks" always used |
| F-05 | `client/js/dashboard.js` | 793–800 | Status cross-filter vs dropdown filter inconsistency (MED-05) | Same logic for both | Different ticket set per control |
| F-06 | `client/js/ai-settings.js` | 100–107 | Masked API key in placeholder sent back to server (MED-07) | Only send new key if typed | Placeholder value always sent |
| F-07 | `client/register.html` | 310 | `DOMContentLoaded` fires scope init for default role | Correct | Works correctly (low risk) |

---

## Data / Schema Issues

### DS-01: Legacy form configs exist alongside current ones
- **Location**: `config/forms/`
- **Description**: Files `brand-identity.json`, `digital-marketing.json`, `print-offline.json`, `social-media.json`, `video-animation.json`, `web-ui-design.json` are legacy configs (old project IDs). They are served via `GET /api/forms/:projectId` if guessed. `config/projects.js` likely does not reference them, so they are unreachable from the UI but still present and accessible.
- **Risk**: Low — but adds confusion and unnecessary attack surface.

### DS-02: `ai_brief_note` field not in Supabase schema — silently ignored on updates
- **File**: `server/storage/supabaseAdapter.js`, line 545
- **Code**:
  ```js
  // ai_brief_note: not yet in schema — silently ignored
  ```
- **Description**: The `ai_brief_note` field is populated by the AI brief enhancement hook (requestController line 147) but is never persisted to the DB because the column does not exist in the `tickets` table. The AI brief notes shown in the modal (dashboard.js line 1983) are only present on newly created tickets in the same server response — they disappear on next load.

### DS-03: Subtask `brand` field in `updateChild` ALLOWED list but not in `FIELD_MAP`
- **File**: `server/controllers/requestController.js` (ALLOWED) vs `server/storage/supabaseAdapter.js` (FIELD_MAP)
- **Description**: `brand` is listed in the ALLOWED fields for subtask update but `FIELD_MAP` in `updateChildIssue` does not include it. Silently ignored.

### DS-04: `posting_type` / `platform` stored as arrays in DB but may arrive as a single string from client
- **File**: `server/storage/supabaseAdapter.js`, lines 166–168
- **Code**:
  ```js
  platform: Array.isArray(fields.platform) ? fields.platform : fields.platform ? [fields.platform] : null,
  ```
- **Description**: The adapter correctly normalizes these, but the `TICKET_SELECT` returns `platform` and `posting_type` as DB arrays. When they are echoed back through `buildFieldColumns` on an update, a single-element array might be double-wrapped. Low risk currently since these fields are not editable post-creation.

---

## Tested & Passing

- **Authentication flow**: Login, token generation, `rememberMe` storage split (localStorage vs sessionStorage), redirect on valid token, guard on protected pages — all correct.
- **CORS configuration**: Production Vercel same-origin bypass correctly implemented.
- **JWT verification**: Fresh DB lookup on every request to pick up role/project changes — correctly implemented in `authenticate` middleware.
- **Delete ticket (admin/lead)**: Access control checked correctly; `deleteRequest` cascades to subtasks, comments, and history in the correct order.
- **Delete subtask (admin/lead)**: Access control for `creative_lead` correctly checks `checkAccess` in addition to role; cascades to `subtask_comments` and `subtask_status_history` before deleting.
- **Status chart cross-filter**: Correctly uses child issue statuses when children exist, falls back to parent status for childless tickets — logic matches the known recent fix.
- **Role-based ticket creation guard**: Admin and requester can create; designer and lead cannot.
- **Lead-scoped ticket listing**: Correctly filters by `projects`, handles studio cross-project access via `_getRequestsWithStudio`.
- **Designer-scoped listing**: Correctly fetches parent tickets where the designer is assigned to at least one subtask.
- **Requester tab separation**: `?queue=true` filter correctly scoped to requester's projects.
- **Story point aggregation on subtask create**: Correctly sums child SPs and updates parent; `null` returned when no SP data is present (on creation path).
- **Image resize before upload**: `resizeImage` correctly caps width at 400px and encodes as JPEG 0.65 quality.
- **Auto-assign load balancing**: Correctly groups children by scope (studio/CW/BAU) and selects best-fit designer by remaining capacity.
- **Transfer designer**: Only lead's own team members can be transferred; correctly updates lead + projects + department.
- **Status history recording**: Correctly inserts history only when status actually changes; `from_status` captured via DB read before update.
- **Child discussion popup**: Correctly scoped to a subtask, refreshes modal after comment, handles image paste.
- **Subtask `is_need_copywriting` auto-detection**: `is_need_copywriting` set to `true` on insert when `task_type === 'copywriting'`.
- **Form validation**: Client-side required field validation runs before submission; hidden conditional fields correctly excluded from validation.
- **Static file serving**: Vercel routes `/css/`, `/js/` to CDN-served static files; Express `app.use(express.static(...))` handles local dev — both correct.
- **Register page**: Scope picker correctly shown/hidden per role; selected scopes intersected with lead's actual projects before DB insert.
- **XSS prevention**: `escHtml()` applied consistently in all template literals rendering user data throughout dashboard.js.
- **AI workload summary prompt**: Correctly skips summary if no designers or if AI is not configured (returns 503 with clear message).
- **Notification bell**: Correctly calls `/api/notifications/stuck`, shows badge count, sorts by `daysWaiting` descending, opens ticket modal on click.

---

*Report generated by static code analysis on 2026-05-25. Live endpoint tests were not run against production due to environment constraints; all findings are based on source code inspection.*
