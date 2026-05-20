# Creative Management App — Change Log

**Date:** 2026-05-20  
**Scope:** Full feature overhaul — role-based POVs, new status workflow, assignment, comments, archiving.

---

## 1. New Role System (3 POVs)

### Roles

| Role | Key | Description |
|---|---|---|
| Requester | `requester` | Submits creative requests, comments on own tickets, tracks status |
| Creative Designer | `creative_designer` | Sees only assigned tickets, updates status, comments, manages sub-tasks |
| Creative Lead | `creative_lead` | Sees all team tickets (filtered by project), assigns designers, approves/rejects |
| Admin | `admin` | Full access (legacy role, kept for backwards compatibility) |

### Files changed
- `server/data/users.json` — existing admin updated with `projects` + `department` fields  
- `server/storage/localAdapter.js` — `seedDefaultUsers()` runs at startup; creates seed accounts if absent  
- `server/controllers/authController.js` — JWT payload now includes `projects`, `department`, `leadId`  

### Default seed accounts (added automatically on first start)

| Email | Password | Role |
|---|---|---|
| admin@company.com | Admin123! | Admin |
| andhika@company.com | Lead123! | Creative Lead (Social Media & Digital Marketing) |
| designer1@company.com | Design123! | Creative Designer (Andhika's team) |
| designer2@company.com | Design123! | Creative Designer (Andhika's team) |
| requester@company.com | Request123! | Requester |

---

## 2. User Registration

- New page: `client/register.html` at route `/register`
- New API endpoint: `POST /api/auth/register`
- Login page now shows a "Create an account" link
- Self-registration is limited to `requester`, `creative_designer`, `creative_lead` roles (no admin self-registration)
- Admin must manually assign `projects`, `leadId`, and `department` fields to newly registered designers/leads (future: admin UI)

---

## 3. Status Workflow

Tickets follow a linear/branching flow. Statuses replace the old `pending / in_progress / completed`.

```
requested
  └─► in_progress      (designer starts work)
        └─► on_review  (designer submits for review)
              ├─► need_revision  (lead requests changes)
              │       └─► revision  (designer starts revision)
              │                 └─► revised
              │                       ├─► need_revision  (more changes needed)
              │                       └─► approved ✓
              └─► approved ✓
```

### Who can change to what

| From | To | Who |
|---|---|---|
| requested | in_progress | Designer |
| in_progress | on_review | Designer |
| need_revision | revision | Designer |
| revision | revised | Designer |
| on_review | need_revision, approved | Lead |
| revised | need_revision, approved | Lead |

### Files changed
- `server/controllers/requestController.js` — `canDesignerTransition()`, `canLeadTransition()` enforcement  
- `server/data/requests.json` — existing request migrated to `status: "requested"`  
- `client/js/dashboard.js` — `DESIGNER_NEXT`, `LEAD_NEXT` maps drive UI buttons  
- `client/css/main.css` — new `.status-*` badge colours  

---

## 4. Ticket Assignment

- All new tickets start with `assignedTo: null` (unassigned)
- Creative Lead assigns a ticket to a designer from **their team** via a dropdown in the dashboard or ticket modal
- Only designers with `leadId` matching the lead's `id` appear in the dropdown (`GET /api/requests/team-members`)
- Lead can unassign a ticket (sets `assignedTo: null`)
- Unassigned tickets are highlighted with a warning banner on the lead dashboard

### Files changed
- `server/storage/localAdapter.js` — `assignedTo` field on new requests  
- `server/controllers/requestController.js` — `update()` enforces lead-only assignment  
- `server/routes/requests.js` — `GET /api/requests/team-members` route  

---

## 5. Ticket Visibility Rules

| Role | Sees |
|---|---|
| Requester | Only tickets they submitted (including approved) |
| Creative Designer | Only tickets assigned to them (approved excluded from default list) |
| Creative Lead | All tickets in their projects (approved excluded from default list) |
| Admin | All tickets |

### Files changed
- `server/controllers/requestController.js` — `buildFilters()`, `checkAccess()` per role  

---

## 6. Archiving (Approved Tickets)

- Tickets with `status: "approved"` are **excluded** from the default board/list view
- Requesters are the exception — they see all their tickets including approved (for tracking)
- Auto-archive: when **all child issues** of a ticket are approved, the parent ticket is automatically set to `approved`

### Files changed
- `server/storage/localAdapter.js` — `getAllRequests()` filters `status !== 'approved'` unless `includeApproved` flag is set; `updateChildIssue()` triggers auto-approve  

---

## 7. Comments / Discussion

- Any user with access to a ticket can post comments
- Comments are stored inside each ticket object in `requests.json`
- The ticket detail modal has a scrollable Discussion section with a text input

### New API
- `POST /api/requests/:id/comments` — body: `{ text: "..." }`

### Files changed
- `server/storage/localAdapter.js` — `addComment()` function  
- `server/controllers/requestController.js` — `postComment()` handler  
- `server/routes/requests.js` — new route  
- `client/js/dashboard.js` — `postComment()` action + comment rendering  

---

## 8. Child Issue Status & Auto-Approve

- Each child issue (sub-task) now has its own `status` field (same 7-step workflow)
- Child status can be changed inline on the ticket list or inside the ticket modal
- When **all children reach `approved`**, the parent ticket is automatically set to `approved`

### New API
- `PUT /api/requests/:id/children/:childId` — body: `{ status: "..." }`

### Files changed
- `server/storage/localAdapter.js` — `createRequest()` stamps child IDs + `status: "requested"`; `updateChildIssue()` auto-approves parent  
- `server/controllers/requestController.js` — `updateChild()` handler  
- `server/routes/requests.js` — new route  
- `server/data/requests.json` — existing child issues migrated with `id` and `status` fields  

---

## 9. Dashboard UI — Ticket Bubble / List View

Replaced the old Jira-style Kanban board with a flat **bubble list** per role.

### Requester View
- Stat bar: Total / Pending / Active / Approved  
- Clickable ticket rows showing title, project, priority, deadline, status badge  
- Clicking a ticket opens the detail modal (read-only status, comment allowed)

### Designer View
- Stat bar: Active Tickets / In Progress / Needs Attention  
- Ticket bubbles with an expand arrow (▶/▼) to show child sub-tasks inline  
- "Move to:" action buttons per allowed transition  
- Child status dropdown inline per sub-task  
- "Details" button opens full modal

### Lead View
- Stat bar: Total / Unassigned / In Progress / Needs Review  
- Warning banner when unassigned tickets exist  
- Filter bar: by project, status, assignee  
- Assign-to dropdown per ticket  
- "Move to:" action buttons  
- Expand arrow for child sub-tasks with approval progress count  

### Files changed
- `client/dashboard.html` — complete rewrite with modal overlay  
- `client/js/dashboard.js` — complete rewrite (`renderRequesterView`, `renderDesignerView`, `renderLeadView`)  
- `client/css/main.css` — new ticket bubble, child-item, modal, comment, role-chip, status-badge, assign-row classes  

---

## 10. Form Access Guard

- `client/form.html` now redirects `creative_designer` and `creative_lead` users back to the dashboard on page load  
- Only `requester` and `admin` can submit new requests  

---

## File Summary

| File | Change |
|---|---|
| `server/app.js` | Added `/register` route |
| `server/storage/localAdapter.js` | New: user CRUD, comments, child-issue updates, auto-approve, seed |
| `server/controllers/authController.js` | New: `register()`, enriched JWT payload |
| `server/controllers/requestController.js` | New: role filtering, status enforcement, assignment, comments, child update |
| `server/routes/auth.js` | Added `POST /register` |
| `server/routes/requests.js` | Added `/team-members`, `/:id/comments`, `/:id/children/:childId` |
| `server/data/users.json` | Admin record updated with `projects`/`department`; seed users added at startup |
| `server/data/requests.json` | Existing ticket migrated to new status + child-issue format |
| `client/login.html` | Added "Create an account" link |
| `client/register.html` | New registration page |
| `client/dashboard.html` | Complete rewrite — role-aware layout + ticket modal |
| `client/js/dashboard.js` | Complete rewrite — 3-POV rendering engine |
| `client/css/main.css` | ~200 lines added: bubbles, modal, comments, role chips, status badges |
| `client/form.html` | Role guard: designers/leads redirected to dashboard |
