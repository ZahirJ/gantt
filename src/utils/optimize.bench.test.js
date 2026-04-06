import { optimizeAndRedistributeTasks } from './optimize';

// Generate a realistic 100-task project with 4 resources
function makeProject({ numTasks = 100, testFraction = 0.25, seed = 42 } = {}) {
    // Simple seeded PRNG
    let s = seed;
    const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };

    const members = ['Alice', 'Bob', 'Carol', 'Dave'];
    const tasks = [];
    const assignments = {};

    for (let i = 0; i < numTasks; i++) {
        const id = `t${i}`;
        const isTest = i > 0 && rand() < testFraction;
        const desc = isTest ? `Add tests for feature ${i}` : `Build feature ${i}`;
        const durationDays = Math.floor(rand() * 5) + 1; // 1–5 days

        // Each task may depend on 0–2 earlier tasks
        const dependencies = [];
        if (i > 0 && rand() < 0.6) dependencies.push(`t${Math.floor(rand() * i)}`);
        if (i > 1 && rand() < 0.3) {
            const dep = `t${Math.floor(rand() * i)}`;
            if (!dependencies.includes(dep)) dependencies.push(dep);
        }

        tasks.push({ id, description: desc, durationDays, dependencies });
        // Pre-assign everything to round-robin so all deps are satisfied
        assignments[id] = members[i % members.length];
    }

    return { tasks, members, assignments };
}

describe('optimize – scale tests (4 resources, 100 tasks)', () => {
    test('completes in under 2 seconds', () => {
        const { tasks, members, assignments } = makeProject();
        let resultAssignments;
        const setAssignments = (a) => { resultAssignments = a; };
        const setUndoHistory = jest.fn();

        const start = Date.now();
        optimizeAndRedistributeTasks({
            tasks, teamMembers: members, assignments,
            undoHistory: [], setAssignments, setUndoHistory
        });
        const elapsed = Date.now() - start;

        console.log(`  Elapsed: ${elapsed}ms`);
        expect(elapsed).toBeLessThan(2000);
    });

    test('actually improves or maintains finish time', () => {
        const { tasks, members, assignments } = makeProject();
        let resultAssignments;
        const setAssignments = (a) => { resultAssignments = a; };
        const setUndoHistory = jest.fn();

        // Compute baseline finish (same logic as optimizer's computeFinish)
        const computeFinish = (assign) => {
            const resourceReady = Object.fromEntries(members.map(m => [m, 0]));
            const endTimes = new Map();
            const pending = new Set(tasks.map(t => t.id));
            let safety = tasks.length * 6;
            while (pending.size > 0 && safety-- > 0) {
                let progressed = false;
                for (const id of Array.from(pending)) {
                    const task = tasks.find(t => t.id === id);
                    if (!task) { pending.delete(id); progressed = true; continue; }
                    const assignee = assign[id];
                    if (!assignee || resourceReady[assignee] === undefined) continue;
                    if (!task.dependencies.every(d => endTimes.has(d))) continue;
                    const depsEnd = task.dependencies.reduce((max, d) => Math.max(max, endTimes.get(d) || 0), 0);
                    const start = Math.max(resourceReady[assignee], depsEnd);
                    const end = start + task.durationDays;
                    endTimes.set(id, end);
                    resourceReady[assignee] = end;
                    pending.delete(id);
                    progressed = true;
                }
                if (!progressed) break;
            }
            return Math.max(0, ...Array.from(endTimes.values()));
        };

        const before = computeFinish(assignments);

        optimizeAndRedistributeTasks({
            tasks, teamMembers: members, assignments,
            undoHistory: [], setAssignments, setUndoHistory
        });

        const after = computeFinish(resultAssignments);
        const testTasksMoved = tasks
            .filter(t => /^add tests?\b/i.test(t.description))
            .filter(t => resultAssignments[t.id] !== assignments[t.id]).length;

        console.log(`  Finish before: ${before} days, after: ${after} days`);
        console.log(`  Test tasks reassigned: ${testTasksMoved}`);
        expect(after).toBeLessThanOrEqual(before);
    });

    test('non-test tasks are never reassigned', () => {
        const { tasks, members, assignments } = makeProject();
        let resultAssignments;
        const setAssignments = (a) => { resultAssignments = a; };
        const setUndoHistory = jest.fn();

        optimizeAndRedistributeTasks({
            tasks, teamMembers: members, assignments,
            undoHistory: [], setAssignments, setUndoHistory
        });

        const nonTestTasks = tasks.filter(t => !/^add tests?\b/i.test(t.description));
        for (const t of nonTestTasks) {
            expect(resultAssignments[t.id]).toBe(assignments[t.id]);
        }
    });

    test('all tasks remain assigned after optimization', () => {
        const { tasks, members, assignments } = makeProject();
        let resultAssignments;
        const setAssignments = (a) => { resultAssignments = a; };
        const setUndoHistory = jest.fn();

        optimizeAndRedistributeTasks({
            tasks, teamMembers: members, assignments,
            undoHistory: [], setAssignments, setUndoHistory
        });

        for (const t of tasks) {
            expect(resultAssignments[t.id]).toBeDefined();
            expect(members).toContain(resultAssignments[t.id]);
        }
    });

    test('test tasks with dependencies can be reassigned to other members', () => {
        // Mirrors real workplan: impl task followed by test task that depends on it
        const members = ['Alice', 'Bob', 'Carol', 'Dave'];
        const tasks = [
            { id: 'impl1', description: 'Implement GET blob', durationDays: 5, dependencies: [] },
            { id: 'impl2', description: 'Implement PUT blob', durationDays: 5, dependencies: [] },
            { id: 'impl3', description: 'Implement DELETE blob', durationDays: 5, dependencies: [] },
            { id: 'test1', description: 'Add tests for GET blob', durationDays: 3, dependencies: ['impl1'] },
            { id: 'test2', description: 'Add tests for PUT blob', durationDays: 3, dependencies: ['impl2'] },
            { id: 'test3', description: 'Add tests for DELETE blob', durationDays: 3, dependencies: ['impl3'] },
        ];
        // All on Alice initially
        const assignments = { impl1: 'Alice', impl2: 'Alice', impl3: 'Alice', test1: 'Alice', test2: 'Alice', test3: 'Alice' };

        let resultAssignments;
        optimizeAndRedistributeTasks({
            tasks, teamMembers: members, assignments,
            undoHistory: [], setAssignments: a => { resultAssignments = a; }, setUndoHistory: jest.fn()
        });

        const movedTests = ['test1', 'test2', 'test3'].filter(id => resultAssignments[id] !== 'Alice');
        console.log(`  Test tasks moved off Alice: ${movedTests.length}/3`);
        console.log(`  test1→${resultAssignments.test1}, test2→${resultAssignments.test2}, test3→${resultAssignments.test3}`);
        // Optimizer should spread test tasks across other members since that reduces finish time
        expect(movedTests.length).toBeGreaterThan(0);
    });
});
