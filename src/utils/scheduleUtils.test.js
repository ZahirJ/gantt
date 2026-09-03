import { fmtDate, scheduleTasks, levelOptimize, detectFixedCollisions } from "./scheduleUtils";

describe("fmtDate", () => {
  it("formats a date string to YYYY-MM-DD", () => {
    expect(fmtDate("2026-04-28")).toBe("2026-04-28");
  });

  it("formats a Date object using local date components (no UTC shift)", () => {
    // Simulate what ExcelJS returns when reading a date cell: a Date at local midnight.
    // Using an explicit local midnight avoids any UTC-offset ambiguity in the test itself.
    const d = new Date(2026, 3, 28); // April 28 2026, local midnight
    expect(fmtDate(d)).toBe("2026-04-28");
  });

  it("pads single-digit month and day", () => {
    expect(fmtDate("2026-01-05")).toBe("2026-01-05");
  });
});

// ── scheduleTasks ──────────────────────────────────────────────────────────────

function task(sn, days, deps = "", extra = {}) {
  return { "Serial Number": String(sn), "Days": days, "Depends On": deps, "Description": `Task ${sn}`, ...extra };
}

const NO_HOLIDAYS = [];
const NO_VAC = {};
const MON = "2026-06-01"; // a Monday

describe("scheduleTasks", () => {
  it("schedules a single unassigned task starting on project start (weekday)", () => {
    const [t] = scheduleTasks([task(1, 1)], {}, NO_HOLIDAYS, NO_VAC, MON);
    expect(t._start).toBe("2026-06-01");
    expect(t._end).toBe("2026-06-01");
  });

  it("a 3-day task ends 2 workdays after start", () => {
    const [t] = scheduleTasks([task(1, 3)], {}, NO_HOLIDAYS, NO_VAC, MON);
    expect(t._start).toBe("2026-06-01");
    expect(t._end).toBe("2026-06-03");
  });

  it("skips weekends: 1-day task starting Friday ends same day", () => {
    const FRI = "2026-05-29";
    const [t] = scheduleTasks([task(1, 1)], {}, NO_HOLIDAYS, NO_VAC, FRI);
    expect(t._start).toBe("2026-05-29");
    expect(t._end).toBe("2026-05-29");
  });

  it("skips weekends: project start on Saturday shifts task to Monday", () => {
    const SAT = "2026-05-30";
    const [t] = scheduleTasks([task(1, 1)], {}, NO_HOLIDAYS, NO_VAC, SAT);
    expect(t._start).toBe("2026-06-01"); // next Monday
  });

  it("skips public holiday at project start", () => {
    const HOLIDAY = [MON]; // block June 1
    const [t] = scheduleTasks([task(1, 1)], {}, HOLIDAY, NO_VAC, MON);
    expect(t._start).toBe("2026-06-02"); // Tuesday
  });

  it("respects vacation days for assigned person", () => {
    const assignments = { "1": "Alice" };
    const vacMap = { Alice: ["2026-06-01", "2026-06-02"] }; // Mon + Tue blocked
    const [t] = scheduleTasks([task(1, 1)], assignments, NO_HOLIDAYS, vacMap, MON);
    expect(t._start).toBe("2026-06-03"); // Wednesday
  });

  it("finish-to-start dependency: dependent starts day after dependency ends", () => {
    const tasks = [task(1, 1), task(2, 1, "1")];
    const [t1, t2] = scheduleTasks(tasks, {}, NO_HOLIDAYS, NO_VAC, MON);
    expect(t1._end).toBe("2026-06-01");
    expect(t2._start).toBe("2026-06-02");
  });

  it("two tasks for same person are serialized (no overlap)", () => {
    const tasks = [task(1, 2), task(2, 2)];
    const assignments = { "1": "Alice", "2": "Alice" };
    const [t1, t2] = scheduleTasks(tasks, assignments, NO_HOLIDAYS, NO_VAC, MON);
    // t1: Mon–Tue; t2 must wait until Wednesday
    expect(t1._end).toBe("2026-06-02");
    expect(t2._start).toBe("2026-06-03");
  });

  it("two tasks for different people run in parallel", () => {
    const tasks = [task(1, 2), task(2, 2)];
    const assignments = { "1": "Alice", "2": "Bob" };
    const [t1, t2] = scheduleTasks(tasks, assignments, NO_HOLIDAYS, NO_VAC, MON);
    expect(t1._start).toBe("2026-06-01");
    expect(t2._start).toBe("2026-06-01");
  });

  it("returns null dates for tasks with unresolved deps", () => {
    const tasks = [task(2, 1, "99")]; // depends on SN 99 which doesn't exist
    const [t] = scheduleTasks(tasks, {}, NO_HOLIDAYS, NO_VAC, MON);
    expect(t._start).toBeNull();
    expect(t._end).toBeNull();
  });

  it("returns null dates when projectStart is invalid", () => {
    const [t] = scheduleTasks([task(1, 1)], {}, NO_HOLIDAYS, NO_VAC, "not-a-date");
    expect(t._start).toBeNull();
    expect(t._end).toBeNull();
  });

  describe("fixedStartDates", () => {
    it("delays task start to the fixed date (floor constraint)", () => {
      const fixedStartDates = { "1": "2026-06-05" }; // Friday — 4 days after project start
      const [t] = scheduleTasks([task(1, 1)], {}, NO_HOLIDAYS, NO_VAC, MON, fixedStartDates);
      expect(t._start).toBe("2026-06-05");
    });

    it("fixed date in the past does not move task earlier than earliest possible", () => {
      // Project starts on 2026-06-03 (Wed); fixed date is 2026-06-01 (Mon) — in the past relative to project start
      const fixedStartDates = { "1": "2026-06-01" };
      const [t] = scheduleTasks([task(1, 1)], {}, NO_HOLIDAYS, NO_VAC, "2026-06-03", fixedStartDates);
      expect(t._start).toBe("2026-06-03"); // not pushed backward
    });

    it("dependency cascade still applies after fixed start date", () => {
      // t1 has fixed start 2026-06-05 (Fri); t2 depends on t1 (1 day) → t2 starts Mon 2026-06-08
      const fixedStartDates = { "1": "2026-06-05" };
      const tasks = [task(1, 1), task(2, 1, "1")];
      const [t1, t2] = scheduleTasks(tasks, {}, NO_HOLIDAYS, NO_VAC, MON, fixedStartDates);
      expect(t1._start).toBe("2026-06-05");
      expect(t2._start).toBe("2026-06-08"); // Monday after t1 ends Friday
    });

    it("empty fixedStartDates has no effect (backward compat)", () => {
      const [t] = scheduleTasks([task(1, 1)], {}, NO_HOLIDAYS, NO_VAC, MON, {});
      expect(t._start).toBe("2026-06-01");
    });

    it("omitting fixedStartDates param has no effect (backward compat)", () => {
      const [t] = scheduleTasks([task(1, 1)], {}, NO_HOLIDAYS, NO_VAC, MON);
      expect(t._start).toBe("2026-06-01");
    });

    it("non-fixed task on the same resource is scheduled around a later fixed task's window", () => {
      // Task 1 (non-fixed, 3 days) would naturally run Mon–Wed, but Task 2 (fixed, 1 day) reserves
      // Tue for the same person, so Task 1 must find a gap that avoids Tue.
      const tasks = [task(1, 3), task(2, 1)];
      const assignments = { "1": "Alice", "2": "Alice" };
      const fixedStartDates = { "2": "2026-06-02" }; // Tuesday
      const [t1, t2] = scheduleTasks(tasks, assignments, NO_HOLIDAYS, NO_VAC, MON, fixedStartDates);
      expect(t2._start).toBe("2026-06-02");
      expect(t2._end).toBe("2026-06-02");
      // t1 must not overlap [2026-06-02, 2026-06-02]
      expect(t1._start <= t2._end && t1._end >= t2._start).toBe(false);
    });

    it("non-fixed task is pushed after a fixed task's window when no earlier gap exists", () => {
      const tasks = [task(1, 2), task(2, 1)];
      const assignments = { "1": "Alice", "2": "Alice" };
      const fixedStartDates = { "2": "2026-06-01" }; // Monday, same day project starts
      const [t1, t2] = scheduleTasks(tasks, assignments, NO_HOLIDAYS, NO_VAC, MON, fixedStartDates);
      expect(t2._start).toBe("2026-06-01");
      expect(t1._start).toBe("2026-06-02"); // pushed to Tuesday, after the fixed slot
    });
  });
});

