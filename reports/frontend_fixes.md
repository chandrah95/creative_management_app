# Frontend Audit & Fixes Report

**Date:** 2026-05-25  
**Scope:** `client/` directory only  
**Files modified:** `client/js/dashboard.js`, `client/js/form.js`

---

## Bugs Found and Fixed

### 1. CRITICAL — `canDelete` used before declaration in `buildModalContent` (dashboard.js)

**Location:** `buildModalContent()` function  
**Severity:** Critical — caused a JavaScript `ReferenceError` (temporal dead zone violation)

`canDelete` was declared at the end of `buildModalContent` (after the `commentsHtml` block, line ~1962), but was referenced on line ~1885 inside the `childSection` template literal, which was built much earlier in the function. Because `const` declarations are not hoisted (temporal dead zone), accessing `canDelete` before its declaration throws a `ReferenceError` at runtime.

**Effect:** The subtask delete button in the modal (for `creative_lead` and `admin` roles) never rendered — the entire `buildModalContent` call would throw, breaking the modal for any ticket with sub-tasks.

**Fix:** Moved the `const canDelete = role === 'admin' || role === 'creative_lead'` declaration to immediately after the `role`/`status` constants at the top of the function, removed the duplicate declaration.

---

### 2. MEDIUM — Unsafe `onclick` string escaping in delete buttons (dashboard.js)

**Location:** Three places:
- `leadBubble()` — ticket delete button
- `buildModalContent()` — modal header ticket delete button
- `buildModalContent()` — subtask delete button inside `childSection`

**Pattern:** `'${escHtml(title).replace(/'/g,"\\'")}')` was used to pass a title string into an inline `onclick` attribute.

**Problem:** `escHtml()` handles `&`, `<`, `>`, `"` but not backslashes. If a ticket title contains a backslash (e.g. `C:\folder\file`), the resulting onclick string becomes malformed JavaScript and throws a `SyntaxError`. Additionally, sequences like `\'` (escaped-quote) in titles would also produce malformed JS.

**Fix:** Replaced all three instances with `JSON.stringify(title)` / `JSON.stringify(childLabel(c))`. `JSON.stringify` produces a fully valid, properly escaped JavaScript string literal for any string value (handles `\`, `'`, `"`, newlines, control chars, etc.), making the onclick attributes robust against any title content.

---

### 3. LOW — Delete button missing `flex-shrink:0` in modal sub-task row (dashboard.js)

**Location:** Subtask delete button inline style in `buildModalContent()`

**Problem:** `.modal-child-main` is a flex container with `flex-wrap: wrap`. Without `flex-shrink:0`, the delete button could be compressed on narrow containers, making it difficult to click.

**Fix:** Added `flex-shrink:0` to the inline style of the subtask delete button (alongside the existing `margin-left:auto`).

---

### 4. LOW — XSS via user-typed input in `renderMultitextTags` (form.js)

**Location:** `renderMultitextTags()` in `client/js/form.js`

**Problem:** The `item` variable (user-typed text) was interpolated directly into `innerHTML` without HTML-escaping:
```js
tagsWrap.innerHTML = items.map((item, i) => `<span class="multitext-tag">${item}...`
```
A user could type `<img src=x onerror=alert(1)>` into a multi-text input field and have it executed as HTML.

**Fix:** Added a local `escHtml()` helper function to `form.js` (matching the one in `dashboard.js`) and applied it to `item` when rendering tags.

---

## Areas Verified (No Bugs Found)

| Area | Status |
|---|---|
| `api.js` — `delete` method | Correct: no body, `'DELETE'` method string |
| `dashboard.js` — `escHtml` function | Correct: handles `&`, `<`, `>`, `"` — all critical HTML vectors |
| `dashboard.js` — `requesterBubble` | Correct: no delete button present |
| `dashboard.js` — `applyCrossFilter` status logic | Correct: checks child statuses for tickets with children, consistent with `donutBarSubset` and `updateStatusChartData` |
| `dashboard.js` — `loadNotifications` | Exists and is called on init and after each render |
| `dashboard.js` — `notifBellHtml` | Exists, generates correct markup with bell icon, badge, and panel |
| `dashboard.js` — `closeNotifPanel` | Exists, properly sets `display:none` and `aria-expanded` |
| CSS — `.btn-delete` | Defined in `main.css` with correct styling; works with `.btn-sm` |
| CSS — `.modal-child-main` | Is `display:flex`, allowing `margin-left:auto` on delete button |
| HTML files — script/link references | All use correct `/js/` and `/css/` paths matching server static routing |
| `form.js` — ticket submission | Validates fields, collects values, handles child issues, disables submit during request |
| `ai-settings.js` — local `escHtml` | Defined locally, handles all critical HTML vectors |

---

## Summary

4 bugs fixed across 2 files:

- **1 critical** (`canDelete` TDZ — subtask delete button broke the entire modal for tickets with children)
- **1 medium** (unsafe onclick string escaping — breakable with backslash/quote in ticket title)
- **2 low** (delete button `flex-shrink` + XSS in multi-text input tags)
