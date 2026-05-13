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