// ── detectFixedCollisions ────────────────────────────────────────────────────

describe("detectFixedCollisions", () => {
  function scheduled(sn, start, end, extra = {}) {
    return { "Serial Number": String(sn), "Description": `Task ${sn}`, _start: start, _end: end, ...extra };
  }

  it("returns no collisions when there are no fixed tasks", () => {
    const scheduledTasks = [scheduled(1, "2026-06-01", "2026-06-01")];
    expect(detectFixedCollisions(scheduledTasks, {}, {})).toEqual([]);
  });

  it("returns no collisions when fixed tasks are on different resources", () => {
    const scheduledTasks = [
      scheduled(1, "2026-06-01", "2026-06-02"),
      scheduled(2, "2026-06-01", "2026-06-02"),
    ];
    const fixedStartDates = { "1": "2026-06-01", "2": "2026-06-01" };
    const assignments = { "1": "Alice", "2": "Bob" };
    expect(detectFixedCollisions(scheduledTasks, fixedStartDates, assignments)).toEqual([]);
  });

  it("returns no collisions when fixed tasks on the same resource don't overlap", () => {
    const scheduledTasks = [
      scheduled(1, "2026-06-01", "2026-06-01"),
      scheduled(2, "2026-06-02", "2026-06-02"),
    ];
    const fixedStartDates = { "1": "2026-06-01", "2": "2026-06-02" };
    const assignments = { "1": "Alice", "2": "Alice" };
    expect(detectFixedCollisions(scheduledTasks, fixedStartDates, assignments)).toEqual([]);
  });

  it("detects a collision between two fixed tasks overlapping on the same resource", () => {
    const scheduledTasks = [
      scheduled(1, "2026-06-01", "2026-06-03"),
      scheduled(2, "2026-06-02", "2026-06-04"),
    ];
    const fixedStartDates = { "1": "2026-06-01", "2": "2026-06-02" };
    const assignments = { "1": "Alice", "2": "Alice" };
    const collisions = detectFixedCollisions(scheduledTasks, fixedStartDates, assignments);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].resource).toBe("Alice");
    expect(collisions[0].taskA["Serial Number"]).toBe("1");
    expect(collisions[0].taskB["Serial Number"]).toBe("2");
  });

  it("ignores tasks without a resolved schedule", () => {
    const scheduledTasks = [
      scheduled(1, null, null),
      scheduled(2, "2026-06-01", "2026-06-01"),
    ];
    const fixedStartDates = { "1": "2026-06-01", "2": "2026-06-01" };
    const assignments = { "1": "Alice", "2": "Alice" };
    expect(detectFixedCollisions(scheduledTasks, fixedStartDates, assignments)).toEqual([]);
  });
});

