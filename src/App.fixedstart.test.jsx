import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import ExcelJS from 'exceljs';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSV_HEADER = "Serial Number,Category,Description,Depends On,Status,Complexity,Days,Assignee,Integration Effort";
const CSV_HEADER_FSD = CSV_HEADER + ",Fixed Start Date";

async function loadCSV(csv, filename = "tasks.csv") {
  render(<App />);
  const file = new File([csv], filename, { type: "text/csv" });
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTitle(/optimize/i)).toBeInTheDocument(), { timeout: 3000 });
}

async function loadXLSX(buffer, filename = "tasks.xlsx") {
  render(<App />);
  const file = new File([buffer], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTitle(/optimize/i)).toBeInTheDocument(), { timeout: 5000 });
}

async function buildTaskXLSX(headers, dataRows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(headers);
  dataRows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function buildSessionXLSX({ tasks, fixedStartDates = null, resources = ["Alice"], projectStart = "2026-06-01" }) {
  const wb = new ExcelJS.Workbook();

  const schedWS = wb.addWorksheet("Schedule");
  schedWS.addRow(["Serial Number", "Category", "Description", "Depends On", "Status", "Complexity", "Days", "Start Date", "End Date", "Assignee", "Progress %"]);
  tasks.forEach(t => schedWS.addRow([t.sn, "", t.desc, "", "Open", "M", t.days || 1, "", "", t.assignee || "", 0]));

  const sessWS = wb.addWorksheet("Session");
  const sessionRows = [
    ["GANTT SESSION DATA — import this file to restore your work"], [],
    ["PROJECT START", projectStart], ["THEME", "dark"], [],
    ["RESOURCES"], ...resources.map(r => [r]), [],
    ["PUBLIC HOLIDAYS"], [],
    ["VACATION DAYS", "Person", "Date"], [],
    ["ASSIGNMENTS", "Serial Number", "Assignee"],
    ...tasks.filter(t => t.assignee).map(t => ["", String(t.sn), t.assignee]), [],
    ["PROGRESS", "Serial Number", "Percent"],
    ...tasks.map(t => ["", String(t.sn), 0]), [],
    ["STATUSES", "Serial Number", "Status"],
    ...tasks.map(t => ["", String(t.sn), "Open"]),
  ];

  if (fixedStartDates !== null) {
    sessionRows.push([]);
    sessionRows.push(["FIXED START DATES", "Serial Number", "Date"]);
    Object.entries(fixedStartDates).forEach(([sn, d]) => sessionRows.push(["", sn, d]));
  }

  sessionRows.forEach(r => sessWS.addRow(r));

  const wlWS = wb.addWorksheet("Workload");
  wlWS.addRow(["Person", "Tasks", "Total Days", "Finishes"]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── CSV import with Fixed Start Date column ───────────────────────────────────

describe("CSV import with Fixed Start Date column", () => {
  it("applies fixed start date from column: FIX badge appears on workload card", async () => {
    const csv = [
      CSV_HEADER_FSD,
      "1,,Delayed task,,,M,1,Alice,,2026-06-10",
    ].join("\n");
    await loadCSV(csv);

    // Switch to Workload tab to find FIX badge (Gantt bar badge needs non-zero width)
    fireEvent.click(screen.getByRole('button', { name: /workload/i }));
    await waitFor(() => expect(screen.getByTitle("Fixed start: 2026-06-10")).toBeInTheDocument());
  });

  it("imports without Fixed Start Date column (backward compat): no FIX badge", async () => {
    const csv = [
      CSV_HEADER,
      "1,,Normal task,,,M,1,Alice,",
    ].join("\n");
    await loadCSV(csv);

    fireEvent.click(screen.getByRole('button', { name: /workload/i }));
    // No FIX badge should be present
    expect(screen.queryByTitle(/Fixed start/)).not.toBeInTheDocument();
  });

  it("multiple tasks, only one with fixed start", async () => {
    const csv = [
      CSV_HEADER_FSD,
      "1,,Task A,,,M,1,Alice,,2026-06-10",
      "2,,Task B,,,M,1,Bob,,",
    ].join("\n");
    await loadCSV(csv);

    fireEvent.click(screen.getByRole('button', { name: /workload/i }));
    const badges = screen.queryAllByTitle(/Fixed start/);
    expect(badges).toHaveLength(1);
    expect(badges[0].title).toBe("Fixed start: 2026-06-10");
  });
});

// ── XLSX task file with Fixed Start Date column ───────────────────────────────

describe("XLSX task file with Fixed Start Date column", () => {
  it("reads fixed start date from XLSX task column", async () => {
    const buf = await buildTaskXLSX(
      ["Serial Number", "Description", "Days", "Assignee", "Fixed Start Date"],
      [["1", "Deferred task", 1, "Alice", "2026-06-10"]]
    );
    await loadXLSX(buf);

    fireEvent.click(screen.getByRole('button', { name: /workload/i }));
    await waitFor(() => expect(screen.getByTitle("Fixed start: 2026-06-10")).toBeInTheDocument(), { timeout: 3000 });
  });

  it("XLSX without Fixed Start Date column loads fine (backward compat)", async () => {
    const buf = await buildTaskXLSX(
      ["Serial Number", "Description", "Days", "Assignee"],
      [["1", "Regular task", 1, "Alice"]]
    );
    await loadXLSX(buf);

    fireEvent.click(screen.getByRole('button', { name: /workload/i }));
    expect(screen.queryByTitle(/Fixed start/)).not.toBeInTheDocument();
  });
});

// ── Session XLSX round-trip with FIXED START DATES section ────────────────────

describe("Session XLSX: FIXED START DATES section", () => {
  it("restores fixedStartDates from session XLSX with FIXED START DATES section", async () => {
    const buf = await buildSessionXLSX({
      tasks: [{ sn: 1, desc: "Important task", days: 1, assignee: "Alice" }],
      fixedStartDates: { "1": "2026-06-15" },
      resources: ["Alice"],
    });
    render(<App />);
    const file = new File([buf], "session.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTitle(/optimize/i)).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.click(screen.getByRole('button', { name: /workload/i }));
    await waitFor(() => expect(screen.getByTitle("Fixed start: 2026-06-15")).toBeInTheDocument(), { timeout: 3000 });
  });

  it("loads old session XLSX without FIXED START DATES section (backward compat)", async () => {
    const buf = await buildSessionXLSX({
      tasks: [{ sn: 1, desc: "Old session task", days: 1, assignee: "Alice" }],
      fixedStartDates: null, // omit the section entirely
      resources: ["Alice"],
    });
    render(<App />);
    const file = new File([buf], "old_session.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTitle(/optimize/i)).toBeInTheDocument(), { timeout: 5000 });

    // No FIX badges and no error
    fireEvent.click(screen.getByRole('button', { name: /workload/i }));
    expect(screen.queryByTitle(/Fixed start/)).not.toBeInTheDocument();
  });

  it("session XLSX with empty FIXED START DATES section loads fine", async () => {
    const buf = await buildSessionXLSX({
      tasks: [{ sn: 1, desc: "Free task", days: 1, assignee: "Alice" }],
      fixedStartDates: {}, // section present but empty
      resources: ["Alice"],
    });
    render(<App />);
    const file = new File([buf], "session.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTitle(/optimize/i)).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.click(screen.getByRole('button', { name: /workload/i }));
    expect(screen.queryByTitle(/Fixed start/)).not.toBeInTheDocument();
  });
});
