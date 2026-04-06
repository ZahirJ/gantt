# Task Optimization Feature Documentation

## Overview

The **Task Optimization** feature redistributes **test tasks** across team members to minimize the project end date while maintaining dependency constraints and avoiding idle gaps for each resource.

## How It Works

### Feature Behavior

1. **Identifies Redistributable Tasks**
   - A task is a **test task** if its `Description` starts with `Add test` or `Add tests` (case-insensitive)
   - Unassigned test tasks are eligible and may be assigned by the optimizer
   - Research tasks are NEVER moved (remain with original assignee)

2. **Calculates Current Workload**
   - Builds a dependency-aware schedule to estimate total project duration

3. **Optimizes Assignment**
   - Iteratively tests moving each test task to each resource
   - Accepts a move only if it shortens the overall finish date
   - Rejects any assignment that introduces idle gaps for a resource
   - Dependencies must be assigned and satisfied in the simulated schedule

4. **Saves State for Undo**
   - Before optimization runs, current assignments are saved
   - You can undo in a single click if not satisfied

## UI Controls

### Optimize Button (⚡ Optimize)
 - **Location:** Top bar (bright blue accent color)
 - **Tooltip:** "Optimize: Redistribute test tasks to minimize end date"
 - **Action:** Runs the optimization algorithm
 - **Result:** Assignments are updated, Gantt chart recalculates automatically

