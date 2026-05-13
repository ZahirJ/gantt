import { applyDeleteTask, applyDeleteAllUnassigned, applyUnassignAllForPerson } from './taskMutations';

const TASK_A = { "Serial Number": "1", "Description": "Task A", "Days": 3 };
const TASK_B = { "Serial Number": "2", "Description": "Task B", "Days": 2 };
const TASK_C = { "Serial Number": "3", "Description": "Task C", "Days": 1 };

function makeState(overrides = {}) {
  return {
    rawTasks: [TASK_A, TASK_B, TASK_C],
    assignments: { "1": "Alice", "2": "Bob" },
    progress: { "1": 50, "2": 0, "3": 0 },
    taskStatuses: { "1": "In Progress", "2": "Open", "3": "Open" },
    ...overrides,
  };
}

// ── applyDeleteTask ────────────────────────────────────────────────────────────

describe('applyDeleteTask', () => {
  test('removes the task from rawTasks', () => {
    const { rawTasks } = applyDeleteTask("1", ...Object.values(makeState()));
    expect(rawTasks.map(t => t["Serial Number"])).toEqual(["2", "3"]);
  });

  test('removes the assignment for the deleted task', () => {
    const { assignments } = applyDeleteTask("1", ...Object.values(makeState()));
    expect(assignments).not.toHaveProperty("1");
    expect(assignments).toHaveProperty("2", "Bob");
  });

  test('removes progress entry for the deleted task', () => {
    const { progress } = applyDeleteTask("1", ...Object.values(makeState()));
    expect(progress).not.toHaveProperty("1");
    expect(progress).toHaveProperty("2", 0);
  });

  test('removes taskStatuses entry for the deleted task', () => {
    const { taskStatuses } = applyDeleteTask("1", ...Object.values(makeState()));
    expect(taskStatuses).not.toHaveProperty("1");
    expect(taskStatuses).toHaveProperty("2", "Open");
  });

  test('does not mutate original state', () => {
    const state = makeState();
    applyDeleteTask("1", state.rawTasks, state.assignments, state.progress, state.taskStatuses);
    expect(state.rawTasks).toHaveLength(3);
    expect(state.assignments).toHaveProperty("1");
  });

  test('deleting a task with no assignment still works', () => {
    const { rawTasks, assignments } = applyDeleteTask("3", ...Object.values(makeState()));
    expect(rawTasks).toHaveLength(2);
    expect(assignments).not.toHaveProperty("3");
  });

  test('deleting a non-existent sn leaves state unchanged', () => {
    const state = makeState();
    const result = applyDeleteTask("99", state.rawTasks, state.assignments, state.progress, state.taskStatuses);
    expect(result.rawTasks).toHaveLength(3);
    expect(result.assignments).toEqual(state.assignments);
  });
});

// ── applyDeleteAllUnassigned ───────────────────────────────────────────────────

describe('applyDeleteAllUnassigned', () => {
  test('removes all tasks with no assignment', () => {
    const state = makeState(); // task "3" is unassigned
    const { rawTasks } = applyDeleteAllUnassigned(state.rawTasks, state.assignments, state.progress, state.taskStatuses);
    expect(rawTasks.map(t => t["Serial Number"])).toEqual(["1", "2"]);
  });

  test('removes progress and status entries for deleted tasks', () => {
    const state = makeState();
    const { progress, taskStatuses } = applyDeleteAllUnassigned(state.rawTasks, state.assignments, state.progress, state.taskStatuses);
    expect(progress).not.toHaveProperty("3");
    expect(taskStatuses).not.toHaveProperty("3");
    expect(progress).toHaveProperty("1", 50);
  });

  test('keeps assigned tasks untouched', () => {
    const state = makeState();
    const { rawTasks, assignments } = applyDeleteAllUnassigned(state.rawTasks, state.assignments, state.progress, state.taskStatuses);
    expect(rawTasks.find(t => t["Serial Number"] === "1")).toBeDefined();
    expect(assignments).toHaveProperty("1", "Alice");
  });

  test('when all tasks are assigned returns same references', () => {
    const state = makeState({ assignments: { "1": "Alice", "2": "Bob", "3": "Alice" } });
    const result = applyDeleteAllUnassigned(state.rawTasks, state.assignments, state.progress, state.taskStatuses);
    expect(result.rawTasks).toBe(state.rawTasks);
  });

  test('when all tasks are unassigned deletes all of them', () => {
    const state = makeState({ assignments: {} });
    const { rawTasks } = applyDeleteAllUnassigned(state.rawTasks, state.assignments, state.progress, state.taskStatuses);
    expect(rawTasks).toHaveLength(0);
  });

  test('does not mutate original state', () => {
    const state = makeState();
    applyDeleteAllUnassigned(state.rawTasks, state.assignments, state.progress, state.taskStatuses);
    expect(state.rawTasks).toHaveLength(3);
    expect(state.progress).toHaveProperty("3");
  });
});

// ── applyUnassignAllForPerson ──────────────────────────────────────────────────

describe('applyUnassignAllForPerson', () => {
  test('removes all assignments for the given person', () => {
    const assignments = { "1": "Alice", "2": "Bob", "3": "Alice" };
    const result = applyUnassignAllForPerson("Alice", assignments);
    expect(result).not.toHaveProperty("1");
    expect(result).not.toHaveProperty("3");
  });

  test('leaves other people\'s assignments intact', () => {
    const assignments = { "1": "Alice", "2": "Bob", "3": "Alice" };
    const result = applyUnassignAllForPerson("Alice", assignments);
    expect(result).toHaveProperty("2", "Bob");
  });

  test('does not mutate the original assignments object', () => {
    const assignments = { "1": "Alice", "2": "Bob" };
    applyUnassignAllForPerson("Alice", assignments);
    expect(assignments).toHaveProperty("1", "Alice");
  });

  test('person with no assignments returns unchanged map', () => {
    const assignments = { "1": "Alice", "2": "Bob" };
    const result = applyUnassignAllForPerson("Carol", assignments);
    expect(result).toEqual(assignments);
  });

  test('empty assignments returns empty object', () => {
    const result = applyUnassignAllForPerson("Alice", {});
    expect(result).toEqual({});
  });
});
