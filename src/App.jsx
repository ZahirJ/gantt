import { useState, useMemo, useRef } from "react";
import ExcelJS from "exceljs";
import { fmtDate, isWorkday, nextWorkday, addWorkdays, scheduleTasks, levelOptimize } from "./utils/scheduleUtils";
import AddTaskModal from "./components/AddTaskModal";
import ConfirmDialog from "./components/ConfirmDialog";
import { applyDeleteTask, applyDeleteAllUnassigned, applyUnassignAllForPerson } from "./utils/taskMutations";

// ── Themes ─────────────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg: "#0d0f18",
    surface: "#161928",
    card: "#1c2035",
    border: "#252a42",
    accent: "#4f8ef7",
    accentDim: "#1a2d5a",
    green: "#3ecf8e",
    yellow: "#f5c842",
    red: "#f7634f",
    purple: "#9b7cff",
    text: "#dde1f0",
    muted: "#5a6080",
    inputBg: "#161928",
    rowAlt: "rgba(255,255,255,0.02)",
    todayLine: "#f5c842",
  },
  light: {
    bg: "#f4f5f9",
    surface: "#ffffff",
    card: "#f9fafb",
    border: "#dde1ea",
    accent: "#2563eb",
    accentDim: "#dbeafe",
    green: "#059669",
    yellow: "#d97706",
    red: "#dc2626",
    purple: "#7c3aed",
    text: "#1a1d2e",
    muted: "#6b7280",
    inputBg: "#f4f5f9",
    rowAlt: "rgba(0,0,0,0.02)",
    todayLine: "#d97706",
  },
};

function makeStatusColor(theme) {
  return {
    completed: THEMES[theme].green,
    "in progress": THEMES[theme].accent,
    open: THEMES[theme].muted,
  };
}

// Amber heat scale: 0 dependents = neutral gray, rising through yellow → orange → red
const HEAT_COLORS = {
  dark:  ["#6b7280", "#fde047", "#fb923c", "#f97316", "#ef4444", "#dc2626"],
  light: ["#9ca3af", "#ca8a04", "#d97706", "#ea580c", "#dc2626", "#b91c1c"],
};
function heatColor(count = 0, theme = "dark") {
  const palette = HEAT_COLORS[theme] || HEAT_COLORS.dark;
  return palette[Math.min(count, palette.length - 1)];
}

const UNASSIGNED_COLOR = { dark: "#64748b", light: "#94a3b8" };

function statusColor(s = "", theme = "dark") {
  return makeStatusColor(theme)[s.toLowerCase()] || THEMES[theme].muted;
}

const SIZE_DAYS = { S: 1, M: 3, L: 5, XL: 10 };

function isTestTask(desc = "") {
  return /\btest(ing)?\b/i.test(String(desc).trim());
}

// ── File parsing ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Convert an ExcelJS cell to a plain string (equivalent to SheetJS raw:false)
function cellStr(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  if (cell.value instanceof Object && cell.value.richText) {
    return cell.value.richText.map((r) => r.text).join("");
  }
  if (cell.value instanceof Date) return fmtDate(cell.value);
  return String(cell.value);
}

// Convert an ExcelJS worksheet to array-of-objects (header row = keys)
function wsToJson(ws) {
  const headers = [];
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNum) => {
    if (rowNum === 1) {
      row.eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = cellStr(cell); });
    } else {
      const obj = {};
      row.eachCell({ includeEmpty: true }, (cell, col) => { if (headers[col]) obj[headers[col]] = cellStr(cell); });
      rows.push(obj);
    }
  });
  return rows;
}

// Convert an ExcelJS worksheet to array-of-arrays (for session key-value parsing)
function wsToAoa(ws) {
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const arr = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { arr[col - 1] = cellStr(cell); });
    rows.push(arr);
  });
  return rows;
}