### Undo Button (↶ Undo)
 - **Location:** Top bar (yellow color)
 - **Visibility:** Only appears when there are changes to undo
 - **Tooltip:** "Undo last optimization"
 - **Action:** Reverts assignments to the previous state
 - **Note:** Undoing clears the history (can't redo after undo)

## Example Scenarios

### Scenario 1: Uneven Load Distribution

**Before Optimization:**
```
Alice (Developer): Task 1 (5 days) + Task 2 (3 days) = 8 days
Bob (Developer):   Task 3 (2 days) = 2 days
Carol (QA):        Task 4 (1 day) = 1 day
```

Task 2 is a test task (Description starts with "Add test"), originally assigned to Alice.

**After Optimization:**
```
Alice (Developer): Task 1 (5 days) = 5 days
Bob (Developer):   Task 3 (2 days) + Task 2 (3 days) = 5 days
Carol (QA):        Task 4 (1 day) = 1 day
```

Result: Better load balance, shorter project end date.

### Scenario 2: Protected Research Task

```
Alice (Researcher): Research Task (10 days) — NOT redistributed
Bob (Developer):    Dev Task (5 days) — May be redistributed
Carol (QA):         Test Task (3 days) — May be redistributed
```

Only tasks whose descriptions start with "Add test" are eligible for redistribution.

### Scenario 3: Dependency Constraints

```
Task A (Dev, assigned to Alice, 5 days)
  └─ Task B (Test, assigned to Bob, 3 days, depends on Task A)

If Bob has no other work and Alice has 10 days:
  - Task B CAN be moved to Carol (another tester)
  - Task A CANNOT be moved because Task B depends on it
  
If moving Task B would violate dependencies, optimization skips it.
```

## Technical Implementation

### State Management
 - `undoHistory`: Array of previous assignment states
 - `assignments`: Object mapping task serial number to assignee name

### Core Functions

#### `optimizeAndRedistributeTasks()`
```javascript
function optimizeAndRedistributeTasks() {
  // 1. Save current state to undo history
  // 2. Identify test tasks by description prefix (Add test / Add tests)
  // 3. Simulate schedule to estimate project duration
  // 4. Try moving tasks across resources to reduce end date
  // 5. Reject assignments that introduce resource gaps
  // 6. Update state with optimized assignments
}
```

#### `undoOptimization()`
```javascript
function undoOptimization() {
  // 1. Pop last state from undo history
  // 2. Restore assignments to previous state
  // 3. Gantt chart recalculates automatically (via useMemo)
}
```

### Constraints Enforced

| Constraint | Enforced? | Details |
|-----------|-----------|---------|
| Respect dependencies | ✅ Yes | Dependencies must be assigned and satisfied in the simulated schedule |
| Only test tasks | ✅ Yes | Description starts with "Add test" or "Add tests" |
| Allow unassigned test tasks | ✅ Yes | Eligible test tasks can be assigned by optimizer |
| Avoid resource gaps | ✅ Yes | Assignments that introduce idle gaps are rejected |
| Respect workdays | ✅ Yes | Scheduling still respects holidays/vacation (automatic) |

## Usage Workflow

### Basic Usage
1. Load your project (import Excel file with tasks and assignments)
2. View the Gantt chart and current end date
3. Click **⚡ Optimize** button
4. Observe:
   - Task assignments change in the Workload tab
   - Gantt chart recalculates
   - Project end date may improve
5. If satisfied, continue working
6. If not happy, click **↶ Undo** to restore previous assignments

### Advanced Workflow
- Run optimize multiple times if some tasks are marked with "Add test" descriptions
- Manually adjust assignments after optimization if needed
- Save your final session when satisfied

## Limitations & Known Issues

1. **Single Undo Level:** Only the most recent optimization can be undone
   - Workaround: Save your session before each optimization attempt

2. **Description Sensitivity:** Only redistributes tasks whose description starts with "Add test" or "Add tests"
   - Ensure the description prefix matches exactly (case-insensitive)

3. **No Rollback After Undo:** Undoing clears the undo history
   - You cannot "redo" after an undo
   - Plan before clicking undo if doing repeated optimizations

4. **Manual Assignments Override:** If you manually assign tasks after optimization, undo history is cleared
   - Each optimization run starts fresh with current state

## Algorithm Details

### Load Balancing Strategy
The optimization uses a **duration-minimizing schedule simulation:**
```
for each test task T:
  1. Try T on each team member
  2. Simulate the schedule and compute the overall finish time
  3. Reject assignments that create resource gaps
  4. Keep the assignment that shortens the project end date
```

### Time Complexity
- O(n * m) per iteration where n = number of test tasks, m = team members
- Practical performance: still fast for typical project sizes

### Optimality
- **Not globally optimal:** The heuristic may not find the absolute best assignment
- **Practical good results:** Usually improves project end date for unbalanced projects
- **Why not exhaustive search:** Too slow for real-world projects (NP-hard problem)

## Testing

### Unit Tests
```javascript
 test('optimize button is present in top bar when on gantt tab')
 test('renders app without errors after adding optimize feature')
```

### Integration Testing
To verify the feature:
1. Load a project with mixed task categories
2. Assign all tasks to one person
3. Click Optimize
4. Verify:
   - Test/Dev tasks redistribute
   - Research tasks don't move
   - End date improves
   - Dependencies still satisfied
5. Click Undo
6. Verify state reverts

## Future Enhancements

Possible improvements:
1. **Multiple Undo/Redo:** Maintain full history, add redo button
2. **Custom Constraints:** Allow marking specific tasks as "do not move"
3. **What-If Analysis:** Show projected end date before applying optimization
4. **Export Optimization Report:** Show which tasks moved and why
5. **Advanced Load Metrics:** Factor in skill level, vacation, other non-work time
6. **Multi-Objective Optimization:** Balance end date vs. workload variance vs. task clustering

## Troubleshooting

### Issue: Optimize button doesn't change assignments
-**Cause:** All eligible test tasks are already optimally assigned
 **Solution:** None needed; your project is already balanced

### Issue: Undo button appears but is grayed out
 **Cause:** UI bug (shouldn't happen)
 **Solution:** Refresh the page; reload your session

### Issue: Research task moved despite protection
+**Cause:** Task description starts with "Add test" so it is eligible
+**Solution:** Remove the "Add test" prefix if you want it excluded

### Issue: Dependencies broken after optimization
 **Cause:** Bug in dependency checking (should not happen)
 **Solution:** Click Undo immediately; report issue with task file

---

## Summary

The Optimize feature provides a one-click way to improve project timelines by redistributing test tasks while respecting dependency and no-gap constraints. Use it early and often to keep your team balanced!
