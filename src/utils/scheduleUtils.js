// Pure scheduling helpers shared between App.jsx and tests

export function fmtDate(d) { return new Date(d).toISOString().slice(0, 10); }

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

export function scheduleTasks(rawTasks, assignments, holidays, vacMap, projectStart) {
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
export function levelOptimize(tasks, resources, assignments, progress, holidays, vacMap, projectStart) {
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

  // Build units (lead task + its test dependents) in serial number order
  const allUnits = tasks
    .filter(t => !(isTest(t) && testToLead.has(snStr(t))))
    .map(t => {
      const sn = snStr(t);
      const testSNs = tasks.filter(x => isTest(x) && testToLead.get(snStr(x)) === sn).map(snStr);
      return { leadSN: sn, taskSNs: [sn, ...testSNs] };
    });

  // Only move units where no task is completed
  const units = allUnits.filter(u => u.taskSNs.every(sn => !isCompleted(sn)));

  const getEndDates = (assign) => {
    const scheduled = scheduleTasks(tasks, assign, holidays, vacMap, projectStart);
    return Object.fromEntries(resources.map(r => {
      const rTasks = scheduled.filter(t => assign[snStr(t)] === r && t._end);
      return [r, rTasks.length > 0 ? rTasks.reduce((mx, t) => t._end > mx ? t._end : mx, "") : projectStart];
    }));
  };

  const workdaysBetween = (a, b) => {
    if (a >= b) return 0;
    let count = 0;
    const d = new Date(a);
    const end = new Date(b);
    while (d < end) {
      d.setDate(d.getDate() + 1);
      if (isWorkday(d, holidays, vacMap, null)) count++;
    }
    return count;
  };

  // If any resource has no tasks: assign all movable units round-robin
  const hasEmptyResource = resources.some(r => !tasks.some(t => assignments[snStr(t)] === r));
  let next = { ...assignments };
  if (hasEmptyResource) {
    const completedAssignments = Object.fromEntries(
      tasks.filter(t => isCompleted(snStr(t))).map(t => [snStr(t), assignments[snStr(t)]])
    );
    next = { ...completedAssignments };
    units.forEach((unit, idx) => {
      const assignee = resources[idx % resources.length];
      unit.taskSNs.forEach(sn => { next[sn] = assignee; });
    });
  }

  // Leveling loop: move first unit from most-loaded resource to any resource
  // that is more than 5 working days behind the maximum finish date
  let moved = true;
  let maxIter = units.length * resources.length * 3;
  while (moved && maxIter-- > 0) {
    moved = false;
    const endDates = getEndDates(next);
    const maxEnd = Object.values(endDates).reduce((mx, d) => d > mx ? d : mx, "");

    for (const resource of resources) {
      if (endDates[resource] >= maxEnd) continue;
      if (workdaysBetween(endDates[resource], maxEnd) <= 5) continue;

      const overloaded = resources.reduce((mx, r) => endDates[r] > endDates[mx] ? r : mx, resources[0]);
      const snap = next;
      const candidates = units.filter(u => snap[u.leadSN] === overloaded);
      if (candidates.length === 0) continue;

      const trial = { ...next };
      for (const sn of candidates[0].taskSNs) trial[sn] = resource;
      next = trial;
      moved = true;
      break;
    }
  }

  return next;
}
