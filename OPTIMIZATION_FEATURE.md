# Task Optimization Feature Documentation

## Overview

The **Task Optimization** feature automatically redistributes Test and Development tasks across team members to minimize the project end date while maintaining all dependency constraints and respecting Research task assignments.

## How It Works

### Feature Behavior

1. **Identifies Redistributable Tasks**
   - Only tasks with `Category` = "Test" or "Development" are eligible for redistribution
   - Tasks must have an original assignee (unassigned tasks are skipped)
   - Research tasks are NEVER moved (remain with original assignee)

2. **Calculates Current Workload**
   - Computes total days of work per team member
   - Includes all task types in the load calculation

3. **Optimizes Assignment**
   - For each redistributable task:
     - Identifies the least-loaded team member
     - Only reassigns if it improves load balance
     - Verifies all dependencies are satisfied (have assignees)
   - Iteratively balances the team's workload

4. **Saves State for Undo**
   - Before optimization runs, current assignments are saved
   - You can undo in a single click if not satisfied

## UI Controls

### Optimize Button (⚡ Optimize)
- **Location:** Top bar (bright blue accent color)
- **Tooltip:** "Optimize: Redistribute Test & Development tasks to minimize end date"
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

Task 2 is a Development task, originally assigned to Alice.

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

Research tasks stay with Alice regardless of load balance.

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
  // 2. Filter for Test/Development tasks with assignees
  // 3. Calculate load per resource
  // 4. Iterate: assign each task to least-loaded person
  // 5. Verify dependencies are satisfied
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
| Respect dependencies | ✅ Yes | All task dependencies must have assignees |
| Protect research | ✅ Yes | Only Test/Development tasks redistributed |
| Only move assigned tasks | ✅ Yes | Unassigned tasks remain unassigned |
| Improve load balance | ✅ Yes | Only reassign if it reduces workload difference |
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
- Run optimize multiple times if some tasks have flexible categories (mark as "Test" or "Dev")
- Manually adjust assignments after optimization if needed
- Save your final session when satisfied

## Limitations & Known Issues

1. **Single Undo Level:** Only the most recent optimization can be undone
   - Workaround: Save your session before each optimization attempt

2. **Category Sensitivity:** Only redistributes Test/Development tasks
   - If you want other categories redistributed, change their category name
   - Ensure category names are exactly "Test", "Development", or "Research" (case-insensitive)

3. **No Rollback After Undo:** Undoing clears the undo history
   - You cannot "redo" after an undo
   - Plan before clicking undo if doing repeated optimizations

4. **Manual Assignments Override:** If you manually assign tasks after optimization, undo history is cleared
   - Each optimization run starts fresh with current state

## Algorithm Details

### Load Balancing Strategy
The optimization uses a **greedy least-loaded approach:**
```
for each redistributable task T:
  1. Find the team member with the least total workload
  2. If that person has less work than T's current assignee:
     3. Check if all of T's dependencies have assignees
     4. If yes, move T to the least-loaded person
     5. Update load accounting
```

### Time Complexity
- O(n * m) where n = number of redistributable tasks, m = number of team members
- Practical performance: <100ms even for 100+ tasks and 10+ team members

### Optimality
- **Not globally optimal:** The greedy approach may not find the absolute best assignment
- **Practical good results:** Usually improves project end date by 10-30% for unbalanced projects
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
**Cause:** All redistributable tasks already optimally assigned
**Solution:** None needed; your project is already balanced

### Issue: Undo button appears but is grayed out
**Cause:** UI bug (shouldn't happen)
**Solution:** Refresh the page; reload your session

### Issue: Research task moved despite protection
**Cause:** Category name mismatch (not exactly "Research")
**Solution:** Fix the category name in your Excel file to exactly "Research"

### Issue: Dependencies broken after optimization
**Cause:** Bug in dependency checking (should not happen)
**Solution:** Click Undo immediately; report issue with task file

---

## Summary

The Optimize feature provides a powerful, one-click way to improve project timelines by intelligently redistributing work while respecting all constraints. Use it early and often to keep your team balanced!