// Minimal RFC-4180 CSV parser
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const parse = (line) => {
    const fields = [];
    let field = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i + 1] === '"') { field += '"'; i++; } else { inQ = !inQ; } }
      else if (c === ',' && !inQ) { fields.push(field); field = ""; }
      else field += c;
    }
    fields.push(field);
    return fields;
  };
  const nonEmpty = lines.filter((l) => l.trim());
  if (!nonEmpty.length) return [];
  const headers = parse(nonEmpty[0]);
  return nonEmpty.slice(1).map((line) => {
    const vals = parse(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
}

function parseFile(file, callback) {
  if (file.size > MAX_FILE_SIZE) {
    callback(new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 10 MB.`));
    return;
  }

  (async () => {
    const arrayBuffer = await file.arrayBuffer();

    // ── CSV ──
    if (/\.csv$/i.test(file.name)) {
      const rows = parseCSV(new TextDecoder().decode(arrayBuffer));
      callback(null, normalizeTasks(rows), null);
      return;
    }

    // ── XLSX ──
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arrayBuffer);

    const sheetNames = wb.worksheets.map((ws) => ws.name);

    // ── Detect session XLSX ──
    if (sheetNames.includes("Session") && sheetNames.includes("Schedule")) {
      const schedRows = wsToJson(wb.getWorksheet("Schedule"));
      const sessRaw = wsToAoa(wb.getWorksheet("Session"));
      const tasks = normalizeTasks(schedRows);

      const session = { projectStart: null, themeKey: null, resources: [], holidays: [], vacMap: {}, assignments: {}, progress: {}, statuses: {} };
      let mode = null;
      for (const row of sessRaw) {
        const cell0 = String(row[0] ?? "").trim();
        const cell1 = String(row[1] ?? "").trim();
        const cell2 = String(row[2] ?? "").trim();
        if (cell0 === "PROJECT START") { session.projectStart = cell1; continue; }
        if (cell0 === "THEME") { session.themeKey = cell1; continue; }
        if (cell0 === "RESOURCES") { mode = "resources"; continue; }
        if (cell0 === "PUBLIC HOLIDAYS") { mode = "holidays"; continue; }
        if (cell0 === "VACATION DAYS") { mode = "vacations"; continue; }
        if (cell0 === "ASSIGNMENTS") { mode = "assignments"; continue; }
        if (cell0 === "PROGRESS") { mode = "progress"; continue; }
        if (cell0 === "STATUSES") { mode = "statuses"; continue; }
        if (!cell0 && !cell1 && !cell2) { mode = null; continue; }
        if (mode === "resources" && cell0) session.resources.push(cell0);
        if (mode === "holidays" && cell0) session.holidays.push(cell0);
        if (mode === "vacations" && cell1 && cell2) {
          if (!session.vacMap[cell1]) session.vacMap[cell1] = [];
          session.vacMap[cell1].push(cell2);
        }
        if (mode === "assignments" && cell1) session.assignments[cell1] = cell2;
        if (mode === "progress" && cell1) session.progress[cell1] = Number(cell2);
        if (mode === "statuses" && cell1) session.statuses[cell1] = cell2;
      }

      schedRows.forEach((r) => {
        const sn = String(r["Serial Number"] ?? "").trim();
        const pct = Number(r["Progress %"]);
        if (sn && !isNaN(pct)) session.progress[sn] = pct;
      });

      callback(null, tasks, session);
      return;
    }

    // ── Regular task file ──
    const rows = wsToJson(wb.worksheets[0]);
    callback(null, normalizeTasks(rows), null);
  })().catch(callback);
}

function normalizeTasks(rows) {
  return rows.map((row, idx) => {
    // Serial Number may be a formula like =ROW()-1 — use row index as fallback
    let serial = String(row["Serial Number"] ?? "").trim();
    if (!serial || serial.startsWith("=") || isNaN(Number(serial))) serial = String(idx + 1);

    // Depends On: 0 or "" = no dependency; otherwise comma/semicolon list of serials
    // Accept any capitalisation of the column name
    const depsCol = row["Depends On"] ?? row["Depends on"] ?? row["depends on"] ?? row["depends_on"] ?? "";
    let depsRaw = String(depsCol).trim();
    const deps = depsRaw.split(/[,;]+/).map((s) => s.trim()).filter((s) => s && s !== "0" && s !== serial).join(",");

    const days = parseInt(row["Days"]) || SIZE_DAYS[String(row["Complexity"]).trim()] || 1;

    return {
      ...row,
      "Serial Number": serial,
      "Depends On": deps,
      "Days": days,
      "Assignee": row["Assignee"] || "",
      "Status": row["Status"] || "Open",
    };
  });
}

function generateSerial(rawTasks) {
  const nums = rawTasks.map(t => parseInt(t["Serial Number"], 10)).filter(n => !isNaN(n));
  return String(nums.length > 0 ? Math.max(...nums) + 1 : rawTasks.length + 1);
}

// ── Scheduling helpers ─────────────────────────────────────────────────────────
// fmtDate, isWorkday, nextWorkday, addWorkdays, scheduleTasks imported from ./utils/scheduleUtils

// ── Week number ────────────────────────────────────────────────────────────────
function getWeek(d) {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function GanttApp() {
  const [screen, setScreen] = useState("import");
  const [rawTasks, setRawTasks] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [resources, setResources] = useState([]);
  const [projectStart, setProjectStart] = useState(fmtDate(new Date()));
  const [holidays, setHolidays] = useState([]);
  const [vacMap, setVacMap] = useState({});
  const [progress, setProgress] = useState({});
  const [taskStatuses, setTaskStatuses] = useState({});
  const [tab, setTab] = useState("gantt");
  const [zoom, setZoom] = useState("week");
  const [dragOver, setDragOver] = useState(false);
  const [newHoliday, setNewHoliday] = useState("");
  const [newResource, setNewResource] = useState("");
  const [undoHistory, setUndoHistory] = useState([]);
  const [filterCategory, setFilterCategory] = useState("All");
  const [themeKey, setThemeKey] = useState("dark");
  const C = THEMES[themeKey];
  const fileRef = useRef();
  const [draggingTask, setDraggingTask] = useState(null); // { sn, fromPerson }
  const [dragOverPerson, setDragOverPerson] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { sn, x, y, currentPerson }
  const [addTaskModal, setAddTaskModal] = useState(null); // null | { initialSerial }
  const [confirmDialog, setConfirmDialog] = useState(null); // null | { message, onConfirm }

  function askConfirm(message, onConfirm, confirmLabel = "Delete") {
    setConfirmDialog({ message, onConfirm, confirmLabel });
  }

  const TASK_STATUSES = ["Open", "In Progress", "Completed", "Open(May not need fix)"];

  const getStatus = (sn) => taskStatuses[String(sn)] ?? "Open";
  const isTaskCompleted = (sn) => getStatus(String(sn)) === "Completed";

  function setTaskStatus(sn, newStatus) {
    setTaskStatuses(s => ({ ...s, [String(sn)]: newStatus }));
    setProgress(p => ({
      ...p,
      [String(sn)]: newStatus === "Completed" ? 100 : newStatus === "In Progress" ? Math.max(p[String(sn)] ?? 0, 10) : 0,
    }));
  }

  function deleteTask(sn) {
    const r = applyDeleteTask(sn, rawTasks, assignments, progress, taskStatuses);
    setRawTasks(r.rawTasks); setAssignments(r.assignments); setProgress(r.progress); setTaskStatuses(r.taskStatuses);
  }

  function unassignAllForPerson(person) {
    setAssignments(applyUnassignAllForPerson(person, assignments));
  }

  function deleteAllUnassigned() {
    const r = applyDeleteAllUnassigned(rawTasks, assignments, progress, taskStatuses);
    setRawTasks(r.rawTasks); setProgress(r.progress); setTaskStatuses(r.taskStatuses);
  }

  function submitNewTask(draft) {
    const sn = draft.serial;
    setRawTasks(prev => [...prev, {
      "Serial Number": sn,
      "Category": draft.category || "",
      "Description": draft.description,
      "Depends On": draft.dependsOn || "",
      "Status": draft.status || "Open",
      "Complexity": draft.complexity || "M",
      "Days": parseInt(draft.days) || 1,
      "Assignee": draft.assignee || "",
      "Integration Effort": draft.integrationEffort || "",
    }]);
    if (draft.assignee) setAssignments(prev => ({ ...prev, [sn]: draft.assignee }));
    setTaskStatuses(prev => ({ ...prev, [sn]: draft.status || "Open" }));
    setProgress(prev => ({ ...prev, [sn]: 0 }));
    setAddTaskModal(null);
  }

  function loadTasks(allTasks) {
    const tasks = allTasks.filter(t => (t["Status"] || "").toLowerCase() !== "completed");
    setRawTasks(tasks);
    const a = {};
    tasks.forEach((t) => { if (t["Assignee"]) a[t["Serial Number"]] = t["Assignee"]; });
    setAssignments(a);
    const s = {};
    const p = {};
    tasks.forEach((t) => {
      const raw = (t["Status"] || "Open");
      // Normalize to canonical status labels
      const normalized = raw.toLowerCase() === "completed" ? "Completed"
        : raw.toLowerCase() === "in progress" ? "In Progress"
        : raw;
      s[t["Serial Number"]] = normalized;
      p[t["Serial Number"]] = normalized === "Completed" ? 100 : normalized === "In Progress" ? 50 : 0;
    });
    setTaskStatuses(s);
    setProgress(p);
    const people = [...new Set(tasks.map((t) => t["Assignee"]).filter(Boolean))];
    setResources((prev) => [...new Set([...prev, ...people])]);
    setScreen("gantt");
  }

  function handleFile(file) {
    if (!file) return;
    parseFile(file, (err, tasks, session) => {
      if (err) { alert("Error reading file: " + err.message); return; }
      if (session) {
        // Restore full session
        setRawTasks(tasks);
        setAssignments(session.assignments);
        setProgress(session.progress);
        // Restore statuses: use saved statuses if present, else derive from progress
        if (Object.keys(session.statuses || {}).length > 0) {
          setTaskStatuses(session.statuses);
        } else {
          const derived = {};
          tasks.forEach((t) => {
            const sn = t["Serial Number"];
            const pct = session.progress[sn] ?? 0;
            derived[sn] = pct >= 100 ? "Completed" : pct > 0 ? "In Progress" : (t["Status"] || "Open");
          });
          setTaskStatuses(derived);
        }
        if (session.projectStart) setProjectStart(session.projectStart);
        if (session.themeKey) setThemeKey(session.themeKey);
        if (session.resources.length) setResources(session.resources);
        else {
          const people = [...new Set(tasks.map((t) => t["Assignee"]).filter(Boolean))];
          setResources(people);
        }
        setHolidays(session.holidays);
        setVacMap(session.vacMap);
        setScreen("gantt");
      } else {
        loadTasks(tasks);
      }
    });
  }

  const categories = useMemo(() => {
    const cats = [...new Set(rawTasks.map((t) => t["Category"]).filter(Boolean))];
    return ["All", ...cats];
  }, [rawTasks]);

  const filteredRaw = useMemo(() =>
    filterCategory === "All" ? rawTasks : rawTasks.filter((t) => t["Category"] === filterCategory),
    [rawTasks, filterCategory]);

  // Count how many tasks directly depend on each task (used for heat coloring)
  const dependentCount = useMemo(() => {
    const counts = {};
    for (const t of filteredRaw) {
      const sn = String(t["Serial Number"]);
      if (!counts[sn]) counts[sn] = 0;
      const deps = String(t["Depends On"] || "").split(/[,;]/).map(s => s.trim()).filter(s => s && s !== "0");
      for (const dep of deps) counts[dep] = (counts[dep] || 0) + 1;
    }
    return counts;
  }, [filteredRaw]);

  const scheduledTasks = useMemo(() =>
    scheduleTasks(filteredRaw, assignments, holidays, vacMap, projectStart),
    [filteredRaw, assignments, holidays, vacMap, projectStart]);

  const projectEnd = useMemo(() =>
    scheduledTasks.reduce((mx, t) => (t._end > mx ? t._end : mx), projectStart),
    [scheduledTasks, projectStart]);

  const workDates = useMemo(() => {
    const dates = [];
    let d = new Date(projectStart);
    const end = new Date(projectEnd);
    end.setDate(end.getDate() + 20);
    while (d <= end) {
      if (d.getDay() !== 0 && d.getDay() !== 6) dates.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return dates;
  }, [projectStart, projectEnd]);

  const colW = zoom === "week" ? 34 : 18;
  const rowH = 40;
  const labelW = 370;
  const totalW = workDates.length * colW;
  const totalH = scheduledTasks.length * rowH;

  function dateToIdx(dateStr) {
    const idx = workDates.findIndex((d) => fmtDate(d) >= dateStr);
    return idx < 0 ? workDates.length : idx;
  }
  function taskX(t) { return dateToIdx(t._start) * colW; }
  function taskW(t) {
    const s = dateToIdx(t._start);
    const e = dateToIdx(t._end);
    return Math.max((e - s + 1) * colW, colW);
  }

  const headerGroups = useMemo(() => {
    const groups = [];
    let cur = null;
    workDates.forEach((d) => {
      const label = zoom === "week"
        ? `W${getWeek(d)} · ${d.toLocaleString("default", { month: "short" })} ${d.getFullYear()}`
        : `${d.toLocaleString("default", { month: "short" })} ${d.getFullYear()}`;
      if (!cur || cur.label !== label) { cur = { label, count: 1 }; groups.push(cur); }
      else cur.count++;
    });
    return groups;
  }, [workDates, zoom]);

  const todayIdx = workDates.findIndex((d) => fmtDate(d) >= fmtDate(new Date()));

  function getArrows() {
    const snIndex = new Map(scheduledTasks.map((t, i) => [t["Serial Number"], i]));
    const arrows = [];
    scheduledTasks.forEach((task, ti) => {
      const rawDeps = task["Depends On"] || "";
      rawDeps.split(",").map((s) => s.trim()).filter(Boolean).forEach((depSN) => {
        // Normalise: strip decimals SheetJS may add (e.g. "22.0" → "22")
        const normDep = String(parseFloat(depSN) || depSN);
        const di = snIndex.get(normDep) ?? snIndex.get(depSN);
        if (di === undefined) return;
        const dep = scheduledTasks[di];
        if (!dep._end) return;
        arrows.push({
          fx: taskX(dep) + taskW(dep),
          fy: di * rowH + rowH / 2,
          tx: taskX(task),
          ty: ti * rowH + rowH / 2,
          key: `${depSN}->${task["Serial Number"]}`,
        });
      });
    });
    return arrows;
  }

  const workloadData = useMemo(() => resources.map((person) => {
    const tasks = scheduledTasks.filter((t) => assignments[t["Serial Number"]] === person);
    const finish = tasks.reduce((mx, t) => (t._end > mx ? t._end : mx), projectStart);
    const totalDays = tasks.reduce((s, t) => s + (parseInt(t["Days"]) || 1), 0);
    return { person, tasks, finish, totalDays };
  }), [scheduledTasks, assignments, resources, projectStart]);

  const unassigned = scheduledTasks.filter((t) => !assignments[t["Serial Number"]]);

  function addResource() {
    const r = newResource.trim();
    if (!r) return;

    const updatedResources = [...new Set([...resources, r])];
    setResources(updatedResources);
    setNewResource("");

    // Rebalance: distribute unassigned tasks across all resources by load (fewest days first)
    setAssignments((prev) => {
      const next = { ...prev };

      // Count current days per person
      const load = {};
      updatedResources.forEach((p) => (load[p] = 0));
      rawTasks.forEach((t) => {
        const p = next[t["Serial Number"]];
        if (p && load[p] !== undefined) load[p] += parseInt(t["Days"]) || 1;
      });

      // Assign unassigned tasks to the least-loaded person
      rawTasks.forEach((t) => {
        const sn = t["Serial Number"];
        if (!next[sn]) {
          const lightest = updatedResources.reduce((a, b) => (load[a] <= load[b] ? a : b));
          next[sn] = lightest;
          load[lightest] += parseInt(t["Days"]) || 1;
        }
      });

      return next;
    });
  }

  function optimizeAndRedistributeTasks() {
    setUndoHistory(h => [...h, { assignments: { ...assignments } }]);
    const next = levelOptimize(filteredRaw, resources, assignments, progress, holidays, vacMap, projectStart);
    setAssignments(next);
  }

  function undoOptimization() {
    if (undoHistory.length === 0) return;
    const previousState = undoHistory[undoHistory.length - 1];
    setUndoHistory((prev) => prev.slice(0, -1));
    setAssignments(previousState.assignments);
  }

  function exportCSV() {
    const headers = ["Serial Number", "Category", "Description", "Depends On", "Status", "Complexity", "Days", "Start Date", "End Date", "Assignee", "Integration Effort"];
    const rows = scheduledTasks.map((t) => [
      t["Serial Number"], t["Category"], t["Description"], t["Depends On"],
      getStatus(t["Serial Number"]), t["Complexity"], t["Days"], t._start, t._end,
      assignments[t["Serial Number"]] || "", t["Integration Effort"],
    ]);
    const csvCell = (c) => { const s = String(c ?? ""); return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "gantt_scheduled.csv";
    a.click();
  }

  async function exportXLSX() {
    const wb = new ExcelJS.Workbook();

    // ── Sheet 1: Schedule ──
    const scheduleHeaders = ["Serial Number", "Category", "Description", "Depends On", "Status", "Complexity", "Days", "Start Date", "End Date", "Assignee", "Progress %", "Integration Effort"];
    const scheduleRows = scheduledTasks.map((t) => [
      t["Serial Number"], t["Category"], t["Description"], t["Depends On"],
      getStatus(t["Serial Number"]), t["Complexity"], t["Days"], t._start, t._end,
      assignments[t["Serial Number"]] || "",
      progress[t["Serial Number"]] ?? 0,
      t["Integration Effort"],
    ]);
    const schedWS = wb.addWorksheet("Schedule");
    schedWS.addRow(scheduleHeaders);
    scheduleRows.forEach((r) => schedWS.addRow(r));
    [14, 22, 50, 14, 14, 12, 8, 12, 12, 16, 12, 18].forEach((w, i) => { schedWS.getColumn(i + 1).width = w; });

    // ── Sheet 2: Session (everything needed to restore state) ──
    const sessionRows = [
      ["GANTT SESSION DATA — import this file to restore your work"],
      [],
      ["PROJECT START", projectStart],
      ["THEME", themeKey],
      [],
      ["RESOURCES"],
      ...resources.map((r) => [r]),
      [],
      ["PUBLIC HOLIDAYS"],
      ...holidays.map((h) => [h]),
      [],
      ["VACATION DAYS", "Person", "Date"],
      ...Object.entries(vacMap).flatMap(([person, dates]) =>
        dates.map((d) => ["", person, d])
      ),
      [],
      ["ASSIGNMENTS", "Serial Number", "Assignee"],
      ...Object.entries(assignments).map(([sn, person]) => ["", sn, person]),
      [],
      ["PROGRESS", "Serial Number", "Percent"],
      ...Object.entries(progress).map(([sn, pct]) => ["", sn, pct]),
      [],
      ["STATUSES", "Serial Number", "Status"],
      ...Object.entries(taskStatuses).map(([sn, st]) => ["", sn, st]),
    ];
    const sessWS = wb.addWorksheet("Session");
    sessionRows.forEach((r) => sessWS.addRow(r));
    [30, 20, 20].forEach((w, i) => { sessWS.getColumn(i + 1).width = w; });

    // ── Sheet 3: Workload summary ──
    const workloadHeaders = ["Person", "Tasks", "Total Days", "Finishes"];
    const workloadRows = workloadData.map((w) => [w.person, w.tasks.length, w.totalDays, w.finish]);
    const wlWS = wb.addWorksheet("Workload");
    wlWS.addRow(workloadHeaders);
    workloadRows.forEach((r) => wlWS.addRow(r));
    [20, 10, 12, 14].forEach((w, i) => { wlWS.getColumn(i + 1).width = w; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gantt_session.xlsx";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (screen === "import") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", color: C.text }}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500&family=DM+Sans:wght@300;400;600&display=swap" rel="stylesheet" />
        <div style={{ width: 540, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button onClick={() => setThemeKey((k) => k === "dark" ? "light" : "dark")}
              style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 13 }}>
              {themeKey === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
          </div>
          <div style={{ fontSize: 10, letterSpacing: 5, color: C.muted, marginBottom: 18, fontFamily: "'DM Mono', monospace", textTransform: "uppercase" }}>Project Scheduler</div>
          <h1 style={{ fontSize: 46, fontWeight: 300, margin: "0 0 8px", letterSpacing: -2 }}>Team Gantt</h1>
          <p style={{ color: C.muted, marginBottom: 48, fontSize: 14 }}>Upload your Excel or CSV workplan</p>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current.click()}
            style={{
              border: `2px dashed ${dragOver ? C.accent : C.border}`, borderRadius: 16,
              padding: "60px 40px", cursor: "pointer",
              background: dragOver ? C.accentDim + "55" : C.surface,
              transition: "all 0.2s", marginBottom: 24,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 16 }}>Drop your .xlsx or .csv file here</div>
            <div style={{ color: C.muted, fontSize: 13 }}>or click to browse</div>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
          </div>

          <div style={{ fontSize: 11, color: C.muted, background: C.surface, borderRadius: 10, padding: "16px 20px", textAlign: "left", border: `1px solid ${C.border}` }}>
            <div style={{ color: C.text, marginBottom: 8, fontWeight: 600 }}>Drop a task file or a saved session:</div>
            <div style={{ marginBottom: 10, lineHeight: 1.7 }}>
              <span style={{ color: C.accent }}>Session XLSX</span> — restores your full work (assignments, progress, holidays, resources)<br />
              <span style={{ color: C.accent }}>Task XLSX / CSV</span> — imports a fresh task list
            </div>
            <div style={{ color: C.text, marginBottom: 6, fontWeight: 600 }}>Expected task columns:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["Serial Number", "Category", "Description", "Depends On", "Status", "Complexity", "Days", "Assignee", "Integration Effort"].map((col) => (
                <span key={col} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 8px", fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{col}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── MAIN APP ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500&family=DM+Sans:wght@300;400;600&display=swap" rel="stylesheet" />
      <style>{`
        input[type="date"]::-webkit-calendar-picker-indicator {
          filter: invert(1) sepia(1) saturate(3) hue-rotate(${themeKey === "dark" ? "195deg" : "210deg"});
          opacity: 0.8;
          cursor: pointer;
        }
        input[type="date"]::-webkit-calendar-picker-indicator:hover {
          opacity: 1;
        }
      `}</style>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", padding: "0 20px", height: 52, borderBottom: `1px solid ${C.border}`, gap: 20, flexShrink: 0, background: C.surface }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: 3, color: C.accent }}>GANTT</div>
        <div style={{ display: "flex", gap: 2 }}>
          {["gantt", "workload", "settings"].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: tab === t ? C.accentDim : "none", border: "none",
              color: tab === t ? C.accent : C.muted,
              padding: "5px 14px", borderRadius: 6, cursor: "pointer",
              fontSize: 12, fontWeight: tab === t ? 600 : 400, textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: C.muted }}>
          Predicted finish: <span style={{ color: C.green, fontFamily: "'DM Mono', monospace" }}>{projectEnd}</span>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {["week", "month"].map((z) => (
            <button key={z} onClick={() => setZoom(z)} style={{
              background: zoom === z ? C.border : "none", border: "none",
              color: zoom === z ? C.text : C.muted,
              padding: "4px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11,
            }}>{z}</button>
          ))}
        </div>
        <button onClick={() => setThemeKey((k) => k === "dark" ? "light" : "dark")}
          style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 13 }}>
          {themeKey === "dark" ? "☀️" : "🌙"}
        </button>
        <button onClick={() => setAddTaskModal({ initialSerial: generateSerial(rawTasks) })} style={{ background: C.green, border: "none", color: "#fff", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ Task</button>
        {rawTasks.some(t => !assignments[t["Serial Number"]]) && (
          <button onClick={() => askConfirm(`Delete all ${rawTasks.filter(t => !assignments[t["Serial Number"]]).length} unassigned task(s)?`, deleteAllUnassigned)} style={{ background: "none", border: `1px solid ${C.red}`, color: C.red, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600 }} title="Delete all tasks with no assignee">✕ Unassigned</button>
        )}
        <button onClick={optimizeAndRedistributeTasks} style={{ background: C.accent, border: "none", color: "#fff", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600 }} title="Optimize: Redistribute Test & Development tasks to minimize end date">⚡ Optimize</button>
        {undoHistory.length > 0 && (
          <button onClick={undoOptimization} style={{ background: C.yellow, border: "none", color: C.bg, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600 }} title="Undo last optimization">↶ Undo</button>
        )}
        <button onClick={() => setScreen("import")} style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 11 }}>↑ Import</button>
      </div>

      {/* ── GANTT TAB ── */}
      {tab === "gantt" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Category filter */}
          <div style={{ display: "flex", gap: 6, padding: "8px 16px", borderBottom: `1px solid ${C.border}`, overflowX: "auto", flexShrink: 0, background: C.surface + "88" }}>
            {categories.map((cat) => (
              <button key={cat} onClick={() => setFilterCategory(cat)} style={{
                background: filterCategory === cat ? C.accent : C.card,
                border: `1px solid ${filterCategory === cat ? C.accent : C.border}`,
                color: filterCategory === cat ? "#fff" : C.muted,
                borderRadius: 20, padding: "3px 12px", cursor: "pointer", fontSize: 11, whiteSpace: "nowrap",
              }}>{cat}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: "auto" }}>
            <div style={{ display: "flex", minWidth: labelW + totalW }}>

              {/* Label column */}
              <div style={{ width: labelW, flexShrink: 0, borderRight: `1px solid ${C.border}` }}>
                <div style={{ height: 56, display: "flex", alignItems: "flex-end", padding: "0 12px 8px", borderBottom: `1px solid ${C.border}`, background: C.surface, gap: 6, position: "sticky", top: 0, zIndex: 3 }}>
                  <span style={{ fontSize: 10, color: C.muted, width: 26, fontFamily: "'DM Mono', monospace" }}>#</span>
                  <span style={{ fontSize: 10, color: C.muted, flex: 1 }}>Description</span>
                  <span style={{ fontSize: 10, color: C.muted, width: 80 }}>Assignee</span>
                  <span style={{ fontSize: 10, color: C.muted, width: 28, textAlign: "right" }}>Days</span>
                </div>
                {scheduledTasks.map((task, i) => {
                  const sn = task["Serial Number"];
                  const currentStatus = getStatus(sn);
                  const sc = statusColor(currentStatus, themeKey);
                  const completed = isTaskCompleted(sn);
                  const isUnassigned = !assignments[sn];
                  return (
                    <div key={sn} style={{
                      height: rowH, display: "flex", alignItems: "center", padding: "0 12px", gap: 6,
                      borderBottom: `1px solid ${C.border}18`,
                      background: completed ? C.green + "0d" : isUnassigned ? UNASSIGNED_COLOR[themeKey] + "14" : i % 2 === 0 ? "transparent" : C.surface + "55",
                    }}>
                      <span style={{ width: 26, fontSize: 10, color: C.muted, fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{sn}</span>
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <div style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: completed ? C.muted : C.text }} title={task["Description"]}>{task["Description"]}</div>
                        <select
                          value={currentStatus}
                          onChange={(e) => setTaskStatus(sn, e.target.value)}
                          style={{ fontSize: 9, color: sc, background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginTop: 1 }}
                        >
                          {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <select
                        value={assignments[sn] || ""}
                        onChange={(e) => setAssignments((a) => ({ ...a, [sn]: e.target.value }))}
                        disabled={completed}
                        style={{ width: 86, background: C.card, border: `1px solid ${C.border}`, color: completed ? C.muted : C.text, borderRadius: 4, fontSize: 10, padding: "2px 4px", flexShrink: 0, opacity: completed ? 0.5 : 1 }}
                      >
                        <option value="">— unset</option>
                        {resources.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <span style={{ width: 28, fontSize: 10, color: C.muted, textAlign: "right", flexShrink: 0 }}>{task["Days"]}d</span>
                      <button
                        onClick={() => askConfirm(`Delete task ${sn}?`, () => deleteTask(sn))}
                        title="Delete task"
                        style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: "0 2px", fontSize: 13, lineHeight: 1, flexShrink: 0, opacity: 0.4 }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = C.red; e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = C.muted; e.currentTarget.style.opacity = "0.4"; }}
                      >×</button>
                    </div>
                  );
                })}
              </div>

              {/* Timeline */}
              <div style={{ flex: 1, position: "relative", minWidth: totalW }}>
                {/* Group header */}
                <div style={{ height: 32, display: "flex", background: C.surface, borderBottom: `1px solid ${C.border}28`, position: "sticky", top: 0, zIndex: 2 }}>
                  {headerGroups.map((g, gi) => (
                    <div key={gi} style={{
                      width: g.count * colW, borderRight: `1px solid ${C.border}44`, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, color: C.muted, fontFamily: "'DM Mono', monospace", overflow: "hidden", whiteSpace: "nowrap",
                    }}>{g.label}</div>
                  ))}
                </div>
                {/* Day header */}
                <div style={{ height: 24, display: "flex", background: C.surface + "bb", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 32, zIndex: 2 }}>
                  {workDates.map((d, i) => (
                    <div key={i} style={{
                      width: colW, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 8, color: C.muted + "88", borderRight: `1px solid ${C.border}18`,
                    }}>{zoom === "week" ? d.getDate() : ""}</div>
                  ))}
                </div>

                {/* SVG: grid lines + today (behind bars) */}
                <svg style={{ position: "absolute", top: 56, left: 0, pointerEvents: "none" }} width={totalW} height={totalH}>
                  {workDates.map((_, i) => (
                    <line key={i} x1={i * colW} y1={0} x2={i * colW} y2={totalH} stroke={C.border} strokeWidth={0.4} strokeOpacity={0.5} />
                  ))}
                  {scheduledTasks.map((_, i) => (
                    <line key={i} x1={0} y1={i * rowH} x2={totalW} y2={i * rowH} stroke={C.border} strokeWidth={0.3} strokeOpacity={0.35} />
                  ))}
                  {todayIdx >= 0 && (
                    <line x1={todayIdx * colW} y1={0} x2={todayIdx * colW} y2={totalH}
                      stroke={C.yellow} strokeWidth={1.5} strokeDasharray="4 3" strokeOpacity={0.75} />
                  )}
                </svg>

                {/* Bars */}
                <div style={{ position: "relative", zIndex: 1 }}>
                  {scheduledTasks.map((task, i) => {
                    const x = taskX(task);
                    const w = taskW(task);
                    const pct = progress[task["Serial Number"]] ?? 0;
                    const isTest = isTestTask(task["Description"]);
                    const sn = task["Serial Number"];
                    const isUnassigned = !assignments[sn];
                    const col = isTest ? C.purple : isUnassigned ? UNASSIGNED_COLOR[themeKey] : heatColor(dependentCount[sn] || 0, themeKey);
                    return (
                      <div key={task["Serial Number"]} style={{
                        height: rowH, position: "relative",
                        background: i % 2 === 0 ? "transparent" : C.surface + "44",
                      }}>
                        <div style={{
                          position: "absolute", left: x, top: 8, width: w, height: rowH - 16,
                          background: col + "30",
                          borderWidth: 1, borderStyle: isUnassigned && !isTest ? "dashed" : "solid",
                          borderColor: col + "88", borderRadius: 4,
                          overflow: "hidden",
                        }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: col + "44" }} />
                          {w > 44 && (
                            <div style={{
                              position: "absolute", inset: 0, display: "flex", alignItems: "center",
                              paddingLeft: 6, gap: 4, fontSize: 9, color: col, overflow: "hidden", whiteSpace: "nowrap",
                              fontFamily: "'DM Mono', monospace",
                            }}>
                              {isTest && (
                                <span style={{ background: col, color: "#fff", borderRadius: 3, padding: "1px 4px", fontSize: 8, fontWeight: 700, flexShrink: 0 }}>TEST</span>
                              )}
                              {isUnassigned && !isTest && (
                                <span style={{ background: col, color: "#fff", borderRadius: 3, padding: "1px 4px", fontSize: 8, fontWeight: 700, flexShrink: 0 }}>UNSET</span>
                              )}
                              {pct > 0 ? `${pct}% · ` : ""}{task["Description"]?.slice(0, 22)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* SVG: dependency arrows (above bars) */}
                <svg style={{ position: "absolute", top: 56, left: 0, pointerEvents: "none", overflow: "visible", zIndex: 2 }} width={totalW} height={totalH}>
                  {getArrows().map((a) => {
                    // Smooth cubic bezier: horizontal tangents at both ends
                    let d;
                    if (a.tx > a.fx) {
                      // Normal: dep ends before dependent starts — S-curve
                      const cp = Math.min((a.tx - a.fx) / 2, colW * 4);
                      d = `M${a.fx},${a.fy} C${a.fx + cp},${a.fy} ${a.tx - cp},${a.ty} ${a.tx},${a.ty}`;
                    } else {
                      // Overlap/back-ref: route around with a wide U-curve
                      const bend = Math.max(colW * 2, a.fx - a.tx + colW * 2);
                      d = `M${a.fx},${a.fy} C${a.fx + bend},${a.fy} ${a.tx - bend},${a.ty} ${a.tx},${a.ty}`;
                    }
                    const ah = 5;
                    const arrowPts = `${a.tx},${a.ty} ${a.tx - ah},${a.ty - ah * 0.6} ${a.tx - ah},${a.ty + ah * 0.6}`;
                    return (
                      <g key={a.key}>
                        <path d={d} fill="none" stroke={C.accent} strokeWidth={1.5} strokeOpacity={0.55} />
                        <polygon points={arrowPts} fill={C.accent} fillOpacity={0.75} />
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>

          {/* Progress sliders */}
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 20px", display: "flex", gap: 14, overflowX: "auto", background: C.surface, flexShrink: 0, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: C.muted, whiteSpace: "nowrap", fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>% DONE</span>
            {scheduledTasks.slice(0, 18).map((task) => (
              <div key={task["Serial Number"]} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 52 }}>
                <span style={{ fontSize: 9, color: C.muted, fontFamily: "'DM Mono', monospace" }}>{task["Serial Number"]}</span>
                <input type="range" min={0} max={100} step={5}
                  value={progress[task["Serial Number"]] ?? 0}
                  onChange={(e) => setProgress((p) => ({ ...p, [task["Serial Number"]]: Number(e.target.value) }))}
                  style={{ width: 52, accentColor: C.accent }} />
                <span style={{ fontSize: 9, color: C.accent, fontFamily: "'DM Mono', monospace" }}>{progress[task["Serial Number"]] ?? 0}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── WORKLOAD TAB ── */}
      {tab === "workload" && (
        <div
          style={{ flex: 1, overflow: "auto", padding: 32, background: C.bg, position: "relative" }}
          onClick={() => setContextMenu(null)}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <h2 style={{ fontWeight: 400, margin: 0, color: C.text }}>Resource Workload</h2>
            <div style={{ fontSize: 13, color: C.muted }}>
              Overall finish: <strong style={{ color: C.green, fontFamily: "'DM Mono', monospace" }}>{projectEnd}</strong>
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 24 }}>
            Drag tasks between workers to reassign, or right-click a task for options.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
            {workloadData.map((w) => {
              const isOver = dragOverPerson === w.person;
              return (
                <div
                  key={w.person}
                  onDragOver={(e) => { e.preventDefault(); setDragOverPerson(w.person); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverPerson(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingTask && draggingTask.fromPerson !== w.person && !isTaskCompleted(draggingTask.sn)) {
                      setAssignments((a) => ({ ...a, [draggingTask.sn]: w.person }));
                    }
                    setDraggingTask(null);
                    setDragOverPerson(null);
                  }}
                  style={{
                    background: isOver ? C.accentDim : C.card,
                    border: `2px solid ${isOver ? C.accent : C.border}`,
                    borderRadius: 12, padding: 20,
                    transition: "border-color 0.15s, background 0.15s",
                    minHeight: 120,
                  }}
                >
                  {/* Person header */}
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>{w.person}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        {w.tasks.length} tasks · {w.totalDays} days
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 9, color: C.muted, fontFamily: "'DM Mono', monospace" }}>FINISHES</div>
                        <div style={{ fontSize: 12, color: C.green, fontFamily: "'DM Mono', monospace", marginTop: 2 }}>{w.finish}</div>
                      </div>
                      {w.tasks.some(t => !isTaskCompleted(t["Serial Number"])) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); askConfirm(`Unassign all tasks from ${w.person}?`, () => unassignAllForPerson(w.person), "Unassign"); }}
                          style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: 10 }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.yellow; e.currentTarget.style.color = C.yellow; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
                          title={`Unassign all tasks from ${w.person}`}
                        >Unassign all</button>
                      )}
                    </div>
                  </div>

                  {/* Workload bar */}
                  {w.totalDays > 0 && (() => {
                    const maxDays = Math.max(...workloadData.map((x) => x.totalDays), 1);
                    const pct = Math.round((w.totalDays / maxDays) * 100);
                    const barColor = pct > 80 ? C.red : pct > 50 ? C.yellow : C.green;
                    return (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 2, transition: "width 0.3s" }} />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Task list */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {w.tasks.map((t) => {
                      const sn = t["Serial Number"];
                      const currentStatus = getStatus(sn);
                      const sc = statusColor(currentStatus, themeKey);
                      const isDragging = draggingTask?.sn === sn;
                      const isCtxOpen = contextMenu?.sn === sn;
                      const isTest = isTestTask(t["Description"]);
                      const isUnassigned = !assignments[sn];
                      const taskColor = isTest ? C.purple : isUnassigned ? UNASSIGNED_COLOR[themeKey] : heatColor(dependentCount[sn] || 0, themeKey);
                      const completed = isTaskCompleted(sn);
                      return (
                        <div
                          key={sn}
                          draggable={!completed}
                          onDragStart={() => { if (!completed) setDraggingTask({ sn, fromPerson: w.person }); }}
                          onDragEnd={() => { setDraggingTask(null); setDragOverPerson(null); }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu({ sn, x: e.clientX, y: e.clientY, currentPerson: w.person });
                          }}
                          style={{
                            display: "flex", gap: 8, alignItems: "center",
                            background: completed ? C.green + "18" : isCtxOpen ? C.accentDim : isDragging ? C.accentDim : isTest ? C.purple + "18" : isUnassigned ? taskColor + "18" : taskColor + "18",
                            border: `1px solid ${completed ? C.green + "88" : isCtxOpen ? C.accent : isDragging ? C.accent : isTest ? C.purple + "88" : isUnassigned ? taskColor + "88" : taskColor + "55"}`,
                            borderStyle: isUnassigned && !isTest && !completed && !isCtxOpen && !isDragging ? "dashed" : "solid",
                            borderRadius: 6, padding: "6px 10px",
                            cursor: completed ? "default" : "grab", opacity: isDragging ? 0.5 : 1,
                            transition: "opacity 0.15s, border-color 0.15s, background 0.15s",
                            userSelect: "none",
                          }}
                        >
                          <span style={{ fontSize: 9, color: C.muted, fontFamily: "'DM Mono', monospace", width: 20, flexShrink: 0 }}>
                            {sn}
                          </span>
                          {isTest && (
                            <span style={{ background: C.purple, color: "#fff", borderRadius: 3, padding: "1px 4px", fontSize: 8, fontWeight: 700, flexShrink: 0 }}>
                              TEST
                            </span>
                          )}
                          {completed && (
                            <span style={{ background: C.green, color: "#fff", borderRadius: 3, padding: "1px 4px", fontSize: 8, fontWeight: 700, flexShrink: 0 }}>
                              DONE
                            </span>
                          )}
                          <span style={{ fontSize: 11, flex: 1, lineHeight: 1.35, color: completed ? C.muted : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t["Description"]}>
                            {t["Description"]}
                          </span>
                          <span style={{ fontSize: 9, color: taskColor, whiteSpace: "nowrap", flexShrink: 0, fontFamily: "'DM Mono', monospace" }}>
                            {t["Days"]}d
                          </span>
                          {!completed && <span style={{ fontSize: 9, color: C.muted, flexShrink: 0 }}>⠿</span>}
                        </div>
                      );
                    })}
                    {/* Drop hint */}
                    {isOver && draggingTask?.fromPerson !== w.person && (
                      <div style={{
                        border: `2px dashed ${C.accent}`, borderRadius: 6, padding: "10px",
                        textAlign: "center", fontSize: 11, color: C.accent, marginTop: 4,
                      }}>
                        Drop here to assign
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* ── Unassigned card ── */}
            {unassigned.length > 0 && (() => {
              const isOver = dragOverPerson === "__unassigned__";
              const unassignedColor = UNASSIGNED_COLOR[themeKey];
              return (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOverPerson("__unassigned__"); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverPerson(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingTask && !isTaskCompleted(draggingTask.sn)) {
                      setAssignments((a) => { const n = { ...a }; delete n[draggingTask.sn]; return n; });
                    }
                    setDraggingTask(null);
                    setDragOverPerson(null);
                  }}
                  style={{
                    background: isOver ? unassignedColor + "22" : C.card,
                    border: `2px dashed ${isOver ? unassignedColor : unassignedColor + "88"}`,
                    borderRadius: 12, padding: 20,
                    transition: "border-color 0.15s, background 0.15s",
                    minHeight: 120,
                  }}
                >
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: unassignedColor }}>Unassigned</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        {unassigned.length} task{unassigned.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); askConfirm(`Delete all ${unassigned.length} unassigned task(s)?`, deleteAllUnassigned); }}
                      style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: 10, alignSelf: "flex-start" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
                    >Delete all</button>
                  </div>

                  {/* Task list */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {unassigned.map((t) => {
                      const sn = t["Serial Number"];
                      const isDragging = draggingTask?.sn === sn;
                      const isCtxOpen = contextMenu?.sn === sn;
                      const isTest = isTestTask(t["Description"]);
                      const taskColor = isTest ? C.purple : unassignedColor;
                      return (
                        <div
                          key={sn}
                          draggable
                          onDragStart={() => setDraggingTask({ sn, fromPerson: null })}
                          onDragEnd={() => { setDraggingTask(null); setDragOverPerson(null); }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu({ sn, x: e.clientX, y: e.clientY, currentPerson: null });
                          }}
                          style={{
                            display: "flex", gap: 8, alignItems: "center",
                            background: isCtxOpen ? C.accentDim : isDragging ? C.accentDim : taskColor + "18",
                            border: `1px dashed ${isCtxOpen ? C.accent : isDragging ? C.accent : taskColor + "88"}`,
                            borderStyle: isCtxOpen || isDragging ? "solid" : "dashed",
                            borderRadius: 6, padding: "6px 10px",
                            cursor: "grab", opacity: isDragging ? 0.5 : 1,
                            transition: "opacity 0.15s, border-color 0.15s, background 0.15s",
                            userSelect: "none",
                          }}
                        >
                          <span style={{ fontSize: 9, color: C.muted, fontFamily: "'DM Mono', monospace", width: 20, flexShrink: 0 }}>{sn}</span>
                          {isTest && (
                            <span style={{ background: C.purple, color: "#fff", borderRadius: 3, padding: "1px 4px", fontSize: 8, fontWeight: 700, flexShrink: 0 }}>TEST</span>
                          )}
                          <span style={{ fontSize: 11, flex: 1, lineHeight: 1.35, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t["Description"]}>
                            {t["Description"]}
                          </span>
                          <span style={{ fontSize: 9, color: taskColor, whiteSpace: "nowrap", flexShrink: 0, fontFamily: "'DM Mono', monospace" }}>{t["Days"]}d</span>
                          <span style={{ fontSize: 9, color: C.muted, flexShrink: 0 }}>⠿</span>
                        </div>
                      );
                    })}
                    {isOver && draggingTask && (
                      <div style={{ border: `2px dashed ${unassignedColor}`, borderRadius: 6, padding: "10px", textAlign: "center", fontSize: 11, color: unassignedColor, marginTop: 4 }}>
                        Drop here to unassign
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ── Context menu ── */}
          {contextMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 1000,
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 10, overflow: "hidden",
                boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
                minWidth: 200,
              }}
            >
              {/* Header */}
              <div style={{ padding: "10px 14px 8px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                  {rawTasks.find((t) => t["Serial Number"] === contextMenu.sn)?.["Description"] || `Task ${contextMenu.sn}`}
                </div>
              </div>
              {/* Status options */}
              <div style={{ padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ padding: "6px 14px 4px", fontSize: 10, color: C.muted, fontFamily: "'DM Mono', monospace" }}>STATUS</div>
                {TASK_STATUSES.map((s) => {
                  const isCurrent = getStatus(contextMenu.sn) === s;
                  const sColor = statusColor(s, themeKey);
                  return (
                    <div
                      key={s}
                      onClick={() => { setTaskStatus(contextMenu.sn, s); setContextMenu(null); }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "7px 14px", cursor: "pointer",
                        background: isCurrent ? sColor + "22" : "transparent",
                        color: isCurrent ? sColor : C.text,
                        fontSize: 12, transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = isCurrent ? sColor + "22" : C.surface; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = isCurrent ? sColor + "22" : "transparent"; }}
                    >
                      <span>{s}</span>
                      {isCurrent && <span style={{ fontSize: 9, color: sColor, fontFamily: "'DM Mono', monospace" }}>✓</span>}
                    </div>
                  );
                })}
              </div>
              {/* Assign to options (disabled when completed) */}
              {!isTaskCompleted(contextMenu.sn) && (
                <>
                  <div style={{ padding: "6px 14px 4px", fontSize: 10, color: C.muted, fontFamily: "'DM Mono', monospace" }}>ASSIGN TO</div>
                  <div style={{ padding: "0 0 4px" }}>
                    {resources.map((person) => {
                      const isCurrent = person === contextMenu.currentPerson;
                      return (
                        <div
                          key={person}
                          onClick={() => {
                            if (!isCurrent) setAssignments((a) => ({ ...a, [contextMenu.sn]: person }));
                            setContextMenu(null);
                          }}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "7px 14px", cursor: isCurrent ? "default" : "pointer",
                            background: isCurrent ? C.accentDim : "transparent",
                            color: isCurrent ? C.accent : C.text,
                            fontSize: 12, transition: "background 0.1s",
                          }}
                          onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = C.surface; }}
                          onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
                        >
                          <span>{person}</span>
                          {isCurrent && <span style={{ fontSize: 9, color: C.accent, fontFamily: "'DM Mono', monospace" }}>current</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ borderTop: `1px solid ${C.border}`, padding: "4px 0" }}>
                    <div
                      onClick={() => {
                        setAssignments((a) => { const n = { ...a }; delete n[contextMenu.sn]; return n; });
                        setContextMenu(null);
                      }}
                      style={{ padding: "7px 14px", cursor: "pointer", color: C.red, fontSize: 12, transition: "background 0.1s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.surface; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      Unassign
                    </div>
                  </div>
                </>
              )}
              {/* Delete task */}
              <div style={{ borderTop: `1px solid ${C.border}`, padding: "4px 0" }}>
                <div
                  onClick={() => { const sn = contextMenu.sn; setContextMenu(null); askConfirm(`Delete task ${sn}?`, () => deleteTask(sn)); }}
                  style={{ padding: "7px 14px", cursor: "pointer", color: C.red, fontSize: 12, fontWeight: 600, transition: "background 0.1s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.red + "18"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  Delete task
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "settings" && (
        <div style={{ flex: 1, overflow: "auto", padding: 32, background: C.bg }}>
          <h2 style={{ fontWeight: 400, marginBottom: 32, color: C.text }}>Settings</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, maxWidth: 820 }}>

            <div>
              <SLabel C={C}>PROJECT START DATE</SLabel>
              <input type="date" value={projectStart} onChange={(e) => { if (e.target.value) setProjectStart(e.target.value); }} style={makeIStyle(C)} />
            </div>

            <div>
              <SLabel C={C}>TEAM RESOURCES</SLabel>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input value={newResource} onChange={(e) => setNewResource(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addResource()}
                  placeholder="Name…" style={{ ...makeIStyle(C), flex: 1 }} />
                <SBtn C={C} onClick={addResource}>Add</SBtn>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {resources.map((r) => (
                  <SChip C={C} key={r} onX={() => setResources((rs) => rs.filter((x) => x !== r))}>{r}</SChip>
                ))}
              </div>
            </div>

            <div>
              <SLabel C={C}>PUBLIC HOLIDAYS</SLabel>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} style={{ ...makeIStyle(C), flex: 1 }} />
                <SBtn C={C} onClick={() => { if (newHoliday) { setHolidays((h) => [...new Set([...h, newHoliday])]); setNewHoliday(""); } }}>Add</SBtn>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {holidays.map((h) => (
                  <SChip C={C} key={h} mono onX={() => setHolidays((hs) => hs.filter((x) => x !== h))}>{h}</SChip>
                ))}
              </div>
            </div>

            <div>
              <SLabel C={C}>VACATION DAYS</SLabel>
              {resources.map((r) => (
                <div key={r} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, marginBottom: 6, color: C.text }}>{r}</div>
                  <input type="date" style={{ ...makeIStyle(C), marginBottom: 6 }}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const v = e.target.value;
                      setVacMap((vm) => ({ ...vm, [r]: [...new Set([...(vm[r] || []), v])] }));
                      e.target.value = "";
                    }} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {(vacMap[r] || []).map((d) => (
                      <SChip C={C} key={d} mono small onX={() => setVacMap((vm) => ({ ...vm, [r]: vm[r].filter((x) => x !== d) }))}>{d}</SChip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 40, borderTop: `1px solid ${C.border}`, paddingTop: 28 }}>
            <SLabel C={C}>EXPORT</SLabel>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
              <strong style={{ color: C.text }}>Save Session (XLSX)</strong> saves your full work — assignments, progress, holidays, vacations — so you can reload it next time.<br />
              <strong style={{ color: C.text }}>CSV</strong> exports the schedule only. <strong style={{ color: C.text }}>PDF</strong> prints the current view.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <SBtn C={C} onClick={exportXLSX}>💾 Save Session (XLSX)</SBtn>
              <SBtn C={C} onClick={exportCSV}>Export CSV</SBtn>
              <SBtn C={C} onClick={() => window.print()}>Print / PDF</SBtn>
            </div>
          </div>
        </div>
      )}

      {addTaskModal && (
        <AddTaskModal
          initialSerial={addTaskModal.initialSerial}
          resources={resources}
          rawTasks={rawTasks}
          categories={categories}
          C={C}
          onSubmit={submitNewTask}
          onClose={() => setAddTaskModal(null)}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
          onCancel={() => setConfirmDialog(null)}
          C={C}
        />
      )}
    </div>
  );
}

// ── Mini UI components ─────────────────────────────────────────────────────────
function makeIStyle(C) {
  return { background: C.inputBg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: "8px 12px", fontSize: 13, width: "100%", boxSizing: "border-box" };
}

function SLabel({ children, C }) {
  return <div style={{ fontSize: 10, letterSpacing: 2, color: C.muted, marginBottom: 10, fontFamily: "'DM Mono', monospace" }}>{children}</div>;
}
function SBtn({ onClick, children, C }) {
  return <button onClick={onClick} style={{ background: C.accent, border: "none", color: "#fff", borderRadius: 8, padding: "8px 18px", cursor: "pointer", fontSize: 12 }}>{children}</button>;
}
function SChip({ children, onX, mono, small, C }) {
  return (
    <span style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 20,
      padding: small ? "2px 8px" : "4px 12px", fontSize: small ? 10 : 11,
      fontFamily: mono ? "'DM Mono', monospace" : "inherit",
      display: "inline-flex", alignItems: "center", gap: 5, color: C.text,
    }}>
      {children}
      <button onClick={onX} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
    </span>
  );
}
