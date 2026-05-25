# Backend Bug Fix Report

**Date:** 2026-05-25  
**Auditor:** Senior Backend Engineer (Claude Code)  
**Scope:** `server/` and `api/` directories only

---

## Bugs Found and Fixed

### Bug 1 — CRITICAL: Missing `await` on `createUser` in `register` (authController.js)

**File:** `server/controllers/authController.js`, line 97  
**Severity:** Critical — registration always crashed or returned a broken token

**Root cause:** `createUser` is an `async` function that performs a Supabase insert and returns a `Promise<User>`. Without `await`, the variable `newUser` was a raw Promise object, not a user record. Calling `makeToken(newUser, ...)` and `safeUser(newUser)` on that Promise would produce a JWT with `undefined` fields and a broken user object — or throw entirely.

**Fix:**
```js
// Before (broken)
const newUser = createUser(userData);

// After (correct)
const newUser = await createUser(userData);
```

---

### Bug 2 — CRITICAL: `notificationController.js` imported from non-existent `localAdapter`

**File:** `server/controllers/notificationController.js`  
**Severity:** Critical — every request to `GET /api/notifications/stuck` would throw a `MODULE_NOT_FOUND` error at runtime

**Root cause:** The controller imported `getAllRequests` and `findUserById` from `'../storage/localAdapter'`, which does not exist in this Supabase-backed codebase. Additionally, `getStuck` was a synchronous function calling async adapter methods without `await`, so data would never be returned correctly even if the import were fixed.

**Fix:** Rewrote the file to import from `'../storage/supabaseAdapter'` and made `getStuck` a proper `async` function with `await` on all async calls (`getAllRequests`, `findUserById`).

---

### Bug 3 — CRITICAL: `aiController.js` imported from non-existent `localAdapter`

**File:** `server/controllers/aiController.js`  
**Severity:** Critical — `GET /api/ai/workload-summary` would throw `MODULE_NOT_FOUND` at runtime; `getAllRequests` and `getAllUsers` were called synchronously (no `await`)

**Root cause:** Same as Bug 2 — the controller imported from `'../storage/localAdapter'` instead of `'../storage/supabaseAdapter'`. Inside `workloadSummary`, the calls `getAllRequests(...)` and `getAllUsers(...)` were not awaited, so `tickets` and `designers` would be unresolved Promises passed to `ai.generateWorkloadSummary`.

**Fix:** Rewrote the file to import from `'../storage/supabaseAdapter'` and used `await Promise.all([...])` to fetch both datasets concurrently before passing them to the AI service.

---

### Bug 4 — Unhandled errors in `removeChild` and `remove` (requestController.js)

**File:** `server/controllers/requestController.js`, `removeChild` (line ~282) and `remove` (line ~297)  
**Severity:** High — a Supabase delete error would throw an unhandled Promise rejection, causing the server to hang (no HTTP response sent to client) or crash in older Node versions

**Root cause:** Both `deleteSubtask` and `deleteRequest` throw on Supabase errors (intentional — they use `throw error`). The calling handlers had no `try/catch`, so a DB error would propagate as an unhandled rejection with no response sent.

**Fix:** Wrapped each delete call in a `try/catch` that logs the error and returns a `500` JSON response:
```js
try {
  await deleteSubtask(req.params.id, req.params.childId);
} catch (err) {
  console.error('[removeChild] deleteSubtask failed:', err.message);
  return res.status(500).json({ success: false, error: 'Failed to delete sub-task' });
}
```
Same pattern applied to `remove` / `deleteRequest`.

---

### Bug 5 — Incorrect SP calculation after last subtask deleted (supabaseAdapter.js)

**File:** `server/storage/supabaseAdapter.js`, `deleteSubtask` function (line ~712)  
**Severity:** Medium — when the last subtask of a ticket was deleted, the parent ticket's `story_points` was set to `0` instead of `null`

**Root cause:** The `totalSP` reduce always ran regardless of whether any children remained, so an empty array produced `0`. Elsewhere in the codebase (e.g., `updateChildIssue`, `createRequest`) the convention is `null` when no SP is defined.

**Fix:** Added the same guard used in `updateChildIssue`:
```js
// Before (always reduces, returns 0 on empty array)
const totalSP = children.reduce((s, c) => s + (c.storyPoints || 0), 0);

// After (null when no children or no children have SP)
const totalSP = children.length && children.some(c => c.storyPoints != null)
  ? children.reduce((s, c) => s + (c.storyPoints || 0), 0)
  : null;
```

---

## Files Unchanged — No Bugs Found

| File | Notes |
|------|-------|
| `api/index.js` | Correct Vercel entry point — no issues |
| `server/app.js` | CORS, routing, static files all correct |
| `server/middleware/authenticate.js` | JWT verify, DB merge, error handling all correct |
| `server/routes/requests.js` | All 9 routes registered correctly including DELETE endpoints |
| `server/routes/auth.js` | Login, register, leads, me — all correct |
| `server/routes/users.js` | Leads, transfer, capacity — all correct |
| `server/routes/notifications.js` | Correct (controller fixed separately) |
| `server/routes/ai.js` | Correct (controller fixed separately) |
| `server/routes/forms.js` | Static config serving — correct |
| `server/storage/supabaseClient.js` | Client creation with env guard — correct |
| `server/storage/supabaseAdapter.js` | All DB logic correct after Bug 5 fix; cascade order in `deleteRequest` is correct (subtask_comments → subtask_status_history → subtasks → ticket_comments → ticket_status_history → tickets); `createUser` columns match schema; `assigned_to_snapshot` correctly stores full snapshot object |
| `server/controllers/userController.js` | transferDesigner, updateCapacity — all correct |
| `server/controllers/requestController.js` | All handlers correct after Bug 4 fix; status transition guards, access checks, and async flows are all correct |

---

## Summary

| # | Severity | File | Description |
|---|----------|------|-------------|
| 1 | Critical | authController.js | Missing `await` on `createUser` — registration returned a broken token |
| 2 | Critical | notificationController.js | Wrong adapter import (`localAdapter` → `supabaseAdapter`); `getStuck` was synchronous |
| 3 | Critical | aiController.js | Wrong adapter import (`localAdapter` → `supabaseAdapter`); `getAllRequests`/`getAllUsers` not awaited |
| 4 | High | requestController.js | No `try/catch` on delete operations — DB errors caused unhandled rejections |
| 5 | Medium | supabaseAdapter.js | `deleteSubtask` set `story_points` to `0` instead of `null` when last subtask removed |

**Verification:** `node -e "require('./server/app')"` exits cleanly after all fixes.
