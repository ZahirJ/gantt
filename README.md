# Team Gantt

A dynamic Gantt chart scheduler for software teams. Import your task spreadsheet, assign work to team members, and get an instant visual schedule with predicted finish dates — respecting working days, public holidays, and personal vacation time.

---

## Features

### 📊 Gantt Chart
- Task bars with computed start and end dates
- Smooth curved dependency arrows (Finish-to-Start) rendered as SVG bezier curves
- Today marker line for at-a-glance progress context
- Color-coded bars by task status: Open, In Progress, Completed
- Per-task progress sliders (% complete) shown inline on bars
- Inline status selector per task — change status directly in the task list
- Completed tasks are visually locked: non-draggable, assignee disabled, skipped by optimizer
- Week and month zoom levels
- Filter tasks by category
- Test tasks are highlighted with a distinct color and TEST badge
- **Delete task** — click the `×` button on any row to remove a single task (confirmation required)
- **Delete all unassigned** — toolbar button removes every task with no assignee at once (visible only when unassigned tasks exist, confirmation required)

### 👥 Resource Management
- Assign tasks to team members via dropdown in the Gantt view
- Add new resources in Settings — unassigned tasks auto-distribute using a load-balancing algorithm (fewest days first)
- Each person works on one task at a time (no parallel splitting)

### 📋 Workload Tab
- Per-person cards showing task list, total days, and predicted finish date
- Relative workload bar (green → yellow → red) for quick overload spotting
- **Drag and drop** tasks between worker cards to reassign (completed tasks are locked)
- **Right-click** any task for a context menu to set status, reassign, or delete the task
- **Unassign all** button on each resource card — moves all of that person's tasks to Unassigned (confirmation required)
- **Unassigned card** — a dedicated card lists all tasks with no assignee; drag a task from it to any resource card to assign, or drop any task onto it to unassign; includes a **Delete all** action to remove all unassigned tasks at once
- Completed tasks show a **DONE** badge and cannot be dragged or reassigned
- All changes recalculate the Gantt instantly

### ⚙️ Scheduling Engine
- 5-day work weeks (Monday–Friday)
- Skips weekends automatically
- Configurable public holidays (global)
- Per-person vacation days
- Tasks scheduled by Serial Number order when multiple are ready to start
- Dependency-aware: a task won't start until all its dependencies are complete
- Optimization minimizes total project duration
- Optimization avoids resource idle gaps (contiguous work per resource)

### ⚡ Optimization
- The Optimize button redistributes tasks to balance workload and shorten the overall project finish date
- Tasks are grouped into **units** (a non-test task + all test tasks that depend on it) and always move together
- Units are allocated in **priority order**: tasks with no dependencies first, then tasks that the most other tasks depend on — critical-path work starts as early as possible
- The optimizer tries every possible unit move each iteration and picks whichever gives the lowest overall finish date (greedy makespan minimization)
- **Completed tasks are never moved** — their assignments are locked
- **Tasks with Status = Completed are excluded on import** — they do not appear in the Gantt
- Dependencies are respected; the full scheduling engine (calendar-aware) is used to compare outcomes
- Undo restores the pre-optimization assignments

### 🎨 Themes
- Dark mode and Light mode
- Toggle with the ☀️ / 🌙 button in the top bar or import screen

### 💾 Save & Restore Sessions
- **💾 Quick Save** — toolbar button available on every tab; writes directly back to the file you loaded or last saved without showing a dialog. On the very first save it opens a file picker and remembers the chosen path for all future Quick Saves. If the browser doesn't support the File System Access API it falls back to a triggered download
- **Save Session (XLSX)** (Settings tab) — same output as Quick Save; also stores the file handle so Quick Save targets it afterwards
- Restoring is as simple as re-importing the saved file — all assignments, progress, holidays, vacations, and resources are fully recovered
- No database or account required

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) **v18 or higher** (required by Vite 8)

### Installation

```bash
git clone https://github.com/ZahirJ/gantt.git
cd gantt
npm install
npm start
```

The app opens at `http://localhost:5173`.

---

## Importing Your Task File

The app accepts `.xlsx` and `.csv` files. Drag and drop onto the import screen or click to browse.

### Expected Columns

| Column | Description |
|---|---|
| `Serial Number` | Unique task identifier — used for dependency references |
| `Category` | Task category (e.g. Backend, Frontend) — used for filtering |
| `Description` | Task name / description |
| `Depends On` | Comma-separated Serial Numbers this task depends on. Use `0` or leave blank for no dependencies. Column name is case-insensitive (`Depends on` also accepted) |
| `Status` | `Open`, `In Progress`, `Completed`, or `Open(May not need fix)` |
| `Complexity` | T-shirt size: `S`, `M`, `L`, `XL` — used as a fallback if Days is empty |
| `Days` | Estimated working days |
| `Assignee` | Team member name — pre-populates assignments on import |
| `Integration Effort` | `Yes` / `No` — informational, not used in scheduling |

