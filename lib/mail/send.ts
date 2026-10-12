// The ONLY module allowed to send subscriber email (CLAUDE.md §4). Its first
// action is the send gate. Delivery via Resend arrives in Phase 7.
import { assertSendAllowed } from "@/lib/approval/fsm";

export class SendNotImplementedError extends Error {
  constructor() {
    super("sendIssue: email delivery is implemented in Phase 7");
    this.name = "SendNotImplementedError";
  }
}

export async function sendIssue(issueId: string): Promise<never> {
  await assertSendAllowed(issueId);
  throw new SendNotImplementedError();
}
