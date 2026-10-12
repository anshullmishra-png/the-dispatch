import { describe, expect, it } from "vitest";
import { nextCronRun, upcomingJobs } from "@/lib/site/schedule";

describe("nextCronRun", () => {
  it("finds the next matching UTC minute", () => {
    // Mon 12 Oct 2026 14:00 UTC → ingest (Mon–Wed 03:00) next fires Tue 13 Oct 03:00 UTC.
    expect(nextCronRun("0 3 * * 1-3", new Date("2026-10-12T14:00:00Z")).toISOString()).toBe("2026-10-13T03:00:00.000Z");
    // Send (Thu 02:00) from Monday → Thu 15 Oct.
    expect(nextCronRun("0 2 * * 4", new Date("2026-10-12T14:00:00Z")).toISOString()).toBe("2026-10-15T02:00:00.000Z");
  });

  it("counts an exact match as due now, and skips to next week after it", () => {
    expect(nextCronRun("0 2 * * 4", new Date("2026-10-15T02:00:00Z")).toISOString()).toBe("2026-10-15T02:00:00.000Z");
    expect(nextCronRun("0 2 * * 4", new Date("2026-10-15T02:00:30Z")).toISOString()).toBe("2026-10-22T02:00:00.000Z");
  });

  it("supports lists", () => {
    expect(nextCronRun("30 1,13 * * *", new Date("2026-10-12T02:00:00Z")).toISOString()).toBe("2026-10-12T13:30:00.000Z");
  });
});

describe("upcomingJobs", () => {
  it("lists all five jobs from vercel.json, soonest first", () => {
    const jobs = upcomingJobs(new Date("2026-10-12T14:00:00Z"));
    expect(jobs.map((j) => j.job)).toEqual(["ingest", "curate", "notify", "remind", "send"]);
    expect(jobs[0]?.next.toISOString()).toBe("2026-10-13T03:00:00.000Z");
  });
});
