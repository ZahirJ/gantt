function withoutKey(obj, key) {
  const n = { ...obj };
  delete n[key];
  return n;
}

/**
 * Returns new copies of all four task-related state slices with the given task removed.
 */
export function applyDeleteTask(sn, rawTasks, assignments, progress, taskStatuses) {
  const key = String(sn);
  return {
    rawTasks: rawTasks.filter(t => String(t["Serial Number"]) !== key),
    assignments: withoutKey(assignments, key),
    progress: withoutKey(progress, key),
    taskStatuses: withoutKey(taskStatuses, key),
  };
}

/**
 * Returns new copies of all four state slices with every unassigned task removed.
 * A task is unassigned when its Serial Number has no entry in assignments.
 */
export function applyDeleteAllUnassigned(rawTasks, assignments, progress, taskStatuses) {
  const unassignedSNs = new Set(
    rawTasks
      .filter(t => !assignments[t["Serial Number"]])
      .map(t => String(t["Serial Number"]))
  );
  if (unassignedSNs.size === 0) return { rawTasks, assignments, progress, taskStatuses };
  const newProgress = { ...progress };
  const newStatuses = { ...taskStatuses };
  unassignedSNs.forEach(sn => { delete newProgress[sn]; delete newStatuses[sn]; });
  return {
    rawTasks: rawTasks.filter(t => !unassignedSNs.has(String(t["Serial Number"]))),
    assignments: { ...assignments },
    progress: newProgress,
    taskStatuses: newStatuses,
  };
}

/**
 * Returns a new assignments map with all entries for the given person removed.
 */
export function applyUnassignAllForPerson(person, assignments) {
  const next = { ...assignments };
  Object.keys(next).forEach(sn => { if (next[sn] === person) delete next[sn]; });
  return next;
}

/**
 * Validates a proposed resource rename. Returns an error message, or null if valid.
 * Names are compared case-insensitively so "alice" can't sit next to "Alice";
 * changing only the case of the resource's own name is allowed.
 */
export function validateResourceRename(oldName, newName, resources) {
  const name = (newName ?? "").trim();
  if (!name) return "Name can't be empty";
  const clash = resources.some(r => r !== oldName && r.toLowerCase() === name.toLowerCase());
  return clash ? "A resource with that name already exists" : null;
}

/**
 * Returns new copies of every state slice that stores a resource name, with
 * oldName replaced by newName: the resources list (order kept), assignment
 * values, vacation-map key, each task's imported "Assignee" field, and the
 * assignment snapshots in the optimizer undo stack.
 */
export function applyRenameResource(oldName, newName, { resources, assignments, vacMap, rawTasks, undoHistory }) {
  const swap = (p) => (p === oldName ? newName : p);
  const renameValues = (map) => {
    const next = {};
    Object.keys(map).forEach(k => { next[k] = swap(map[k]); });
    return next;
  };
  // A leftover entry under newName (from a previously removed resource) must not
  // overwrite the renamed resource's vacation days, so skip it.
  const nextVacMap = {};
  Object.keys(vacMap).forEach(p => { if (p !== newName) nextVacMap[swap(p)] = vacMap[p]; });
  return {
    resources: resources.map(swap),
    assignments: renameValues(assignments),
    vacMap: nextVacMap,
    rawTasks: rawTasks.map(t => (t["Assignee"] === oldName ? { ...t, "Assignee": newName } : t)),
    undoHistory: undoHistory.map(h => ({ ...h, assignments: renameValues(h.assignments) })),
  };
}

/**
 * Returns new copies of every state slice that stores a resource name, with the
 * resource removed: dropped from the resources list, its tasks unassigned (also in
 * the imported "Assignee" field and optimizer undo snapshots, so Undo can't bring
 * back assignments to a person who no longer exists), and its vacation days removed.
 */
export function applyRemoveResource(name, { resources, assignments, vacMap, rawTasks, undoHistory }) {
  return {
    resources: resources.filter(r => r !== name),
    assignments: applyUnassignAllForPerson(name, assignments),
    vacMap: withoutKey(vacMap, name),
    rawTasks: rawTasks.map(t => (t["Assignee"] === name ? { ...t, "Assignee": "" } : t)),
    undoHistory: undoHistory.map(h => ({ ...h, assignments: applyUnassignAllForPerson(name, h.assignments) })),
  };
}
