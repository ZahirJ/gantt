import { optimizeAndRedistributeTasks, undoOptimization } from './optimize';

describe('optimizeAndRedistributeTasks', () => {
    let setAssignments, setUndoHistory;

    beforeEach(() => {
        setAssignments = vi.fn();
        setUndoHistory = vi.fn();
    });

    test('redistributes tasks to least-loaded member', () => {
        const tasks = [
            { id: 't1', description: 'Add tests for login', durationDays: 5, dependencies: [] },
            { id: 't2', description: 'Add tests for API', durationDays: 3, dependencies: [] }
        ];
        const teamMembers = ['Alice', 'Bob'];
        const assignments = { t1: 'Alice', t2: 'Alice' };
        const undoHistory = [];

        optimizeAndRedistributeTasks({
            tasks,
            teamMembers,
            assignments,
            undoHistory,
            setAssignments,
            setUndoHistory
        });

        const newAssignments = setAssignments.mock.calls[0][0];
        expect(newAssignments.t1).not.toBe('Alice'); // one task moves off Alice to improve finish
        expect(newAssignments.t2).toBe('Alice');
    });

    test('protects research tasks from redistribution', () => {
        const tasks = [
            { id: 'r1', description: 'Research API limits', durationDays: 10, dependencies: [] }
        ];
        const teamMembers = ['Alice', 'Bob'];
        const assignments = { r1: 'Alice' };
        const undoHistory = [];

        optimizeAndRedistributeTasks({
            tasks,
            teamMembers,
            assignments,
            undoHistory,
            setAssignments,
            setUndoHistory
        });

        const newAssignments = setAssignments.mock.calls[0][0];
        expect(newAssignments.r1).toBe('Alice'); // unchanged
    });

    test('skips tasks with unassigned dependencies', () => {
        const tasks = [
            { id: 't1', description: 'Add tests for auth', durationDays: 5, dependencies: ['t2'] },
            { id: 't2', description: 'Add tests for profile', durationDays: 3, dependencies: [] }
        ];
        const teamMembers = ['Alice', 'Bob'];
        const assignments = { t1: 'Alice' }; // t2 not assigned
        const undoHistory = [];

        optimizeAndRedistributeTasks({
            tasks,
            teamMembers,
            assignments,
            undoHistory,
            setAssignments,
            setUndoHistory
        });

        const newAssignments = setAssignments.mock.calls[0][0];
        expect(newAssignments.t1).toBe('Alice'); // cannot move due to missing dependency
    });

    test('saves previous state to undo history', () => {
        const tasks = [{ id: 't1', description: 'Add tests for exports', durationDays: 5, dependencies: [] }];
        const teamMembers = ['Alice', 'Bob'];
        const assignments = { t1: 'Alice' };
        const undoHistory = [];

        optimizeAndRedistributeTasks({
            tasks,
            teamMembers,
            assignments,
            undoHistory,
            setAssignments,
            setUndoHistory
        });

        expect(setUndoHistory).toHaveBeenCalled();
        const historyCall = setUndoHistory.mock.calls[0][0];
        expect(historyCall).toContainEqual({ t1: 'Alice' }); // previous state saved
    });

    test('assigns unassigned test tasks when dependencies are assigned', () => {
        const tasks = [
            { id: 't1', description: 'Add tests for login', durationDays: 2, dependencies: ['t0'] },
            { id: 't0', description: 'Build login flow', durationDays: 3, dependencies: [] }
        ];
        const teamMembers = ['Alice', 'Bob'];
        const assignments = { t0: 'Alice' };
        const undoHistory = [];

        optimizeAndRedistributeTasks({
            tasks,
            teamMembers,
            assignments,
            undoHistory,
            setAssignments,
            setUndoHistory
        });

        const newAssignments = setAssignments.mock.calls[0][0];
        expect(newAssignments.t1).toBeDefined();
        expect(['Alice', 'Bob']).toContain(newAssignments.t1);
    });
});

describe('undoOptimization', () => {
    let setUndoHistory, setAssignments;

    beforeEach(() => {
        setUndoHistory = vi.fn();
        setAssignments = vi.fn();
    });

    test('restores previous assignments from history', () => {
        const undoHistory = [{ t1: 'Alice' }, { t1: 'Bob' }];

        undoOptimization({ undoHistory, setUndoHistory, setAssignments });

        expect(setAssignments).toHaveBeenCalledWith({ t1: 'Bob' });
        expect(setUndoHistory).toHaveBeenCalledWith([{ t1: 'Alice' }]);
    });

    test('handles empty undo history gracefully', () => {
        const undoHistory = [];

        undoOptimization({ undoHistory, setUndoHistory, setAssignments });

        expect(setAssignments).not.toHaveBeenCalled();
        expect(setUndoHistory).not.toHaveBeenCalled();
    });
});
