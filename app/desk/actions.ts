"use server";

// Web desk actions. Each one: passcode session → the same review code the
// Telegram bot uses (same locks, audit trail, FSM and send gate) → Telegram sync.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConfirmRejectedError, IllegalTransitionError } from "@/lib/approval/fsm";
import { approveAll, confirmIssue, editStory, holdIssue, keepStory, lintEdit, ReviewError, removeStory, swapStory } from "@/lib/approval/review";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/log";
import { DESK_COOKIE, DESK_SESSION_HOURS, deskSessionValue, isDeskEditor, passcodeMatches } from "@/lib/site/desk-auth";
import { reviewErrorText } from "@/lib/telegram/handlers";
import { syncTelegram } from "@/lib/telegram/sync";

const log = createLogger({ route: "desk" });

function back(msg: string, anchor = ""): never {
  redirect(`/desk?msg=${encodeURIComponent(msg)}${anchor}`);
}

/** The desk acts as Shreya: the audit trail and the gate see her Telegram id. */
async function editor(): Promise<{ actorTgId: number }> {
  if (!(await isDeskEditor())) back("Sign in with the editor passcode first.");
  const id = Number(env().SHREYA_TG_USER_ID);
  if (!Number.isFinite(id)) back("SHREYA_TG_USER_ID is not configured.");
  return { actorTgId: id };
}

const field = (form: FormData, key: string) => String(form.get(key) ?? "");

async function run(fn: () => Promise<string>, anchor = ""): Promise<never> {
  let msg: string;
  try {
    msg = await fn();
  } catch (err) {
    if (err instanceof ReviewError) msg = reviewErrorText(err);
    else if (err instanceof ConfirmRejectedError) {
      msg = err.failures.includes("stories_pending")
        ? "Some stories are still pending. Keep, edit, swap or remove them, or approve all."
        : err.failures.includes("stale_card")
          ? "The draft changed after this page loaded. Here is the current version; confirm again."
          : `Can't confirm: ${err.failures.join(", ")}.`;
    } else if (err instanceof IllegalTransitionError) msg = `Not possible while the issue is ${err.from.toLowerCase().replace("_", " ")}.`;
    else {
      log.error("desk action failed", { err });
      msg = "Something went wrong. Try again.";
    }
  }
  back(msg, anchor);
}

export async function signIn(form: FormData) {
  if (!passcodeMatches(field(form, "passcode"))) back("That passcode is not right.");
  (await cookies()).set(DESK_COOKIE, deskSessionValue(env().ADMIN_TOKEN as string), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: DESK_SESSION_HOURS * 3600,
  });
  back("Signed in. You can edit this issue.");
}

export async function signOut() {
  (await cookies()).delete(DESK_COOKIE);
  back("Signed out.");
}

export async function keepAction(form: FormData) {
  const actor = await editor();
  const issueId = field(form, "issueId");
  const storyId = field(form, "storyId");
  return run(async () => {
    const { changed } = await keepStory(issueId, storyId, actor);
    await syncTelegram(issueId, { storyIds: [storyId] }, log);
    return changed ? "Kept." : "Already reviewed.";
  }, `#s-${storyId}`);
}

export async function editAction(form: FormData) {
  const actor = await editor();
  const issueId = field(form, "issueId");
  const storyId = field(form, "storyId");
  const text = field(form, "text").trim();
  const override = form.get("override") === "on";
  return run(async () => {
    const errors = await lintEdit(text);
    if (errors.length && !override) return `Voice check failed (${errors.join("; ")}). Fix it, or tick "Use anyway" and save again.`;
    const res = await editStory(issueId, storyId, text, { ...actor, lintOverride: errors });
    await syncTelegram(issueId, { storyIds: [storyId], voided: res.confirmationVoided }, log);
    return res.confirmationVoided ? "Saved. That change reset the confirmation: confirm again." : "Saved.";
  }, `#s-${storyId}`);
}

export async function swapAction(form: FormData) {
  const actor = await editor();
  const issueId = field(form, "issueId");
  const storyId = field(form, "storyId");
  const backupId = field(form, "backupId") || undefined;
  return run(async () => {
    const res = await swapStory(issueId, storyId, { ...actor, backupId });
    await syncTelegram(issueId, { storyIds: [res.oldId], newStoryId: res.replacementId, voided: res.confirmationVoided }, log);
    return `Story ${res.position} swapped.${res.spreadOk ? "" : " Warning: the picks now cover fewer than 3 topics."}${res.confirmationVoided ? " Confirm again." : ""}`;
  });
}

export async function removeAction(form: FormData) {
  const actor = await editor();
  const issueId = field(form, "issueId");
  const storyId = field(form, "storyId");
  return run(async () => {
    const res = await removeStory(issueId, storyId, actor);
    await syncTelegram(issueId, { allCards: true, voided: res.confirmationVoided }, log);
    return `Story ${res.position} removed; the rest were renumbered.${res.confirmationVoided ? " Confirm again." : ""}`;
  });
}

export async function approveAllAction(form: FormData) {
  const actor = await editor();
  const issueId = field(form, "issueId");
  return run(async () => {
    const { kept } = await approveAll(issueId, actor);
    await syncTelegram(issueId, { storyIds: kept }, log);
    return kept.length ? `Kept ${kept.length} ${kept.length === 1 ? "story" : "stories"}.` : "Nothing was pending.";
  });
}

export async function confirmAction(form: FormData) {
  const actor = await editor();
  const issueId = field(form, "issueId");
  const hash8 = field(form, "hash8");
  return run(async () => {
    await confirmIssue(issueId, { ...actor, cardHash: hash8 });
    await syncTelegram(issueId, { note: "🚀 Confirmed on the web desk. It will go out Thursday morning." }, log);
    return "Confirmed. It will go out Thursday morning.";
  });
}

export async function holdAction(form: FormData) {
  const actor = await editor();
  const issueId = field(form, "issueId");
  return run(async () => {
    await holdIssue(issueId, actor);
    await syncTelegram(issueId, { note: "⏸ Held on the web desk. Nothing will be sent until you confirm again." }, log);
    return "Held. Nothing will be sent until you confirm again.";
  });
}
