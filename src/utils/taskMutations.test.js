import { applyDeleteTask, applyDeleteAllUnassigned, applyUnassignAllForPerson, applyRenameResource, validateResourceRename, applyRemoveResource } from './taskMutations';

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

// ── validateResourceRename ─────────────────────────────────────────────────────

describe('validateResourceRename', () => {
  const resources = ["Alice", "Bob"];

  test('accepts a new unique name', () => {
    expect(validateResourceRename("Alice", "Carol", resources)).toBeNull();
  });

  test('rejects an empty or whitespace-only name', () => {
    expect(validateResourceRename("Alice", "   ", resources)).toMatch(/empty/i);
  });

  test('rejects a name that clashes with another resource, ignoring case and spaces', () => {
    expect(validateResourceRename("Alice", " bob ", resources)).toMatch(/already exists/i);
  });

  test("allows changing only the case of the resource's own name", () => {
    expect(validateResourceRename("Alice", "ALICE", resources)).toBeNull();
  });
});

// ── applyRenameResource ────────────────────────────────────────────────────────

describe('applyRenameResource', () => {
  function renameState() {
    return {
      resources: ["Alice", "Bob"],
      assignments: { "1": "Alice", "2": "Bob", "3": "Alice" },
      vacMap: { Alice: ["2026-10-01"], Bob: ["2026-10-02"] },
      rawTasks: [{ ...TASK_A, "Assignee": "Alice" }, { ...TASK_B, "Assignee": "Bob" }, TASK_C],
      undoHistory: [{ assignments: { "1": "Bob", "2": "Alice" } }],
    };
  }

  test('renames in the resources list, keeping order', () => {
    expect(applyRenameResource("Alice", "Carol", renameState()).resources).toEqual(["Carol", "Bob"]);
  });

  test('moves every assignment to the new name', () => {
    expect(applyRenameResource("Alice", "Carol", renameState()).assignments).toEqual({ "1": "Carol", "2": "Bob", "3": "Carol" });
  });

  test('moves vacation days to the new name', () => {
    expect(applyRenameResource("Alice", "Carol", renameState()).vacMap).toEqual({ Carol: ["2026-10-01"], Bob: ["2026-10-02"] });
  });

  test("updates each task's imported Assignee field", () => {
    const { rawTasks } = applyRenameResource("Alice", "Carol", renameState());
    expect(rawTasks.map(t => t["Assignee"])).toEqual(["Carol", "Bob", undefined]);
  });

  test('renames inside optimizer undo snapshots so Undo restores the new name', () => {
    expect(applyRenameResource("Alice", "Carol", renameState()).undoHistory).toEqual([{ assignments: { "1": "Bob", "2": "Carol" } }]);
  });

  test('a leftover vacation entry under the new name does not overwrite the renamed resource', () => {
    const state = { ...renameState(), vacMap: { Alice: ["2026-10-01"], Carol: ["2025-01-01"] } };
    expect(applyRenameResource("Alice", "Carol", state).vacMap).toEqual({ Carol: ["2026-10-01"] });
  });

  test('does not mutate the input state', () => {
    const state = renameState();
    const snapshot = JSON.parse(JSON.stringify(state));
    applyRenameResource("Alice", "Carol", state);
    expect(state).toEqual(snapshot);
  });
});

// ── applyRemoveResource ────────────────────────────────────────────────────────

describe('applyRemoveResource', () => {
  function removeState() {
    return {
      resources: ["Alice", "Bob"],
      assignments: { "1": "Alice", "2": "Bob", "3": "Alice" },
      vacMap: { Alice: ["2026-10-01"], Bob: ["2026-10-02"] },
      rawTasks: [{ ...TASK_A, "Assignee": "Alice" }, { ...TASK_B, "Assignee": "Bob" }, TASK_C],
      undoHistory: [{ assignments: { "1": "Bob", "2": "Alice" } }],
    };
  }

  test('removes the resource from the list', () => {
    expect(applyRemoveResource("Alice", removeState()).resources).toEqual(["Bob"]);
  });

  test("unassigns the removed resource's tasks", () => {
    expect(applyRemoveResource("Alice", removeState()).assignments).toEqual({ "2": "Bob" });
  });

  test('deletes their vacation days', () => {
    expect(applyRemoveResource("Alice", removeState()).vacMap).toEqual({ Bob: ["2026-10-02"] });
  });

  test("clears the imported Assignee field on their tasks", () => {
    const { rawTasks } = applyRemoveResource("Alice", removeState());
    expect(rawTasks.map(t => t["Assignee"])).toEqual(["", "Bob", undefined]);
  });

  test('unassigns them inside optimizer undo snapshots', () => {
    expect(applyRemoveResource("Alice", removeState()).undoHistory).toEqual([{ assignments: { "1": "Bob" } }]);
  });

  test('does not mutate the input state', () => {
    const state = removeState();
    const snapshot = JSON.parse(JSON.stringify(state));
    applyRemoveResource("Alice", state);
    expect(state).toEqual(snapshot);
  });
});
