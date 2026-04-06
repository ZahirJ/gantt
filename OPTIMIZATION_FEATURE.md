# Task Optimization Feature

## Overview

The **⚡ Optimize** button redistributes tasks across team members to minimise the project end date. It respects Finish-to-Start dependencies, keeps each test task paired with the task it depends on, and uses the real scheduling engine (calendar dates, holidays, vacations) when comparing finish dates.

---

## When it runs

| Condition | Behaviour |
|---|---|
| Any resource has **no assigned tasks** | Full redistribution — assigns every task from scratch, then levels |
| All resources already have tasks | Leveling only — rebalances without reassigning everything |

---

## Algorithm

### Step 1 — Build units (always)

Tasks are grouped into **units** before any assignment is made:

- A **unit** = one non-test task + all test tasks that directly depend on it.
- Test tasks (description matches `Add test(s)…`) are permanently paired with their lead task and always move together.
- Units are ordered by their lead task's Serial Number.

### Step 2 — Initial assignment (empty-resource path only)

Units are assigned **round-robin** across all resources in Serial Number order:

```
Unit 1 → Alice
Unit 2 → Bob
Unit 3 → Carol
Unit 4 → Alice
…
```

### Step 3 — Leveling loop (always)

Repeat until stable:

1. Compute each resource's finish date using the full scheduling engine.
2. Find the **maximum** finish date across all resources.
3. Walk resources in order:
   - If a resource's finish date equals the maximum → skip.
   - If a resource's finish date is **more than 5 working days** behind the maximum → take the **first unit** (lowest Serial Number) from the most-loaded resource and reassign it to this resource.
   - Restart the walk from step 1.
4. Stop when no resource is more than 5 working days behind the maximum, or no moves are possible.

---

## Rules

- **Test tasks never move alone** — they always travel with the task they depend on.
- **All tasks are eligible** — there is no category restriction.
- **Dependencies are respected** — the scheduling engine enforces Finish-to-Start; a task waits for its dependency regardless of who it is assigned to.
- **Undo** — a single click restores the assignments that existed before Optimize was clicked.

---

## Example

**Before (single resource):**
```
Alice: Implement GET (5d) → Add tests for GET (3d) → Implement PUT (5d) → Add tests for PUT (3d)
Bob:   (no tasks)
```

**After Optimize:**
```
Alice: Implement GET (5d) → Add tests for GET (3d)
Bob:   Implement PUT (5d) → Add tests for PUT (3d)
```

`Implement PUT` and `Add tests for PUT` move together as one unit.

---

## UI Controls

| Button | Location | Action |
|---|---|---|
| ⚡ Optimize | Top bar | Runs the algorithm |
| ↶ Undo Optimize | Top bar (appears after optimizing) | Restores previous assignments |

---

## Constraints summary

| Constraint | Enforced |
|---|---|
| Test task stays with its lead task | Yes — units always move together |
| Finish-to-Start dependencies | Yes — scheduling engine handles wait time |
| 5-working-day leveling threshold | Yes — uses real calendar days |
| Holidays & vacation | Yes — scheduling engine accounts for them |
