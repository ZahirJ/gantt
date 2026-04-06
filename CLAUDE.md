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

This is a single-page React app with **no backend, no routing, and no external state management**. The entire application lives in two source files:

- `src/App.jsx` — all UI, scheduling engine, import/export, drag-and-drop, and theme logic in one file
- `src/utils/optimize.js` — standalone optimization module (greedy task reassignment to minimize project finish date)

### Key data flows in App.jsx

**State**: React `useState` holds tasks, assignments (`taskId → assigneeName`), resources, holidays, vacations, progress, theme, and active tab.

**Scheduling engine** (`buildSchedule` / `scheduleTask` inside App.jsx): Produces computed start/end dates for each task. Runs purely in memory via `useMemo` on every render. Respects:
- 5-day work weeks, skipping weekends
- Global public holidays
- Per-person vacation days
- Finish-to-Start dependencies (by Serial Number)
- One task per person at a time (no parallel splitting)
- Serial Number ordering as a tiebreaker

**Import path**: `parseFile` reads `.xlsx`/`.xls`/`.csv` via SheetJS. Detects session files by checking for both `Session` and `Schedule` sheet names. Task files go through `normalizeTasks` which normalizes column names and applies complexity→days fallback (`S=1, M=3, L=5, XL=10`).

**Export path**: SheetJS writes three sheets — `Schedule` (task rows with dates), `Session` (key-value state dump), `Workload` (per-person summary). Session files can be re-imported to fully restore state.

**Optimization** (`src/utils/optimize.js`): Only moves tasks whose `description` starts with `Add test` or `Add tests` (case-insensitive). Uses a greedy local-search loop: for each movable task, try every team member and keep the assignment that gives the lowest `computeFinish`. Rejects assignments that create resource idle gaps. Saves previous assignments to `undoHistory` stack before mutating.

### Test task identification

Both `App.jsx` and `optimize.js` use the same regex to identify test tasks:
```js
/^add tests?\b/i.test(description.trim())
```
Tasks matching this pattern get a distinct color and TEST badge in the Gantt view, and are the only tasks eligible for optimization reassignment.

### Tabs

The app has four main views toggled by a `tab` state variable: `gantt`, `workload`, `settings`, and a hidden import screen shown when no tasks are loaded.