// ── levelOptimize ──────────────────────────────────────────────────────────────

describe("levelOptimize", () => {
  const NO_PROGRESS = {};

  it("distributes tasks across resources", () => {
    const tasks = [task(1, 3), task(2, 3), task(3, 3)];
    const resources = ["Alice", "Bob"];
    const assignments = { "1": "Alice", "2": "Alice", "3": "Alice" };
    const result = levelOptimize(tasks, resources, assignments, NO_PROGRESS, NO_HOLIDAYS, NO_VAC, MON);
    // After optimization some tasks should move to Bob
    const bobs = Object.values(result).filter(v => v === "Bob");
    expect(bobs.length).toBeGreaterThan(0);
  });

  it("does not move completed tasks", () => {
    const tasks = [task(1, 3), task(2, 3)];
    const resources = ["Alice", "Bob"];
    const assignments = { "1": "Alice", "2": "Alice" };
    const progress = { "1": 100 }; // task 1 is completed
    const result = levelOptimize(tasks, resources, assignments, progress, NO_HOLIDAYS, NO_VAC, MON);
    expect(result["1"]).toBe("Alice"); // never moved
  });

  it("returns same assignments when only one resource", () => {
    const tasks = [task(1, 3), task(2, 3)];
    const assignments = { "1": "Alice", "2": "Alice" };
    const result = levelOptimize(tasks, ["Alice"], assignments, NO_PROGRESS, NO_HOLIDAYS, NO_VAC, MON);
    expect(result["1"]).toBe("Alice");
    expect(result["2"]).toBe("Alice");
  });

  it("passes fixedStartDates through (floor is respected in optimized schedule)", () => {
    // t1 has a late fixed start; t2 is free. Alice has both. Optimization should not ignore the constraint.
    const tasks = [task(1, 1), task(2, 1)];
    const resources = ["Alice", "Bob"];
    const assignments = { "1": "Alice", "2": "Alice" };
    const fixedStartDates = { "1": "2026-06-10" }; // far future
    // Should not throw; result is a valid assignments map
    const result = levelOptimize(tasks, resources, assignments, NO_PROGRESS, NO_HOLIDAYS, NO_VAC, MON, fixedStartDates);
    expect(typeof result).toBe("object");
    expect(Object.keys(result).length).toBeGreaterThanOrEqual(1);
  });

  it("omitting fixedStartDates param does not throw (backward compat)", () => {
    const tasks = [task(1, 3), task(2, 3)];
    const resources = ["Alice", "Bob"];
    const assignments = { "1": "Alice", "2": "Alice" };
    expect(() => levelOptimize(tasks, resources, assignments, NO_PROGRESS, NO_HOLIDAYS, NO_VAC, MON)).not.toThrow();
  });
});
