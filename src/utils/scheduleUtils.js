// Pure scheduling helpers shared between App.jsx and tests

export function fmtDate(d) {
  const date = new Date(d);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function isWorkday(date, holidays, vacMap, person) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  const iso = fmtDate(date);
  if (holidays.includes(iso)) return false;
  if (person && vacMap[person]?.includes(iso)) return false;
  return true;
}

export function nextWorkday(date, holidays, vacMap, person) {
  const d = new Date(date);
  while (!isWorkday(d, holidays, vacMap, person)) d.setDate(d.getDate() + 1);
  return d;
}

export function addWorkdays(date, extraDays, holidays, vacMap, person) {
  let d = new Date(date);
  let added = 0;
  while (added < extraDays) {
    d.setDate(d.getDate() + 1);
    if (isWorkday(d, holidays, vacMap, person)) added++;
  }
  return d;
}

export function scheduleTasks(rawTasks, assignments, holidays, vacMap, projectStart, fixedStartDates = {}) {
  // Bail out silently if the date is still being typed (partial / invalid value)
  if (!projectStart || isNaN(new Date(projectStart).getTime())) return rawTasks.map((t) => ({ ...t, _start: null, _end: null }));
  const tasks = rawTasks.map((t) => ({ ...t, _start: null, _end: null }));
  const done = new Set();
  let safety = tasks.length * 4;

  while (done.size < tasks.length && safety-- > 0) {
    for (const task of tasks) {
      const sn = task["Serial Number"];
      if (done.has(sn)) continue;
      const deps = (task["Depends On"] || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!deps.every((d) => done.has(d))) continue;

      let earliest = new Date(projectStart);
      for (const depSN of deps) {
        const dep = tasks.find((t) => t["Serial Number"] === depSN);
        if (dep?._end) {
          const de = new Date(dep._end);
          de.setDate(de.getDate() + 1);
          if (de > earliest) earliest = new Date(de);
        }
      }

      const person = assignments[sn] || null;
      let personFree = new Date(projectStart);
      if (person) {
        tasks.forEach((t) => {
          if (t["Serial Number"] !== sn && assignments[t["Serial Number"]] === person && t._end) {
            const te = new Date(t._end);
            te.setDate(te.getDate() + 1);
            if (te > personFree) personFree = new Date(te);
          }
        });
      }

      let start = new Date(Math.max(earliest.getTime(), personFree.getTime()));
      // Fixed start date acts as a floor: task cannot begin before this date
      const fixed = fixedStartDates[sn];
      if (fixed) {
        const fixedDate = new Date(fixed);
        if (fixedDate > start) start = fixedDate;
      }
      start = nextWorkday(start, holidays, vacMap, person);

      const days = parseInt(task["Days"]) || 1;
      const end = days > 1 ? addWorkdays(start, days - 1, holidays, vacMap, person) : new Date(start);

      task._start = fmtDate(start);
      task._end = fmtDate(end);
      done.add(sn);
    }
  }
  return tasks;
}

/**
 * Pure optimizer: redistributes tasks across resources to balance workload.
 * Completed tasks (progress[sn] >= 100) are never moved.
 *
 * @param {object[]} tasks      - raw task rows with "Serial Number", "Description", "Depends On", "Days"
 * @param {string[]} resources  - list of assignee names
 * @param {object}   assignments - { [serialNumber]: assigneeName }
 * @param {object}   progress   - { [serialNumber]: 0-100 }
 * @param {string[]} holidays   - ISO date strings
 * @param {object}   vacMap     - { [person]: string[] }
 * @param {string}   projectStart - ISO date string
 * @returns {object} new assignments map
 */