> **Note:** The `Serial Number` column supports Excel `=ROW()-1` style formulas — they are evaluated automatically on import.

### Dependency Format

Dependencies in `Depends On` are matched by Serial Number. Use comma or semicolon-separated values:

```
19
3,5
14;22;30
```

A value of `0` or an empty cell means no dependencies.

### Complexity → Days Fallback

If the `Days` column is empty, the app falls back to the `Complexity` column using these defaults:

| Size | Days |
|---|---|
| S | 1 |
| M | 3 |
| L | 5 |
| XL | 10 |

---

## Session Files

**Saving:** Go to **Settings → Export → Save Session (XLSX)**. This creates a `gantt_session.xlsx` with three sheets:

| Sheet | Contents |
|---|---|
| `Schedule` | All tasks with computed start/end dates, assignees, progress % |
| `Session` | Project start, theme, resources, holidays, vacation days, assignments, progress, task statuses |
| `Workload` | Per-person summary: tasks, total days, finish date |

**Restoring:** Drop the session file onto the import screen. The app automatically detects the Session sheet and restores your full state.

---

## Settings Reference

| Setting | Description |
|---|---|
| Project Start Date | The earliest possible start date for any task |
| Team Resources | Add or remove team members. Adding a new member triggers auto-rebalancing of unassigned tasks |
| Public Holidays | Dates skipped for all team members |
| Vacation Days | Per-person dates to skip during scheduling |

---

## Export Options

| Option | Description |
|---|---|
| 💾 Quick Save | Toolbar button on every tab — saves directly to the previously used file (no dialog). Shows a picker on first use and remembers the path. Falls back to a download if the File System Access API is unavailable |
| 💾 Save Session (XLSX) | Full session snapshot (Settings tab) — opens a save dialog; also registers the file for Quick Save |
| Export CSV | Scheduled task list with dates — for use in other tools |
| Print / PDF | Prints the current view via the browser print dialog |

---

## Project Structure

```
index.html                         # Vite entry point
src/
├── App.jsx                        # UI, import/export, drag-and-drop, theme
├── App.test.jsx                   # Smoke tests for the import screen
├── App.integration.test.jsx       # Integration tests for Gantt and Workload views
├── App.quicksave.test.jsx         # Integration tests for Quick Save (file handle, picker, fallback)
├── index.jsx                      # React root mount
├── setupTests.js                  # Vitest global setup
├── components/
│   ├── AddTaskModal.jsx           # Multi-step modal for creating a new task
│   ├── ConfirmDialog.jsx          # Reusable confirmation dialog for destructive actions
│   └── ConfirmDialog.test.jsx     # Unit tests for ConfirmDialog
└── utils/
    ├── scheduleUtils.js           # Pure scheduling helpers + levelOptimize (shared with tests)
    ├── taskMutations.js           # Pure helpers for task deletion and unassignment
    ├── taskMutations.test.js      # Unit tests for task mutation helpers
    ├── optimize.js                # Legacy greedy optimizer (kept for its test suite)
    ├── levelOptimize.test.js      # Optimizer tests using the Objectstore workplan fixture
    ├── optimize.test.js           # Unit tests for the legacy optimizer
    └── optimize.bench.test.js     # Performance / scale tests
vite.config.js                     # Vite build config
vitest.config.js                   # Vitest test config
```

No external state management or backend required.

---

## Tech Stack

### Runtime
| Library | Purpose |
|---|---|
| **React 19** | UI components and state management |
| **ExcelJS** | Excel (.xlsx) import and export |
| **HTML5 Drag and Drop API** | Task reordering in the Workload view |
| **SVG** | Gantt bars, dependency arrows, grid lines |

### Build & Dev tooling
| Tool | Purpose |
|---|---|
| **Vite 8** | Dev server and production bundler (requires Node ≥ 18) |
| **@vitejs/plugin-react** | JSX transform and React Fast Refresh |
| **Vitest** | Unit and integration test runner |
| **@testing-library/react** | React component test utilities |

No CSS framework, no external component library, no backend.

---

## Known Limitations

- Dependency type is Finish-to-Start only (Start-to-Start and Finish-to-Finish not yet supported)
- Progress sliders in the Gantt view show the first 18 tasks only — scroll the Workload tab to see all
- Undo is available for the Optimize action only; general undo/redo is not yet supported — use Save Session frequently to preserve checkpoints
- Print/PDF exports the current browser view; for best results use the Gantt tab at month zoom

---

## License

MIT
