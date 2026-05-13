# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Dev server at http://localhost:5173
npm stop           # Kill the dev server on port 5173
npm test           # Run all tests once (Vitest, CI mode)
npm run test:watch # Run tests in watch mode
npm test -- scheduleUtils   # Run a specific test file (partial name match)
npm run build      # Production build
```

## Architecture

This is a single-page React app with **no backend, no routing, and no external state management**. Source files:

- `src/App.jsx` — all UI, import/export, drag-and-drop, and theme logic
- `src/utils/scheduleUtils.js` — pure scheduling helpers (`fmtDate`, `scheduleTasks`, `isWorkday`, etc.) and the `levelOptimize` function; imported by both App.jsx and tests
- `src/utils/taskMutations.js` — pure helpers for task deletion and unassignment (`applyDeleteTask`, `applyDeleteAllUnassigned`, `applyUnassignAllForPerson`); take plain state objects and return new state objects without side effects
- `src/utils/optimize.js` — legacy standalone optimizer (greedy local-search); kept for its test suite
- `src/components/AddTaskModal.jsx` — multi-step modal for creating a new task
- `src/components/ConfirmDialog.jsx` — reusable confirmation dialog; accepts `message`, `confirmLabel` (default `"Delete"`), `onConfirm`, `onCancel`, and `C` (theme) props

### Key data flows in App.jsx

**State**: React `useState` holds tasks, assignments (`taskId → assigneeName`), resources, holidays, vacations, progress (% per task), taskStatuses (status label per task), theme, active tab, `confirmDialog` (pending confirmation action), `sessionFileHandle` (`FileSystemFileHandle | null`), `sessionFileName` (suggested filename for the save picker), and `saveStatus` (`null | 'saving' | 'saved'` — drives the Quick Save button feedback flash).

**Scheduling engine** (`scheduleTasks` in `scheduleUtils.js`): Produces computed start/end dates for each task. Called via `useMemo` on every render. Respects:
- 5-day work weeks, skipping weekends
- Global public holidays
- Per-person vacation days
- Finish-to-Start dependencies (by Serial Number)
- One task per person at a time (no parallel splitting)
- Serial Number ordering as a tiebreaker

**Import path**: `parseFile` reads `.xlsx`/`.csv` via ExcelJS (`wb.xlsx.load`). CSV is read via `FileReader` and parsed manually. Detects session files by checking for both `Session` and `Schedule` sheet names. Task files go through `normalizeTasks` which normalizes column names (including case-insensitive "Depends on/On"), filters self-referencing deps, and applies complexity→days fallback (`S=1, M=3, L=5, XL=10`).

**Export path**: `buildSessionBlob()` builds a `Blob` containing three ExcelJS sheets — `Schedule` (task rows with dates and progress), `Session` (key-value state dump including statuses and `PROJECT START`), `Workload` (per-person summary). Session files can be re-imported to fully restore state. A separate CSV export path (via Blob URL) writes only the scheduled task list.

**Quick Save** (`quickSave()` in App.jsx): writes the session blob directly to `sessionFileHandle` when one is stored and permission is granted; otherwise opens `window.showSaveFilePicker` (File System Access API) and stores the returned `FileSystemFileHandle` + its `name` as `sessionFileName`. Falls back to a triggered anchor download if the API is unavailable. `sessionFileName` is kept in sync with the chosen filename so subsequent saves and the picker's `suggestedName` always reflect the last saved path. `sessionFileHandle` is populated either from a session-file drag-drop (via `item.getAsFileSystemHandle()`) or after the first manual save via the picker. `exportXLSX()` (Settings tab) also uses `showSaveFilePicker` and stores the handle, so Quick Save works after a manual save too.

**Date formatting** (`fmtDate` in `scheduleUtils.js`): All dates are stored and compared as `YYYY-MM-DD` strings. Uses local date components (`getFullYear/getMonth/getDate`) rather than `toISOString()` to avoid UTC-offset shifts when converting Date objects returned by ExcelJS from date-typed cells.

**Optimization** (`levelOptimize` in `scheduleUtils.js`): Minimises the overall project finish date (makespan) by moving task units across resources. A **unit** = one non-test lead task + all test tasks that directly depend on it. Key behaviours:
- Tasks with Status = Completed are filtered out on file import (before any state is set)
- Units containing any completed task are excluded from all moves
- Initial round-robin (when any resource is empty) uses **priority order**: topological depth ascending, then transitive dependent count descending — tasks that unblock the most downstream work are assigned first
- Leveling loop: each iteration tries every movable unit on the most-loaded resource against every other resource, applies whichever move gives the lowest new overall finish date; stops when no move improves the result
- Saves previous assignments to `undoHistory` stack before mutating

### Task status

Tasks have four statuses: `Open`, `In Progress`, `Completed`, `Open(May not need fix)`. Status is tracked in `taskStatuses` state (separate from `progress` %) and kept in sync:
- Setting "Completed" → progress = 100, task locked (not draggable, not assignable, skipped by optimizer)
- Setting "In Progress" → progress = max(current, 10)
- Setting "Open" / other → progress = 0

Status can be changed via the inline `<select>` in the Gantt task list or via the right-click context menu in the Workload view.

### Test task identification

The regex used to identify test tasks:
```js
/^add tests?\b/i.test(description.trim())
```
Tasks matching this pattern get a distinct purple color and TEST badge in both views, and are the only tasks eligible for optimization reassignment.

### Dependency arrows

`getArrows()` in App.jsx computes Finish-to-Start arrows from `scheduledTasks`. Each arrow goes from the right edge of the dependency bar to the left edge of the dependent bar. Rendered as SVG cubic bezier curves in a separate overlay SVG (above bars, `zIndex: 2`).

### Task deletion

Three operations mutate task state together (`rawTasks`, `assignments`, `progress`, `taskStatuses`). The pure logic lives in `taskMutations.js`; the React wrappers in App.jsx call `applyDeleteTask` / `applyDeleteAllUnassigned` / `applyUnassignAllForPerson` and dispatch the results to their respective state setters.

All destructive actions go through `askConfirm(message, onConfirm, confirmLabel?)` which sets `confirmDialog` state and renders `<ConfirmDialog>`. The label defaults to `"Delete"` and is overridden to `"Unassign"` for unassignment actions.

Entry points:
- `×` button on each Gantt list row → delete single task
- Right-click context menu "Delete task" (Workload view) → delete single task
- Toolbar "✕ Unassigned" button → delete all unassigned tasks (visible only when unassigned tasks exist)
- Resource card "Unassign all" button → unassign all tasks for that person
- Unassigned card "Delete all" button → delete all unassigned tasks

### Unassigned card (Workload tab)

When unassigned tasks exist, an "Unassigned" card appears at the end of the resource grid with a dashed border. Tasks in it are draggable to any resource card to assign them. Any assigned task can be dragged onto the Unassigned card to unassign it ("Drop here to unassign" hint appears). The card has a "Delete all" button with confirmation.

### Tabs

The app has four main views toggled by a `tab` state variable: `gantt`, `workload`, `settings`, and a hidden import screen shown when no tasks are loaded.
