import { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

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

function statusColor(s = "", theme = "dark") {
  return makeStatusColor(theme)[s.toLowerCase()] || THEMES[theme].muted;
}

const SIZE_DAYS = { S: 1, M: 3, L: 5, XL: 10 };

// ── File parsing ───────────────────────────────────────────────────────────────
function parseFile(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array" });

      // ── Detect session XLSX ──
      if (wb.SheetNames.includes("Session") && wb.SheetNames.includes("Schedule")) {
        const schedWS = wb.Sheets["Schedule"];
        const sessWS = wb.Sheets["Session"];
        const schedRows = XLSX.utils.sheet_to_json(schedWS, { defval: "", raw: false });
        const sessRaw = XLSX.utils.sheet_to_json(sessWS, { defval: "", raw: false, header: 1 });

        const tasks = normalizeTasks(schedRows);

        // Parse session sheet
        const session = { projectStart: null, themeKey: null, resources: [], holidays: [], vacMap: {}, assignments: {}, progress: {} };
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
          if (!cell0 && !cell1 && !cell2) { mode = null; continue; }
          if (mode === "resources" && cell0) session.resources.push(cell0);
          if (mode === "holidays" && cell0) session.holidays.push(cell0);
          if (mode === "vacations" && cell1 && cell2) {
            if (!session.vacMap[cell1]) session.vacMap[cell1] = [];
            session.vacMap[cell1].push(cell2);
          }
          if (mode === "assignments" && cell1) session.assignments[cell1] = cell2;
          if (mode === "progress" && cell1) session.progress[cell1] = Number(cell2);
        }

        // Override progress from Schedule sheet Progress % column
        schedRows.forEach((r) => {
          const sn = String(r["Serial Number"] ?? "").trim();
          const pct = Number(r["Progress %"]);
          if (sn && !isNaN(pct)) session.progress[sn] = pct;
        });

        callback(null, tasks, session);
        return;
      }

      // ── Regular task file ──
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
      callback(null, normalizeTasks(rows), null);
    } catch (err) {
      callback(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

function normalizeTasks(rows) {
  return rows.map((row, idx) => {
    // Serial Number may be a formula like =ROW()-1 — use row index as fallback
    let serial = String(row["Serial Number"] ?? "").trim();
    if (!serial || serial.startsWith("=") || isNaN(Number(serial))) serial = String(idx + 1);

    // Depends On: 0 or "" = no dependency; otherwise comma/semicolon list of serials
    let depsRaw = String(row["Depends On"] ?? "").trim();
    const deps = depsRaw.split(/[,;]+/).map((s) => s.trim()).filter((s) => s && s !== "0").join(",");

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

// ── Scheduling helpers ─────────────────────────────────────────────────────────
function fmtDate(d) { return new Date(d).toISOString().slice(0, 10); }

function isWorkday(date, holidays, vacMap, person) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  const iso = fmtDate(date);
  if (holidays.includes(iso)) return false;
  if (person && vacMap[person]?.includes(iso)) return false;
  return true;
}

function nextWorkday(date, holidays, vacMap, person) {
  const d = new Date(date);
  while (!isWorkday(d, holidays, vacMap, person)) d.setDate(d.getDate() + 1);
  return d;
}

function addWorkdays(date, extraDays, holidays, vacMap, person) {
  let d = new Date(date);
  let added = 0;
  while (added < extraDays) {
    d.setDate(d.getDate() + 1);
    if (isWorkday(d, holidays, vacMap, person)) added++;
  }
  return d;
}

function scheduleTasks(rawTasks, assignments, holidays, vacMap, projectStart) {
  const tasks = rawTasks.map((t) => ({ ...t, _start: null, _end: null }));
  const done = new Set();
  let safety = tasks.length * 4;

  while (done.size < tasks.length && safety-- > 0) {
    for (const task of tasks) {
      const sn = task["Serial Number"];
      if (done.has(sn)) continue;
      const deps = (task["Depends On"] || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!deps.every((d) => done.has(d))) continue;

      // earliest start from dependency ends
      let earliest = new Date(projectStart);
      for (const depSN of deps) {
        const dep = tasks.find((t) => t["Serial Number"] === depSN);
        if (dep?._end) {
          const de = new Date(dep._end);
          de.setDate(de.getDate() + 1); // day after dep ends
          if (de > earliest) earliest = new Date(de);
        }
      }

      // person's next free day
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

  function loadTasks(tasks) {
    setRawTasks(tasks);
    const a = {};
    tasks.forEach((t) => { if (t["Assignee"]) a[t["Serial Number"]] = t["Assignee"]; });
    setAssignments(a);
    const p = {};
    tasks.forEach((t) => {
      const s = (t["Status"] || "").toLowerCase();
      p[t["Serial Number"]] = s === "completed" ? 100 : s === "in progress" ? 50 : 0;
    });
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
    const arrows = [];
    scheduledTasks.forEach((task, ti) => {
      (task["Depends On"] || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((depSN) => {
        const dep = scheduledTasks.find((t) => t["Serial Number"] === depSN);
        if (!dep?._end) return;
        const fx = taskX(dep) + taskW(dep);
        const fy = scheduledTasks.indexOf(dep) * rowH + rowH / 2;
        const tx = taskX(task);
        const ty = ti * rowH + rowH / 2;
        arrows.push({ fx, fy, tx, ty, key: `${depSN}->${task["Serial Number"]}` });
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
    // Save current state to undo history
    const previousState = { assignments: { ...assignments } };
    setUndoHistory((prev) => [...prev, previousState]);

    const optimized = { ...assignments };

    // Identify redistributable tasks: only "Test" and "Development" category tasks
    const redistributable = filteredRaw.filter((t) => {
      const cat = (t["Category"] || "").toLowerCase();
      const isTestOrDev = cat === "test" || cat === "development";
      // Only redistribute if originally assigned (don't move unassigned)
      const hasOriginalAssignee = t["Assignee"];
      return isTestOrDev && hasOriginalAssignee;
    });

    // Calculate current load per resource (total days)
    const load = {};
    resources.forEach((r) => (load[r] = 0));
    filteredRaw.forEach((t) => {
      const sn = t["Serial Number"];
      const days = parseInt(t["Days"]) || 1;
      const assignee = optimized[sn];
      if (assignee && load[assignee] !== undefined) {
        load[assignee] += days;
      }
    });

    // Redistribute test/dev tasks to balance load (least-loaded person)
    redistributable.forEach((task) => {
      const sn = task["Serial Number"];
      const days = parseInt(task["Days"]) || 1;
      const currentAssignee = optimized[sn];

      // Find least-loaded resource
      const leastLoaded = resources.reduce((a, b) => (load[a] <= load[b] ? a : b));

      // Only reassign if it would improve load balance
      if (leastLoaded !== currentAssignee && load[leastLoaded] < load[currentAssignee]) {
        // Check if dependencies are satisfied (all dependencies assigned to valid people)
        const deps = (task["Depends On"] || "").split(",").map((s) => s.trim()).filter(Boolean);
        const depsValid = deps.every((depSn) => {
          const depTask = filteredRaw.find((t) => t["Serial Number"] === depSn);
          return depTask && optimized[depSn]; // Dependencies must have assignees
        });

        if (depsValid) {
          // Update load accounting
          if (currentAssignee && load[currentAssignee] !== undefined) {
            load[currentAssignee] -= days;
          }
          load[leastLoaded] += days;
          optimized[sn] = leastLoaded;
        }
      }
    });

    // Apply optimized assignments
    setAssignments(optimized);
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
      t["Status"], t["Complexity"], t["Days"], t._start, t._end,
      assignments[t["Serial Number"]] || "", t["Integration Effort"],
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "gantt_scheduled.csv";
    a.click();
  }

  function exportXLSX() {
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Schedule ──
    const scheduleHeaders = ["Serial Number", "Category", "Description", "Depends On", "Status", "Complexity", "Days", "Start Date", "End Date", "Assignee", "Progress %", "Integration Effort"];
    const scheduleRows = scheduledTasks.map((t) => [
      t["Serial Number"], t["Category"], t["Description"], t["Depends On"],
      t["Status"], t["Complexity"], t["Days"], t._start, t._end,
      assignments[t["Serial Number"]] || "",
      progress[t["Serial Number"]] ?? 0,
      t["Integration Effort"],
    ]);
    const scheduleWS = XLSX.utils.aoa_to_sheet([scheduleHeaders, ...scheduleRows]);
    // Column widths
    scheduleWS["!cols"] = [
      { wch: 14 }, { wch: 22 }, { wch: 50 }, { wch: 14 }, { wch: 14 },
      { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(wb, scheduleWS, "Schedule");

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
    ];
    const sessionWS = XLSX.utils.aoa_to_sheet(sessionRows);
    sessionWS["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, sessionWS, "Session");

    // ── Sheet 3: Workload summary ──
    const workloadHeaders = ["Person", "Tasks", "Total Days", "Finishes"];
    const workloadRows = workloadData.map((w) => [w.person, w.tasks.length, w.totalDays, w.finish]);
    const workloadWS = XLSX.utils.aoa_to_sheet([workloadHeaders, ...workloadRows]);
    workloadWS["!cols"] = [{ wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, workloadWS, "Workload");

    XLSX.writeFile(wb, "gantt_session.xlsx");
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
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
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
                  const sc = statusColor(task["Status"], themeKey);
                  return (
                    <div key={task["Serial Number"]} style={{
                      height: rowH, display: "flex", alignItems: "center", padding: "0 12px", gap: 6,
                      borderBottom: `1px solid ${C.border}18`,
                      background: i % 2 === 0 ? "transparent" : C.surface + "55",
                    }}>
                      <span style={{ width: 26, fontSize: 10, color: C.muted, fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{task["Serial Number"]}</span>
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <div style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={task["Description"]}>{task["Description"]}</div>
                        <div style={{ fontSize: 9, color: sc, marginTop: 1 }}>{task["Status"]}</div>
                      </div>
                      <select
                        value={assignments[task["Serial Number"]] || ""}
                        onChange={(e) => setAssignments((a) => ({ ...a, [task["Serial Number"]]: e.target.value }))}
                        style={{ width: 86, background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, fontSize: 10, padding: "2px 4px", flexShrink: 0 }}                      >
                        <option value="">— unset</option>
                        {resources.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <span style={{ width: 28, fontSize: 10, color: C.muted, textAlign: "right", flexShrink: 0 }}>{task["Days"]}d</span>
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

                {/* SVG: grid + arrows + today */}
                <svg style={{ position: "absolute", top: 56, left: 0, pointerEvents: "none", overflow: "visible" }} width={totalW} height={totalH}>
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
                  {getArrows().map((a) => {
                    const cx = a.fx + Math.min(colW * 2, Math.abs(a.tx - a.fx) / 2);
                    return (
                      <g key={a.key}>
                        <path d={`M${a.fx},${a.fy} C${cx},${a.fy} ${cx},${a.ty} ${a.tx},${a.ty}`}
                          fill="none" stroke={C.purple} strokeWidth={1.2} strokeOpacity={0.5} />
                        <polygon points={`${a.tx},${a.ty} ${a.tx - 5},${a.ty - 3} ${a.tx - 5},${a.ty + 3}`}
                          fill={C.purple} fillOpacity={0.5} />
                      </g>
                    );
                  })}
                </svg>

                {/* Bars */}
                <div style={{ position: "relative", zIndex: 1 }}>
                  {scheduledTasks.map((task, i) => {
                    const x = taskX(task);
                    const w = taskW(task);
                    const pct = progress[task["Serial Number"]] ?? 0;
                    const col = statusColor(task["Status"], themeKey);
                    return (
                      <div key={task["Serial Number"]} style={{
                        height: rowH, position: "relative",
                        background: i % 2 === 0 ? "transparent" : C.surface + "44",
                      }}>
                        <div style={{
                          position: "absolute", left: x, top: 8, width: w, height: rowH - 16,
                          background: col + "25", border: `1px solid ${col}55`, borderRadius: 4,
                          overflow: "hidden",
                        }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: col + "44" }} />
                          {w > 44 && (
                            <div style={{
                              position: "absolute", inset: 0, display: "flex", alignItems: "center",
                              paddingLeft: 6, fontSize: 9, color: col, overflow: "hidden", whiteSpace: "nowrap",
                              fontFamily: "'DM Mono', monospace",
                            }}>
                              {pct > 0 ? `${pct}% · ` : ""}{task["Description"]?.slice(0, 22)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
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

          {unassigned.length > 0 && (
            <div style={{ background: C.yellow + "18", border: `1px solid ${C.yellow}44`, borderRadius: 8, padding: "10px 16px", marginBottom: 24, fontSize: 12, color: C.yellow }}>
              ⚠ {unassigned.length} task(s) unassigned — add them via the Gantt tab or add resources below
            </div>
          )}

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
                    if (draggingTask && draggingTask.fromPerson !== w.person) {
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
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 9, color: C.muted, fontFamily: "'DM Mono', monospace" }}>FINISHES</div>
                      <div style={{ fontSize: 12, color: C.green, fontFamily: "'DM Mono', monospace", marginTop: 2 }}>{w.finish}</div>
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
                      const sc = statusColor(t["Status"], themeKey);
                      const isDragging = draggingTask?.sn === t["Serial Number"];
                      const isCtxOpen = contextMenu?.sn === t["Serial Number"];
                      return (
                        <div
                          key={t["Serial Number"]}
                          draggable
                          onDragStart={() => setDraggingTask({ sn: t["Serial Number"], fromPerson: w.person })}
                          onDragEnd={() => { setDraggingTask(null); setDragOverPerson(null); }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu({ sn: t["Serial Number"], x: e.clientX, y: e.clientY, currentPerson: w.person });
                          }}
                          style={{
                            display: "flex", gap: 8, alignItems: "center",
                            background: isCtxOpen ? C.accentDim : isDragging ? C.accentDim : C.surface,
                            border: `1px solid ${isCtxOpen ? C.accent : isDragging ? C.accent : C.border}`,
                            borderRadius: 6, padding: "6px 10px",
                            cursor: "grab", opacity: isDragging ? 0.5 : 1,
                            transition: "opacity 0.15s, border-color 0.15s, background 0.15s",
                            userSelect: "none",
                          }}
                        >
                          <span style={{ fontSize: 9, color: C.muted, fontFamily: "'DM Mono', monospace", width: 20, flexShrink: 0 }}>
                            {t["Serial Number"]}
                          </span>
                          <span style={{ fontSize: 11, flex: 1, lineHeight: 1.35, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t["Description"]}>
                            {t["Description"]}
                          </span>
                          <span style={{ fontSize: 9, color: sc, whiteSpace: "nowrap", flexShrink: 0, fontFamily: "'DM Mono', monospace" }}>
                            {t["Days"]}d
                          </span>
                          <span style={{ fontSize: 9, color: C.muted, flexShrink: 0 }}>⠿</span>
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
                <div style={{ fontSize: 10, color: C.muted, fontFamily: "'DM Mono', monospace", marginBottom: 2 }}>ASSIGN TO</div>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                  {rawTasks.find((t) => t["Serial Number"] === contextMenu.sn)?.["Description"] || `Task ${contextMenu.sn}`}
                </div>
              </div>
              {/* Resource options */}
              <div style={{ padding: "4px 0" }}>
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
                        padding: "8px 14px", cursor: isCurrent ? "default" : "pointer",
                        background: isCurrent ? C.accentDim : "transparent",
                        color: isCurrent ? C.accent : C.text,
                        fontSize: 13,
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = C.surface; }}
                      onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span>{person}</span>
                      {isCurrent && <span style={{ fontSize: 10, color: C.accent, fontFamily: "'DM Mono', monospace" }}>current</span>}
                    </div>
                  );
                })}
              </div>
              {/* Unassign option */}
              <div style={{ borderTop: `1px solid ${C.border}`, padding: "4px 0" }}>
                <div
                  onClick={() => {
                    setAssignments((a) => { const n = { ...a }; delete n[contextMenu.sn]; return n; });
                    setContextMenu(null);
                  }}
                  style={{
                    padding: "8px 14px", cursor: "pointer", color: C.red, fontSize: 13,
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.surface; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  Unassign
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
              <input type="date" value={projectStart} onChange={(e) => setProjectStart(e.target.value)} style={makeIStyle(C)} />
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
