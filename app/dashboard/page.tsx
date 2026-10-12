import { redirect } from "next/navigation";

/** The engineering dashboard moved to /status; Shreya's workspace is /desk. */
export default function Dashboard() {
  redirect("/status");
}
