# Team Gantt

A dynamic Gantt chart scheduler for software teams. Import your task spreadsheet, assign work to team members, and get an instant visual schedule with predicted finish dates — respecting working days, public holidays, and personal vacation time.

---

## Features

### 📊 Gantt Chart
- Task bars with computed start and end dates
- Dependency arrows (Finish-to-Start) rendered as curves
- Today marker line for at-a-glance progress context
- Color-coded bars by task status: Open, In Progress, Completed
- Per-task progress sliders (% complete) shown inline on bars
- Week and month zoom levels
- Filter tasks by category

### 👥 Resource Management
- Assign tasks to team members via dropdown in the Gantt view
- Add new resources in Settings — unassigned tasks auto-distribute using a load-balancing algorithm (fewest days first)
- Each person works on one task at a time (no parallel splitting)

### 📋 Workload Tab
- Per-person cards showing task list, total days, and predicted finish date
- Relative workload bar (green → yellow → red) for quick overload spotting
- **Drag and drop** tasks between worker cards to reassign
- **Right-click** any task for an "Assign To" context menu with all available workers, or unassign entirely
- All changes recalculate the Gantt instantly

### ⚙️ Scheduling Engine
- 5-day work weeks (Monday–Friday)
- Skips weekends automatically
- Configurable public holidays (global)
- Per-person vacation days
- Tasks scheduled by Serial Number order when multiple are ready to start
- Dependency-aware: a task won't start until all its dependencies are complete

### 🎨 Themes
- Dark mode and Light mode
- Toggle with the ☀️ / 🌙 button in the top bar or import screen

### 💾 Save & Restore Sessions
- **Save Session (XLSX)** exports a full snapshot of your work
- Restoring is as simple as re-importing the saved file — all assignments, progress, holidays, vacations, and resources are fully recovered
- No database or account required

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v14 or higher (v18 LTS recommended)

### Installation

```bash
npx create-react-app gantt
cd gantt
npm install xlsx
```

Replace `src/App.jsx` with `gantt-app.jsx`, then:

```bash
npm start
```

The app opens at `http://localhost:3000`.

---

## Importing Your Task File

The app accepts `.xlsx`, `.xls`, and `.csv` files. Drag and drop onto the import screen or click to browse.

### Expected Columns

| Column | Description |
|---|---|
| `Serial Number` | Unique task identifier — used for dependency references |
| `Category` | Task category (e.g. Backend, Frontend) — used for filtering |
| `Description` | Task name / description |
| `Depends On` | Comma-separated Serial Numbers this task depends on. Use `0` or leave blank for no dependencies |
| `Status` | `Open`, `In Progress`, or `Completed` |
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
| `Session` | Project start, theme, resources, holidays, vacation days, assignments, progress |
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
| 💾 Save Session (XLSX) | Full session snapshot — use this to save and continue later |
| Export CSV | Scheduled task list with dates — for use in other tools |
| Print / PDF | Prints the current view via the browser print dialog |

---

## Project Structure

```
src/
└── App.jsx        # Entire application — single self-contained file
```

All logic (scheduling engine, drag and drop, theme system, import/export) lives in `App.jsx`. No external state management or backend required.

---

## Tech Stack

- **React 18** — UI and state
- **SheetJS (xlsx)** — Excel and CSV import/export
- **HTML5 Drag and Drop API** — workload reordering
- **SVG** — Gantt bars, dependency arrows, grid
- No CSS framework, no external component library

---

## Known Limitations

- Dependency type is Finish-to-Start only (Start-to-Start and Finish-to-Finish not yet supported)
- Progress sliders in the Gantt view show the first 18 tasks only — scroll the Workload tab to see all
- No undo/redo — use Save Session frequently to preserve checkpoints
- Print/PDF exports the current browser view; for best results use the Gantt tab at month zoom

---

## License

MIT
