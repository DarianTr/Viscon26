import { redirect } from "next/navigation";

/** Login is done by the reverse proxy now; old /login links land in the app (or on /signup). */
export default function LoginPage() {
  redirect("/");
}