export function levelOptimize(tasks, resources, assignments, progress, holidays, vacMap, projectStart, fixedStartDates = {}) {
  const isTest = (t) => /^add tests?\b/i.test(String(t["Description"] || "").trim());
  const snStr = (t) => String(t["Serial Number"]);
  const snMap = new Map(tasks.map(t => [snStr(t), t]));
  const isCompleted = (sn) => (progress[sn] ?? 0) >= 100;

  // Map each test task to its lead: the first non-test task it directly depends on
  const testToLead = new Map();
  for (const task of tasks) {
    if (!isTest(task)) continue;
    const deps = String(task["Depends On"] || "").split(/[,;]/).map(s => s.trim()).filter(s => s && s !== "0");
    const leadSN = deps.find(sn => { const d = snMap.get(sn); return d && !isTest(d); });
    if (leadSN) testToLead.set(snStr(task), leadSN);
  }

  // Build units (lead task + its test dependents)
  const allUnits = tasks
    .filter(t => !(isTest(t) && testToLead.has(snStr(t))))
    .map(t => {
      const sn = snStr(t);
      const testSNs = tasks.filter(x => isTest(x) && testToLead.get(snStr(x)) === sn).map(snStr);
      return { leadSN: sn, taskSNs: [sn, ...testSNs] };
    });

  // Only move units where no task is completed
  const units = allUnits.filter(u => u.taskSNs.every(sn => !isCompleted(sn)));

  // ── Priority ordering ──────────────────────────────────────────────────────
  // Build dependency structures to determine allocation priority:
  //   1. Tasks with no dependencies come first (can start on day 1)
  //   2. Among tasks at the same depth, tasks that more others depend on come first
  //      (unblocking the most work earliest shortens the critical path)

  // Direct deps per SN
  const depsOf = new Map(tasks.map(t => {
    const sn = snStr(t);
    const deps = String(t["Depends On"] || "").split(/[,;]/).map(s => s.trim()).filter(s => s && s !== "0");
    return [sn, deps];
  }));

  // Reverse map: sn → Set of SNs that directly depend on it
  const directDependents = new Map(tasks.map(t => [snStr(t), new Set()]));
  for (const t of tasks) {
    const sn = snStr(t);
    for (const dep of (depsOf.get(sn) || [])) {
      if (directDependents.has(dep)) directDependents.get(dep).add(sn);
    }
  }

  // Transitive dependent count: BFS from each node through the reverse map
  const transitiveCount = new Map();
  for (const t of tasks) {
    const sn = snStr(t);
    const visited = new Set();
    const queue = [...directDependents.get(sn)];
    while (queue.length > 0) {
      const curr = queue.shift();
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const next of directDependents.get(curr) || []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
    transitiveCount.set(sn, visited.size);
  }

  // Topological depth (0 = no deps)
  const depthCache = new Map();
  const topoDepth = (sn, ancestors = new Set()) => {
    if (depthCache.has(sn)) return depthCache.get(sn);
    if (ancestors.has(sn)) return 0; // cycle guard
    ancestors.add(sn);
    const d = (depsOf.get(sn) || []).reduce((mx, dep) => Math.max(mx, topoDepth(dep, ancestors) + 1), 0);
    depthCache.set(sn, d);
    return d;
  };
  for (const t of tasks) topoDepth(snStr(t));

  // Sort: shallower depth first; ties broken by most transitive dependents first
  const priorityOrder = [...units].sort((a, b) => {
    const da = depthCache.get(a.leadSN) || 0;
    const db = depthCache.get(b.leadSN) || 0;
    if (da !== db) return da - db;
    return (transitiveCount.get(b.leadSN) || 0) - (transitiveCount.get(a.leadSN) || 0);
  });

  const getEndDates = (assign) => {
    const scheduled = scheduleTasks(tasks, assign, holidays, vacMap, projectStart, fixedStartDates);
    return Object.fromEntries(resources.map(r => {
      const rTasks = scheduled.filter(t => assign[snStr(t)] === r && t._end);
      return [r, rTasks.length > 0 ? rTasks.reduce((mx, t) => t._end > mx ? t._end : mx, "") : projectStart];
    }));
  };

  const maxOf = (ed) => Object.values(ed).reduce((mx, d) => d > mx ? d : mx, "");

  // If any resource has no tasks: assign all movable units round-robin
  const hasEmptyResource = resources.some(r => !tasks.some(t => assignments[snStr(t)] === r));
  let next = { ...assignments };
  if (hasEmptyResource) {
    const completedAssignments = Object.fromEntries(
      tasks.filter(t => isCompleted(snStr(t))).map(t => [snStr(t), assignments[snStr(t)]])
    );
    next = { ...completedAssignments };
    priorityOrder.forEach((unit, idx) => {
      const assignee = resources[idx % resources.length];
      unit.taskSNs.forEach(sn => { next[sn] = assignee; });
    });
  }

  // Greedy makespan search: each iteration try every movable unit on the most-loaded
  // resource against every other resource, keep the move that lowers the overall
  // project finish date the most. Stop when no move helps.
  let improved = true;
  let maxIter = units.length * resources.length * 4;
  while (improved && maxIter-- > 0) {
    improved = false;
    const endDates = getEndDates(next);
    const currentMax = maxOf(endDates);
    const overloaded = resources.reduce((mx, r) => endDates[r] > endDates[mx] ? r : mx, resources[0]);

    let bestMax = currentMax;
    let bestAssign = null;

    const snap = next;
    for (const unit of units.filter(u => snap[u.leadSN] === overloaded)) {
      for (const target of resources) {
        if (target === overloaded) continue;
        const trial = { ...snap };
        unit.taskSNs.forEach(sn => { trial[sn] = target; });
        const trialMax = maxOf(getEndDates(trial));
        if (trialMax < bestMax) {
          bestMax = trialMax;
          bestAssign = trial;
        }
      }
    }

    if (bestAssign) {
      next = bestAssign;
      improved = true;
    }
  }

  return next;
}
