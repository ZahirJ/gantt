# Task Optimization Feature

## Overview

The **⚡ Optimize** button redistributes tasks across team members to minimise the project end date. It respects Finish-to-Start dependencies, keeps each test task paired with the task it depends on, and uses the real scheduling engine (calendar dates, holidays, vacations) when comparing finish dates.

---

## What counts as a test task

Any task whose description starts with **Add test** or **Add tests** (case-insensitive) is treated as a test task — for both the pairing rule and the purple visual highlight.

Examples: `Add test for GET blob`, `Add tests for listing buckets`

---

## What counts as a completed task

Tasks with **Status = Completed** or **progress = 100%** are treated as completed. Completed tasks:
- Are **never moved** by the optimizer — their assignments are locked
- Are **filtered out on import** — they do not appear in the Gantt or affect scheduling

---

## When it runs

| Condition | Behaviour |
|---|---|
| Any resource has **no assigned tasks** | Assigns all tasks from scratch (priority round-robin), then runs the makespan search |
| All resources already have tasks | Runs the makespan search only — no initial redistribution |

---

## Algorithm

### Step 1 — Build units (always)

Before any assignment changes are made, tasks are grouped into **units**:

- A **unit** = one non-test task + all test tasks that directly depend on it.
- Test tasks are permanently paired with their lead task and always move together as one unit — a test task is never reassigned without its lead.
- **Units that contain any completed task are excluded** — completed tasks are locked in place and their units are never moved.

### Step 2 — Priority ordering (always)

Units are ranked before allocation using two criteria:

1. **Topological depth** (ascending) — tasks with no dependencies (depth 0) come first, because they can start on day 1 and unblock everything downstream.
2. **Transitive dependent count** (descending) — among tasks at the same depth, tasks that more other tasks depend on (directly or transitively) are ranked higher, because assigning them earlier unblocks the most work.

```
Example ranking for 4 units:
  SN1 – depth 0, 8 tasks depend on it  → rank 1  (most critical)
  SN3 – depth 0, 3 tasks depend on it  → rank 2
  SN5 – depth 1, 2 tasks depend on it  → rank 3
  SN7 – depth 2, 0 tasks depend on it  → rank 4  (least critical)
```

### Step 3 — Initial assignment (empty-resource path only)

When at least one resource has no tasks, all movable units are assigned **round-robin** in priority order:

```
Rank 1 unit (SN1 + its tests) → Alice
Rank 2 unit (SN3 + its tests) → Bob
Rank 3 unit (SN5 + its tests) → Carol
Rank 4 unit (SN7 + its tests) → Alice
…
```

This ensures the most critical tasks start as early as possible across different team members, giving the makespan search the best possible starting point.

### Step 4 — Makespan search (always)

The makespan search minimises the overall project finish date by trying every possible single-unit move each iteration:

1. Compute each resource's predicted finish date using the full scheduling engine.
2. Find the **latest** finish date (the bottleneck resource).
3. Try **every movable unit** currently assigned to the bottleneck resource against **every other resource**.
4. Apply the move that gives the **lowest new overall finish date**.
5. Repeat from step 1 until no move reduces the finish date.

This is a greedy local search over makespan — it always picks the globally best single move available, rather than a heuristic like "first unit" or "first underloaded resource".

---

## Example

### Empty resource (full redistribution + makespan search)

**Before:** Bob just joined the team with no tasks assigned.
```
Alice: SN1-Implement GET (5d), SN2-Add tests for GET (3d),
       SN3-Implement PUT (5d), SN4-Add tests for PUT (3d)  → finishes day 16
Bob:   (no tasks)                                          → finishes day 0
```

**After Step 3 (priority round-robin):**
- SN1 has 1 dependent (SN2), SN3 has 1 dependent (SN4) — both depth 0, similar priority
```
Alice: SN1-Implement GET (5d) + SN2-Add tests for GET (3d) → finishes day 8
Bob:   SN3-Implement PUT (5d) + SN4-Add tests for PUT (3d) → finishes day 8
```

**After Step 4 (makespan search):** Both finish on day 8 — no move can improve this.

---

### Leveling only (all resources already have tasks)

**Before:**
```
Alice: 10 tasks → finishes 2026-06-30
Bob:   2 tasks  → finishes 2026-05-10
```

The makespan search tries every unit on Alice against Bob (and vice versa), picks the move that gives the lowest new max finish date, and repeats until no further improvement is possible.

---

## UI Controls

| Button | Location | Action |
|---|---|---|
| ⚡ Optimize | Top bar | Runs the algorithm |
| ↶ Undo Optimize | Top bar (appears after optimizing) | Restores previous assignments |

---

## Visual highlighting

Test tasks are highlighted in purple throughout the app:

| View | Highlight |
|---|---|
| Gantt chart | Purple bar + **TEST** badge |
| Workload tab | Purple border, purple background tint, **TEST** badge |

---

## Constraints summary

| Constraint | Enforced |
|---|---|
| Test task stays with its lead task | Yes — units always move together |
| Completed tasks never move | Yes — any unit containing a completed task is excluded |
| Completed tasks excluded on import | Yes — filtered before any state is set |
| Finish-to-Start dependencies | Yes — scheduling engine handles wait time |
| Critical tasks assigned first | Yes — priority ordering by depth + transitive dependent count |
| Holidays & vacation | Yes — scheduling engine accounts for them |
