// The send job's decision (docs/02 §6, R12): send a confirmed issue; hold and
// alert on anything else. Shared by the Thursday cron and Telegram "Send now".
import { canTransition, type IssueStatus, SendNotAllowedError, transition } from "@/lib/approval/fsm";
import type { Logger } from "@/lib/log";
import { alertShreya } from "@/lib/telegram/deliver";
import { formatIssueDateShort } from "@/lib/time";
import { type SendReport, sendIssue } from "./send";

export type SendOutcome =
  | { kind: "sent"; report: SendReport }
  | { kind: "partial"; report: SendReport }
  | { kind: "held"; reason: string }
  | { kind: "already_sent" };

export async function runSend(issue: { id: string; issueDate: string; status: IssueStatus }, log: Logger, deadline: number): Promise<SendOutcome> {
  const date = formatIssueDateShort(issue.issueDate);
  if (issue.status === "SENT") return { kind: "already_sent" };

  const hold = async (reason: string, body: string[]) => {
    if (canTransition(issue.status, "hold")) await transition(issue.id, "hold", { detail: { by: "send_job", reason } });
    await alertShreya(issue.id, `Not sent: ${date}`, body, log);
    return { kind: "held" as const, reason };
  };

  if (issue.status !== "CONFIRMED" && issue.status !== "SENDING") {
    return hold(`status_${issue.status.toLowerCase()}`, [
      `The issue was ${issue.status.replace("_", " ").toLowerCase()}, not confirmed, so no email went out.`,
      "It is now held. Review the cards, confirm, then tap Send now on the summary.",
    ]);
  }
  try {
    const report = await sendIssue(issue.id, { log, deadline, resuming: issue.status === "SENDING" });
    const c = report.counts;
    if (report.complete) {
      await alertShreya(
        issue.id,
        `Sent: ${date}`,
        [`Delivered to Resend: ${c.sent ?? 0} · skipped (demo mode): ${c.skipped_demo ?? 0} · failed: ${c.failed ?? 0}`],
        log,
      );
      return { kind: "sent", report };
    }
    return { kind: "partial", report };
  } catch (err) {
    if (err instanceof SendNotAllowedError) {
      return hold(err.failures.join(","), [`The send gate refused: ${err.failures.join(", ")}.`, "Nothing was sent. Re-confirm the draft if it is right."]);
    }
    throw err;
  }
}
