import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from './App';

// ── CSV loading helper ────────────────────────────────────────────────────────
// Builds a minimal CSV File and fires it through the hidden file input,
// then waits until the app leaves the import screen (Optimize button visible).

const CSV_HEADER = "Serial Number,Category,Description,Depends On,Status,Complexity,Days,Assignee,Integration Effort";

function makeCSV(rows) {
  const lines = rows.map(r =>
    [r.sn, r.cat ?? "", r.desc, r.deps ?? "", r.status ?? "Open", r.complexity ?? "M", r.days ?? "3", r.assignee ?? "", r.effort ?? ""].join(",")
  );
  return [CSV_HEADER, ...lines].join("\n");
}

async function loadTasks(rows) {
  render(<App />);
  const csv = makeCSV(rows);
  const file = new File([csv], "tasks.csv", { type: "text/csv" });
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTitle(/optimize/i)).toBeInTheDocument(), { timeout: 3000 });
}

const TASKS_MIXED = [
  { sn: "1", desc: "Build auth", assignee: "Alice", status: "Open" },
  { sn: "2", desc: "Build API",  assignee: "Bob",   status: "Open" },
  { sn: "3", desc: "Write docs", assignee: "",      status: "Open" },
  { sn: "4", desc: "Add tests",  assignee: "",      status: "Open" },
];

const TASKS_ALL_ASSIGNED = [
  { sn: "1", desc: "Task Alpha", assignee: "Alice", status: "Open" },
  { sn: "2", desc: "Task Beta",  assignee: "Alice", status: "Open" },
  { sn: "3", desc: "Task Gamma", assignee: "Bob",   status: "Open" },
];

// ── Gantt view ────────────────────────────────────────────────────────────────

