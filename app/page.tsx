import { redirect } from "next/navigation";

/** The app is Shreya's editorial desk; subscribers only ever see the email (and its unsubscribe page). */
export default function Home() {
  redirect("/desk");
}
