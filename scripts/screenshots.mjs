// Regenerates the README screenshots in docs/screenshots/ from a fictional demo project.
//
//   npm run screenshots
//
// Writes examples/demo-project.xlsx (a session file anyone can import to explore the app),
// starts its own Vite dev server, loads the demo in headless Google Chrome with the clock
// frozen so dates are reproducible, and captures each screen in the dark theme.
// Uses the locally installed Google Chrome (channel "chrome"), so no browser download is needed.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { chromium } from "playwright";
import { createServer } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const DEMO_FILE = path.join(ROOT, "examples", "demo-project.xlsx");
const CONFLICT_FILE = path.join(OUT_DIR, ".conflict-demo.xlsx"); // temp, deleted at the end
const TODAY = "2026-09-24T10:00:00";

// ── Fictional demo project ────────────────────────────────────────────────────

const EPIC = (key) => `https://example.atlassian.net/browse/${key}`;

// [sn, category, description, dependsOn, complexity, days, assignee, status, progress, epic]
const TASKS = [
  ["1", "Design", "Research user needs", "", "M", 4, "Alice", "Completed", 100, EPIC("WEB-101")],
  ["2", "Design", "Wireframes and design system", "1", "L", 6, "Alice", "In Progress", 60, EPIC("WEB-101")],
  ["3", "Backend", "Content API", "", "L", 8, "Ben", "In Progress", 40, EPIC("WEB-102")],
  ["4", "Backend", "Add tests for content API", "3", "M", 3, "Ben", "Open", 0, EPIC("WEB-102")],
  ["5", "Backend", "Search service", "3", "L", 7, "Chen", "Open", 0, ""],
  ["6", "Frontend", "Page templates", "2", "L", 8, "Dana", "Open", 0, EPIC("WEB-103")],
  ["7", "Frontend", "Search UI", "5,6", "M", 4, "Dana", "Open", 0, ""],
  ["8", "Frontend", "Add tests for search UI", "7", "S", 2, "Chen", "Open", 0, ""],
  ["9", "Backend", "Content migration", "4", "M", 5, "Ben", "Open", 0, ""],
  ["10", "QA", "Beta release", "7,9", "S", 2, "Chen", "Open", 0, EPIC("WEB-104")],
  ["11", "QA", "Accessibility review", "10", "M", 3, "Alice", "Open", 0, ""],
  ["12", "Launch", "Performance tuning", "10", "M", 4, "Ben", "Open", 0, ""],
  ["13", "Launch", "Launch announcement", "", "M", 3, "Alice", "Open", 0, EPIC("WEB-106")],
  ["14", "Launch", "Public launch", "11,12,13", "S", 2, "Dana", "Open", 0, EPIC("WEB-105")],
  ["15", "Frontend", "Analytics dashboard", "", "M", 4, "", "Open", 0, ""],
];

const DEMO = {
  projectName: "Website Relaunch",
  projectStart: "2026-09-07",
  resources: ["Alice", "Ben", "Chen", "Dana"],
  holidays: ["2026-10-12"],
  vacations: [["Ben", "2026-10-05"], ["Ben", "2026-10-06"], ["Dana", "2026-10-19"]],
  fixedStartDates: { "13": "2026-10-19" },
  milestones: ["10", "14"],
};

async function writeSessionFile(file, { extraFixed = {} } = {}) {
  const fixed = { ...DEMO.fixedStartDates, ...extraFixed };
  const wb = new ExcelJS.Workbook();

  const sched = wb.addWorksheet("Schedule");
  sched.addRow(["Serial Number", "Category", "Description", "Depends On", "Status", "Complexity", "Days", "Start Date", "End Date", "Assignee", "Progress %", "Integration Effort", "Fixed Start Date", "Key Milestone", "Epic"]);
  for (const [sn, cat, desc, deps, cx, days, who, status, pct, epic] of TASKS) {
    sched.addRow([sn, cat, desc, deps, status, cx, days, "", "", who, pct, "", fixed[sn] || "", DEMO.milestones.includes(sn) ? "true" : "", epic]);
  }

  const sess = wb.addWorksheet("Session");
  const rows = [
    ["GANTT SESSION DATA — import this file to restore your work"], [],
    ["PROJECT NAME", DEMO.projectName],
    ["PROJECT START", DEMO.projectStart], ["THEME", "dark"], [],
    ["RESOURCES"], ...DEMO.resources.map((r) => [r]), [],
    ["PUBLIC HOLIDAYS"], ...DEMO.holidays.map((h) => [h]), [],
    ["VACATION DAYS", "Person", "Date"], ...DEMO.vacations.map(([p, d]) => ["", p, d]), [],
    ["ASSIGNMENTS", "Serial Number", "Assignee"], ...TASKS.filter((t) => t[6]).map((t) => ["", t[0], t[6]]), [],
    ["PROGRESS", "Serial Number", "Percent"], ...TASKS.map((t) => ["", t[0], t[8]]), [],
    ["STATUSES", "Serial Number", "Status"], ...TASKS.map((t) => ["", t[0], t[7]]), [],
    ["FIXED START DATES", "Serial Number", "Date"], ...Object.entries(fixed).map(([sn, d]) => ["", sn, d]), [],
    ["MILESTONES", "Serial Number"], ...DEMO.milestones.map((sn) => ["", sn]),
  ];
  rows.forEach((r) => sess.addRow(r));
  wb.addWorksheet("Workload").addRow(["Person", "Tasks", "Total Days", "Finishes"]);

  await mkdir(path.dirname(file), { recursive: true });
  await wb.xlsx.writeFile(file);
}