describe('Gantt view', () => {
  test('renders task rows after CSV load', async () => {
    await loadTasks(TASKS_MIXED);
    // descriptions appear in both the label column and the bar overlay
    expect(screen.getAllByText("Build auth").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Build API").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Write docs").length).toBeGreaterThan(0);
  });

  test('× delete button is present on each task row', async () => {
    await loadTasks(TASKS_MIXED);
    const deleteButtons = screen.getAllByTitle("Delete task");
    expect(deleteButtons.length).toBe(TASKS_MIXED.length);
  });

  test('clicking × opens the confirmation dialog', async () => {
    await loadTasks(TASKS_MIXED);
    fireEvent.click(screen.getAllByTitle("Delete task")[0]);
    expect(screen.getByText(/delete task 1\?/i)).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  test('Cancel in the dialog keeps the task', async () => {
    await loadTasks(TASKS_MIXED);
    fireEvent.click(screen.getAllByTitle("Delete task")[0]);
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText(/delete task 1\?/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Build auth").length).toBeGreaterThan(0);
  });

  test('confirming delete removes the task from the list', async () => {
    await loadTasks(TASKS_MIXED);
    fireEvent.click(screen.getAllByTitle("Delete task")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryAllByText("Build auth").length).toBe(0));
    expect(screen.getAllByText("Build API").length).toBeGreaterThan(0);
  });

  test('toolbar "✕ Unassigned" button is visible when unassigned tasks exist', async () => {
    await loadTasks(TASKS_MIXED);
    expect(screen.getByTitle("Delete all tasks with no assignee")).toBeInTheDocument();
  });

  test('toolbar "✕ Unassigned" button is absent when all tasks are assigned', async () => {
    await loadTasks(TASKS_ALL_ASSIGNED);
    expect(screen.queryByTitle("Delete all tasks with no assignee")).not.toBeInTheDocument();
  });

  test('"✕ Unassigned" shows confirmation with the correct count', async () => {
    await loadTasks(TASKS_MIXED);
    fireEvent.click(screen.getByTitle("Delete all tasks with no assignee"));
    expect(screen.getByText(/delete all 2 unassigned task\(s\)\?/i)).toBeInTheDocument();
  });

  test('confirming "✕ Unassigned" removes all unassigned tasks', async () => {
    await loadTasks(TASKS_MIXED);
    fireEvent.click(screen.getByTitle("Delete all tasks with no assignee"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryAllByText("Write docs").length).toBe(0));
    expect(screen.queryAllByText("Add tests").length).toBe(0);
    expect(screen.getAllByText("Build auth").length).toBeGreaterThan(0);
  });

  test('cancelling "✕ Unassigned" keeps all tasks', async () => {
    await loadTasks(TASKS_MIXED);
    fireEvent.click(screen.getByTitle("Delete all tasks with no assignee"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getAllByText("Write docs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Add tests").length).toBeGreaterThan(0);
  });
});

// ── Workload view ─────────────────────────────────────────────────────────────

async function goToWorkload(rows = TASKS_MIXED) {
  await loadTasks(rows);
  fireEvent.click(screen.getByRole("button", { name: /workload/i }));
  await waitFor(() => expect(screen.getByText("Resource Workload")).toBeInTheDocument());
}

describe('Workload view — Unassigned card', () => {
  test('Unassigned card appears when unassigned tasks exist', async () => {
    await goToWorkload();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  test('Unassigned card shows the correct task count', async () => {
    await goToWorkload();
    expect(screen.getByText("2 tasks")).toBeInTheDocument();
  });

  test('unassigned tasks appear inside the Unassigned card', async () => {
    await goToWorkload();
    expect(screen.getByText("Write docs")).toBeInTheDocument();
    expect(screen.getByText("Add tests")).toBeInTheDocument();
  });

  test('Unassigned card is absent when all tasks are assigned', async () => {
    await goToWorkload(TASKS_ALL_ASSIGNED);
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  test('"Delete all" button is present on the Unassigned card', async () => {
    await goToWorkload();
    expect(screen.getByRole("button", { name: "Delete all" })).toBeInTheDocument();
  });

  test('"Delete all" on Unassigned card opens confirmation dialog', async () => {
    await goToWorkload();
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(screen.getByText(/delete all 2 unassigned task\(s\)\?/i)).toBeInTheDocument();
  });

  test('confirming "Delete all" removes unassigned tasks', async () => {
    await goToWorkload();
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Unassigned")).not.toBeInTheDocument());
    expect(screen.queryByText("Write docs")).not.toBeInTheDocument();
  });
});

describe('Workload view — resource cards', () => {
  test('resource cards are rendered for each assignee', async () => {
    await goToWorkload();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  test('"Unassign all" button is present on resource cards with non-completed tasks', async () => {
    await goToWorkload();
    const buttons = screen.getAllByRole("button", { name: "Unassign all" });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  test('"Unassign all" opens a confirmation with the person\'s name', async () => {
    await goToWorkload();
    const [firstBtn] = screen.getAllByRole("button", { name: "Unassign all" });
    fireEvent.click(firstBtn);
    expect(screen.getByText(/unassign all tasks from/i)).toBeInTheDocument();
  });

  test('"Unassign all" confirmation label reads "Unassign" not "Delete"', async () => {
    await goToWorkload();
    fireEvent.click(screen.getAllByRole("button", { name: "Unassign all" })[0]);
    expect(screen.getByRole("button", { name: "Unassign" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  test('confirming "Unassign all" moves the person\'s tasks to Unassigned card', async () => {
    await goToWorkload(TASKS_ALL_ASSIGNED); // all assigned — Alice has 2 tasks
    // No Unassigned card yet
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
    // Unassign first resource (Alice)
    fireEvent.click(screen.getAllByRole("button", { name: "Unassign all" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Unassign" }));
    // Unassigned card should now appear with Alice's tasks
    await waitFor(() => expect(screen.getByText("Unassigned")).toBeInTheDocument());
    expect(screen.getAllByText("Task Alpha").length).toBeGreaterThan(0);
  });

  test('cancelling "Unassign all" keeps the tasks assigned', async () => {
    await goToWorkload();
    fireEvent.click(screen.getAllByRole("button", { name: "Unassign all" })[0]);
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Build auth")).toBeInTheDocument();
    // Unassigned card still only shows original 2 unassigned tasks
    expect(screen.getByText("2 tasks")).toBeInTheDocument();
  });
});

describe('Workload view — context menu delete', () => {
  test('right-clicking a task opens a context menu', async () => {
    await goToWorkload();
    const taskEl = screen.getByText("Build auth");
    fireEvent.contextMenu(taskEl);
    expect(screen.getByText("Delete task")).toBeInTheDocument();
  });

  test('"Delete task" in context menu opens confirmation dialog', async () => {
    await goToWorkload();
    fireEvent.contextMenu(screen.getByText("Build auth"));
    fireEvent.click(screen.getByText("Delete task"));
    expect(screen.getByText(/delete task 1\?/i)).toBeInTheDocument();
  });

  test('confirming context menu delete removes the task', async () => {
    await goToWorkload();
    fireEvent.contextMenu(screen.getByText("Build auth"));
    fireEvent.click(screen.getByText("Delete task"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Build auth")).not.toBeInTheDocument());
  });
});
