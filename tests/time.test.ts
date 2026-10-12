import { describe, expect, it } from "vitest";
import {
  addDays,
  collectingIssueDate,
  formatIssueDateShort,
  formatIstDateTime,
  isInWindow,
  isIsoDate,
  issueWindow,
  istDate,
  istToUtc,
  previousIssueDates,
  targetIssueDate,
  weekdayOf,
} from "@/lib/time";

// Week of Mon 12 Oct 2026 – Sun 18 Oct 2026; issue Thursday is 15 Oct.
const noonIst = (date: string) => istToUtc(date, 12);

describe("istToUtc / istDate", () => {
  it("converts IST wall-clock to UTC with the +05:30 offset", () => {
    expect(istToUtc("2026-10-15", 0).toISOString()).toBe("2026-10-14T18:30:00.000Z");
    expect(istToUtc("2026-10-15", 9, 1).toISOString()).toBe("2026-10-15T03:31:00.000Z");
  });

  it("reads the IST date, not the UTC date, around midnight", () => {
    // 18:29:59 UTC Wed is 23:59:59 IST Wed; 18:30 UTC Wed is already Thu in IST.
    expect(istDate(new Date("2026-10-14T18:29:59.999Z"))).toBe("2026-10-14");
    expect(istDate(new Date("2026-10-14T18:30:00.000Z"))).toBe("2026-10-15");
  });

  it("crosses month and year boundaries", () => {
    expect(istDate(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("formats IST date-times for logs", () => {
    expect(formatIstDateTime(new Date("2026-10-14T09:00:00Z"))).toBe("2026-10-14 14:30 IST");
  });

  it("rejects malformed and impossible dates", () => {
    expect(isIsoDate("2026-10-15")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("15-10-2026")).toBe(false);
    expect(() => istToUtc("2026-13-01")).toThrow();
  });
});

describe("collectingIssueDate", () => {
  it.each([
    ["2026-10-12", "Mon", "2026-10-15"],
    ["2026-10-13", "Tue", "2026-10-15"],
    ["2026-10-14", "Wed", "2026-10-15"],
    ["2026-10-15", "Thu", "2026-10-22"],
    ["2026-10-16", "Fri", "2026-10-22"],
    ["2026-10-17", "Sat", "2026-10-22"],
    ["2026-10-18", "Sun", "2026-10-22"],
  ])("%s (%s) collects for %s", (date, _day, expected) => {
    expect(collectingIssueDate(noonIst(date))).toBe(expected);
  });

  it("Wed 23:59 IST belongs to the current issue", () => {
    expect(collectingIssueDate(istToUtc("2026-10-14", 23, 59, 59, 999))).toBe("2026-10-15");
  });

  it("Thu 00:00 IST already belongs to the next issue (contiguous windows)", () => {
    expect(collectingIssueDate(istToUtc("2026-10-15", 0, 0))).toBe("2026-10-22");
  });

  it("Thu 09:01 IST belongs to the next issue", () => {
    expect(collectingIssueDate(istToUtc("2026-10-15", 9, 1))).toBe("2026-10-22");
  });

  it("follows the IST date when UTC is still the previous day", () => {
    expect(collectingIssueDate(new Date("2026-10-14T18:29:59Z"))).toBe("2026-10-15");
    expect(collectingIssueDate(new Date("2026-10-14T18:30:00Z"))).toBe("2026-10-22");
  });
});

describe("targetIssueDate", () => {
  it("Mon–Wed jobs target the coming Thursday", () => {
    expect(targetIssueDate(noonIst("2026-10-12"))).toBe("2026-10-15");
    expect(targetIssueDate(istToUtc("2026-10-14", 14, 30))).toBe("2026-10-15");
    expect(targetIssueDate(istToUtc("2026-10-14", 22, 30))).toBe("2026-10-15");
  });

  it("Thursday-morning send targets today's issue", () => {
    expect(targetIssueDate(istToUtc("2026-10-15", 7, 30))).toBe("2026-10-15");
    expect(targetIssueDate(istToUtc("2026-10-15", 8, 29))).toBe("2026-10-15");
  });

  it("Fri–Sun jobs target the following Thursday", () => {
    expect(targetIssueDate(noonIst("2026-10-16"))).toBe("2026-10-22");
    expect(targetIssueDate(noonIst("2026-10-18"))).toBe("2026-10-22");
  });
});

describe("issueWindow", () => {
  it("runs from previous Thu 00:00 IST to Wed 23:59:59.999 IST", () => {
    const { start, end } = issueWindow("2026-10-15");
    expect(start.toISOString()).toBe("2026-10-07T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-14T18:29:59.999Z");
  });

  it("consecutive windows touch with no gap or overlap", () => {
    const thisWeek = issueWindow("2026-10-15");
    const nextWeek = issueWindow("2026-10-22");
    expect(nextWeek.start.getTime() - thisWeek.end.getTime()).toBe(1);
  });

  it("agrees with collectingIssueDate at both edges", () => {
    const { start, end } = issueWindow("2026-10-15");
    expect(collectingIssueDate(start)).toBe("2026-10-15");
    expect(collectingIssueDate(end)).toBe("2026-10-15");
    expect(isInWindow(start, "2026-10-15")).toBe(true);
    expect(isInWindow(end, "2026-10-15")).toBe(true);
    expect(isInWindow(new Date(start.getTime() - 1), "2026-10-15")).toBe(false);
    expect(isInWindow(new Date(end.getTime() + 1), "2026-10-15")).toBe(false);
  });

  it("rejects a non-Thursday issue date", () => {
    expect(() => issueWindow("2026-10-14")).toThrow(/Thursday/);
  });
});

describe("previousIssueDates / formatIssueDateShort", () => {
  it("lists the four previous Thursdays, newest first", () => {
    expect(previousIssueDates("2026-10-15", 4)).toEqual([
      "2026-10-08",
      "2026-10-01",
      "2026-09-24",
      "2026-09-17",
    ]);
    expect(previousIssueDates("2026-10-15", 4).every((d) => weekdayOf(d) === 4)).toBe(true);
  });

  it("formats the short issue date", () => {
    expect(formatIssueDateShort("2026-10-15")).toBe("Thu 15 Oct");
  });
});
