# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Dev server at http://localhost:3000
npm test           # Run all tests (watch mode)
npm test -- --watchAll=false   # Run tests once (CI mode)
npm test -- --testPathPattern=optimize   # Run a specific test file
npm run build      # Production build
```

## Architecture

This is a single-page React app with **no backend, no routing, and no external state management**. Source files:

- `src/App.jsx` — all UI, import/export, drag-and-drop, and theme logic
- `src/utils/scheduleUtils.js` — pure scheduling helpers (`scheduleTasks`, `isWorkday`, etc.) and the `levelOptimize` function; imported by both App.jsx and tests
- `src/utils/optimize.js` — legacy standalone optimizer (greedy local-search); kept for its test suite

### Key data flows in App.jsx

**State**: React `useState` holds tasks, assignments (`taskId → assigneeName`), resources, holidays, vacations, progress (% per task), taskStatuses (status label per task), theme, and active tab.

**Scheduling engine** (`scheduleTasks` in `scheduleUtils.js`): Produces computed start/end dates for each task. Called via `useMemo` on every render. Respects:
- 5-day work weeks, skipping weekends
- Global public holidays
- Per-person vacation days
- Finish-to-Start dependencies (by Serial Number)
- One task per person at a time (no parallel splitting)
- Serial Number ordering as a tiebreaker

**Import path**: `parseFile` reads `.xlsx`/`.xls`/`.csv` via SheetJS (`raw: false`). Detects session files by checking for both `Session` and `Schedule` sheet names. Task files go through `normalizeTasks` which normalizes column names (including case-insensitive "Depends on/On"), filters self-referencing deps, and applies complexity→days fallback (`S=1, M=3, L=5, XL=10`).

**Export path**: SheetJS writes three sheets — `Schedule` (task rows with dates and progress), `Session` (key-value state dump including statuses), `Workload` (per-person summary). Session files can be re-imported to fully restore state.

**Optimization** (`levelOptimize` in `scheduleUtils.js`): Balances workload across resources by moving task units (lead + test dependents) from overloaded to underloaded resources. Completed tasks (progress = 100 / status = "Completed") are never moved. Saves previous assignments to `undoHistory` stack before mutating.

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

### Tabs

The app has four main views toggled by a `tab` state variable: `gantt`, `workload`, `settings`, and a hidden import screen shown when no tasks are loaded.
