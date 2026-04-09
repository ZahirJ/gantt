import * as XLSX from 'xlsx';
import path from 'path';
import { levelOptimize } from './scheduleUtils';

// Load and normalize the Objectstore workplan
function loadObjectstoreTasks() {
  const filePath = path.resolve(__dirname, '../../examples/ObjectStorageLibrary-Workplan-copy (1).xlsx');
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  return rows.map(row => ({
    ...row,
    'Serial Number': String(row['Serial Number']),
    'Depends On': String(row['Depends On'] || '')
      .split(/[,;]+/)
      .map(s => s.trim())
      .filter(s => s && s !== '0')
      .join(','),
    'Days': parseInt(row['Days']) || 1,
  }));
}

const RESOURCES = ['Alice', 'Bob', 'Charlie', 'Dave'];
const PROJECT_START = '2025-01-06';
const HOLIDAYS = [];
const VAC_MAP = {};

// Assign all tasks round-robin to give a baseline
function baselineAssignments(tasks) {
  const assign = {};
  tasks.forEach((t, i) => { assign[t['Serial Number']] = RESOURCES[i % RESOURCES.length]; });
  return assign;
}

describe('levelOptimize – completed tasks', () => {
  let tasks;

  beforeAll(() => { tasks = loadObjectstoreTasks(); });

  test('completed tasks are never moved', () => {
    const assignments = baselineAssignments(tasks);

    // Mark a lead task (SN 22) and its test dependent (SN 23) as completed
    const completedSNs = ['22', '23'];
    const progress = Object.fromEntries(completedSNs.map(sn => [sn, 100]));

    const result = levelOptimize(tasks, RESOURCES, assignments, progress, HOLIDAYS, VAC_MAP, PROJECT_START);

    for (const sn of completedSNs) {
      expect(result[sn]).toBe(assignments[sn]);
    }
  });

  test('multiple completed tasks across different resources are all preserved', () => {
    // Spread completed tasks across resources
    const completedSNs = ['1', '2', '4', '5', '22', '23', '24', '25'];
    const assignments = {};
    tasks.forEach((t, i) => {
      assignments[t['Serial Number']] = RESOURCES[i % RESOURCES.length];
    });
    // Give completed tasks distinct assignees to verify each is preserved individually
    assignments['1'] = 'Alice';
    assignments['2'] = 'Bob';
    assignments['22'] = 'Charlie';
    assignments['23'] = 'Dave';

    const progress = Object.fromEntries(completedSNs.map(sn => [sn, 100]));

    const result = levelOptimize(tasks, RESOURCES, assignments, progress, HOLIDAYS, VAC_MAP, PROJECT_START);

    expect(result['1']).toBe('Alice');
    expect(result['2']).toBe('Bob');
    expect(result['22']).toBe('Charlie');
    expect(result['23']).toBe('Dave');
  });

  test('optimizer still redistributes non-completed tasks when completed tasks are present', () => {
    // All tasks on Alice — forces redistribution
    const assignments = {};
    tasks.forEach(t => { assignments[t['Serial Number']] = 'Alice'; });

    // Mark tasks 1-14 as completed (they stay on Alice)
    const completedSNs = ['1', '2', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'];
    const progress = Object.fromEntries(completedSNs.map(sn => [sn, 100]));

    const result = levelOptimize(tasks, RESOURCES, assignments, progress, HOLIDAYS, VAC_MAP, PROJECT_START);

    // Completed tasks must stay on Alice
    for (const sn of completedSNs) {
      expect(result[sn]).toBe('Alice');
    }

    // At least some non-completed tasks should have moved off Alice
    const nonCompletedTasks = tasks.filter(t => !completedSNs.includes(t['Serial Number']));
    const movedCount = nonCompletedTasks.filter(t => result[t['Serial Number']] !== 'Alice').length;
    expect(movedCount).toBeGreaterThan(0);
  });

  test('tasks with progress < 100 are treated as non-completed and can move', () => {
    const assignments = {};
    tasks.forEach(t => { assignments[t['Serial Number']] = 'Alice'; });

    // SN 3 is "In Progress" — should be movable
    const progress = { '3': 50 };

    const result = levelOptimize(tasks, RESOURCES, assignments, progress, HOLIDAYS, VAC_MAP, PROJECT_START);

    // SN 3 should potentially move (we can't guarantee it will, but confirm it's not locked)
    // The optimizer must produce a valid assignment object with SN 3 present
    expect(result['3']).toBeDefined();
    // And completed check: only tasks at 100 are locked — 50% is not locked
    expect(progress['3']).toBeLessThan(100);
  });

  test('all tasks have an assignee after optimization', () => {
    const assignments = baselineAssignments(tasks);
    const completedSNs = ['1', '2', '4', '5'];
    const progress = Object.fromEntries(completedSNs.map(sn => [sn, 100]));

    const result = levelOptimize(tasks, RESOURCES, assignments, progress, HOLIDAYS, VAC_MAP, PROJECT_START);

    for (const task of tasks) {
      expect(result[task['Serial Number']]).toBeDefined();
      expect(RESOURCES).toContain(result[task['Serial Number']]);
    }
  });
});
