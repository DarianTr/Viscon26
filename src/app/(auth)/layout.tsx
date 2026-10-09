import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

/** Centered card for /login and /signup. Logged-in users go straight to the app. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSessionUser()) redirect("/");

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-6 ring-1 ring-border">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-xl bg-accent text-sm font-black text-white">
            S
          </span>
          <span className="text-lg font-bold tracking-tight">Stride</span>
        </div>
        {children}
      </div>
    </main>
  );
}