// ── Capture ───────────────────────────────────────────────────────────────────

async function loadSession(page, url, file) {
  await page.goto(url);
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByTitle(/^Quick Save/).waitFor();
  await page.waitForTimeout(300); // let layout and arrows settle
}

async function shot(target, name, opts = {}) {
  await target.screenshot({ path: path.join(OUT_DIR, `${name}.png`), ...opts });
  console.log(`  ✓ ${name}.png`);
}

// Screenshot a padded region around one or more elements.
async function shotAround(page, locators, name, pad = 12) {
  const boxes = await Promise.all(locators.map((l) => l.boundingBox()));
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  await shot(page, name, { clip: { x, y, width: right - x, height: bottom - y } });
}

// The modal panel is the rounded card that contains the given title text.
const modalPanel = (page, title) =>
  page.getByText(title, { exact: true }).first().locator("xpath=ancestor::div[contains(@style,'border-radius: 14px')][1]");

async function closeModal(page) {
  await page.mouse.click(5, 5); // click the backdrop
  await page.waitForTimeout(150);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await writeSessionFile(DEMO_FILE);
  // Variant with a second fixed task on Alice overlapping the launch announcement → conflict banner
  await writeSessionFile(CONFLICT_FILE, { extraFixed: { "11": "2026-10-19" } });

  const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls.local[0];

  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1040 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(TODAY));

  try {
    console.log("Capturing screenshots →", path.relative(ROOT, OUT_DIR));

    // Start screen
    await page.goto(url);
    await page.getByText("New Project").waitFor();
    await shotAround(page, [page.getByRole("button", { name: /light/i }), page.getByText("Expected task columns:").locator("xpath=..")], "start-screen", 40);

    // Gantt
    await loadSession(page, url, DEMO_FILE);
    await shot(page, "gantt");

    // Toolbar close-up
    const quickSave = page.getByTitle(/^Quick Save/);
    const toolbar = quickSave.locator("xpath=..");
    await shotAround(page, [toolbar], "toolbar", 4);

    // Bar close-up: fixed date (FIX), Epic link, milestone line
    // Region spanning the Beta release → Public launch rows around the fixed-date bar,
    // so the milestone lines, FIX badge and Epic link are all in frame.
    const fixBadge = page.getByText("FIX", { exact: true }).first();
    await fixBadge.scrollIntoViewIfNeeded();
    const fixBox = await fixBadge.boundingBox();
    const top = await page.getByText("Beta release", { exact: true }).first().boundingBox();
    const epicBox = await page.getByRole("link", { name: "WEB-106" }).first().boundingBox();
    const bottom = await page.getByText("Public launch", { exact: true }).first().boundingBox();
    await shot(page, "bar-badges", { clip: { x: fixBox.x - 320, y: top.y - 14, width: epicBox.x + 360 - (fixBox.x - 320), height: bottom.y + bottom.height + 26 - (top.y - 14) } });

    // Gantt right-click menu
    await page.getByText("Search UI", { exact: true }).first().click({ button: "right" });
    const editItem = page.getByText("Edit task…", { exact: true });
    await editItem.waitFor();
    await shotAround(page, [page.getByText("Search UI", { exact: true }).first(), editItem, page.getByText("Delete task", { exact: true })], "context-menu", 24);

    // Edit Task modal
    await editItem.click();
    await page.waitForTimeout(200);
    await shot(modalPanel(page, "Edit Task"), "edit-task");
    await closeModal(page);

    // Add Task modal
    await page.getByRole("button", { name: "+ Task" }).click();
    await page.waitForTimeout(200);
    await shot(modalPanel(page, "Add Task"), "add-task");
    await closeModal(page);

    // Workload
    await page.getByRole("button", { name: /workload/i }).first().click();
    await page.getByText("Resource Workload").waitFor();
    await page.waitForTimeout(200);
    const cardsBottom = await page.getByText("Unassign all").evaluateAll((els) =>
      Math.max(...els.map((e) => e.closest("div[draggable], div").parentElement.closest("div").getBoundingClientRect().bottom)));
    const vw = page.viewportSize().width;
    await shot(page, "workload", { clip: { x: 0, y: 0, width: vw, height: Math.min(cardsBottom + 260, 1040) } });

    // Fixed-date conflict banner
    await loadSession(page, url, CONFLICT_FILE);
    const conflictRow = page.getByText("Fixed date conflict:").locator("xpath=..");
    const lastBtn = conflictRow.getByRole("button").last();
    await shotAround(page, [page.getByText("Fixed date conflict:"), lastBtn], "fixed-conflict", 14);
  } finally {
    await browser.close();
    await server.close();
    const { rm } = await import("node:fs/promises");
    await rm(CONFLICT_FILE, { force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
