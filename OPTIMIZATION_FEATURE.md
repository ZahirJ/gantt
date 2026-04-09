# Task Optimization Feature

## Overview

The **⚡ Optimize** button redistributes tasks across team members to minimise the project end date. It respects Finish-to-Start dependencies, keeps each test task paired with the task it depends on, and uses the real scheduling engine (calendar dates, holidays, vacations) when comparing finish dates.

---

## What counts as a test task

Any task whose description contains the word **test** or **testing** (case-insensitive, whole word) is treated as a test task — for both the pairing rule and the purple visual highlight.

Examples: `Add test for GET blob`, `Add tests for listing buckets`, `Testing login flow`

---

## When it runs

| Condition | Behaviour |
|---|---|
| Any resource has **no assigned tasks** | Assigns all tasks from scratch (round-robin), then runs the leveling loop |
| All resources already have tasks | Runs the leveling loop only — no initial redistribution |

---

## Algorithm

### Step 1 — Build units (always)

Before any assignment changes are made, tasks are grouped into **units**:

- A **unit** = one non-test task + all test tasks that directly depend on it.
- Test tasks are permanently paired with their lead task and always move together as one unit — a test task is never reassigned without its lead.
- Units are ordered by their lead task's Serial Number.
- **Units that contain any completed task are excluded** — completed tasks are locked in place and their units are never moved.

### Step 2 — Initial assignment (empty-resource path only)

When at least one resource has no tasks, all units are assigned **round-robin** in Serial Number order:

```
Unit 1 (SN 1 + its tests) → Alice
Unit 2 (SN 2 + its tests) → Bob
Unit 3 (SN 3 + its tests) → Carol
Unit 4 (SN 4 + its tests) → Alice
…
```

### Step 3 — Leveling loop (always)

The leveling loop balances workload by moving tasks from overloaded resources to underloaded ones. It repeats until the team is balanced or no further moves are possible:

1. Compute each resource's predicted finish date using the full scheduling engine (respecting dependencies, holidays, and vacation days).
2. Find the **latest** finish date across all resources.
3. Walk through resources in order:
   - If a resource finishes on the latest date → skip (they are the bottleneck, don't take from them yet).
   - If a resource finishes **more than 5 working days before** the latest date → they have capacity. Take the **first unit** (lowest Serial Number) from the most-loaded resource and reassign it to them. Restart from step 1.
4. Stop when every resource finishes within 5 working days of the latest finish date, or no moves are possible.

The 5-day threshold prevents unnecessary reshuffling when the imbalance is small.

---

## Example

### Empty resource (full redistribution + leveling)

**Before:** Bob just joined the team with no tasks assigned.
```
Alice: SN1-Implement GET (5d), SN2-Add tests for GET (3d),
       SN3-Implement PUT (5d), SN4-Add tests for PUT (3d)  → finishes day 16
Bob:   (no tasks)                                          → finishes day 0
```

**After Step 2 (round-robin):**
```
Alice: SN1-Implement GET (5d), SN3-Implement PUT (5d)      → finishes day 10
Bob:   SN2-Add tests for GET (3d), SN4-Add tests for PUT (3d) → finishes day 8
```
Note: `SN2` moves with `SN1` as a unit, `SN4` moves with `SN3` as a unit.

**After Step 3 (leveling):** Alice and Bob are within 5 days — no further moves needed.

---

### Leveling only (all resources already have tasks)

**Before:**
```
Alice: 10 tasks → finishes 2026-06-30
Bob:   2 tasks  → finishes 2026-05-10   (37 working days behind Alice)
```

Bob is more than 5 working days behind Alice. The leveling loop takes the first unit from Alice and gives it to Bob. This repeats until the gap closes to ≤ 5 working days.

---

## UI Controls

| Button | Location | Action |
|---|---|---|
| ⚡ Optimize | Top bar | Runs the algorithm |
| ↶ Undo Optimize | Top bar (appears after optimizing) | Restores previous assignments |

---

## Visual highlighting

Test tasks (description contains `test` or `testing`) are highlighted in purple throughout the app:

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
| Finish-to-Start dependencies | Yes — scheduling engine handles wait time |
| 5-working-day leveling threshold | Yes — uses real calendar days |
| Holidays & vacation | Yes — scheduling engine accounts for them |
