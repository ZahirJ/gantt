// File: src/utils/optimize.js
export function optimizeAndRedistributeTasks({
    tasks,            // array of task objects { id, category, durationDays, dependencies: [id,...] }
    teamMembers,      // array of member names ['Alice','Bob',...]
    assignments,      // object mapping taskId -> assigneeName
    undoHistory,      // array state ref
    setAssignments,   // setter function to update assignments (React state)
    setUndoHistory    // setter for undoHistory (React state)
}) {
    const prev = JSON.parse(JSON.stringify(assignments || {}));
    setUndoHistory([...(undoHistory || []), prev]);

    const members = (teamMembers || []).filter(Boolean);
    if (members.length === 0 || !Array.isArray(tasks)) {
        setAssignments({ ...assignments });
        return;
    }

    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const isTestTask = (t) => /^add tests?\b/i.test(String(t?.description || "").trim());
    const movable = tasks.filter((t) => t?.id && isTestTask(t));

    const depsAssigned = (task, assign) => {
        const deps = task?.dependencies || [];
        return deps.every((depId) => !!assign[depId]);
    };

    const computeFinish = (assign) => {
        const resourceReady = Object.fromEntries(members.map((m) => [m, 0]));
        const endTimes = new Map();
        const pending = new Set(tasks.map((t) => t.id));
        let safety = tasks.length * tasks.length;

        while (pending.size > 0 && safety-- > 0) {
            let progressed = false;
            for (const id of Array.from(pending)) {
                const task = taskMap.get(id);
                if (!task) { pending.delete(id); progressed = true; continue; }
                const assignee = assign[id];
                if (!assignee || resourceReady[assignee] === undefined) continue;
                const deps = task.dependencies || [];
                if (!deps.every((depId) => endTimes.has(depId))) continue;
                const depsEnd = deps.reduce((max, depId) => Math.max(max, endTimes.get(depId) || 0), 0);
                const start = Math.max(resourceReady[assignee], depsEnd);
                const duration = task.durationDays || 0;
                const end = start + duration;
                endTimes.set(id, end);
                resourceReady[assignee] = end;
                pending.delete(id);
                progressed = true;
            }
            if (!progressed) break;
        }

        const hasBlockedAssigned = Array.from(pending).some((id) => assign[id]);
        if (hasBlockedAssigned) return Infinity;

        const finish = Math.max(0, ...Array.from(endTimes.values()));
        return finish;
    };

    const nextAssignments = { ...assignments };

    // Seed unassigned Test tasks to allow the optimizer to assign them.
    movable.forEach((task) => {
        if (!nextAssignments[task.id] && depsAssigned(task, nextAssignments)) {
            nextAssignments[task.id] = members[0];
        }
    });

    let improved = true;
    while (improved) {
        improved = false;
        const baseFinish = computeFinish(nextAssignments);

        for (const task of movable) {
            if (!depsAssigned(task, nextAssignments)) continue;

            const currentAssignee = nextAssignments[task.id];
            let bestAssignee = currentAssignee;
            let bestFinish = baseFinish;

            for (const candidate of members) {
                if (candidate === currentAssignee) continue;
                const trial = { ...nextAssignments, [task.id]: candidate };
                const finish = computeFinish(trial);
                if (finish < bestFinish) {
                    bestFinish = finish;
                    bestAssignee = candidate;
                }
            }

            if (bestAssignee !== currentAssignee) {
                nextAssignments[task.id] = bestAssignee;
                improved = true;
            }
        }
    }

    setAssignments(nextAssignments);
}

// File: src/utils/undoOptimization.js
export function undoOptimization({ undoHistory, setUndoHistory, setAssignments }) {
    if (!undoHistory || undoHistory.length === 0) return;
    const previous = undoHistory[undoHistory.length - 1];
    const nextHistory = undoHistory.slice(0, -1);
    setUndoHistory(nextHistory);
    setAssignments(previous);
}
