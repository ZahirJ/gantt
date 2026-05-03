import { fmtDate } from "./scheduleUtils";

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
