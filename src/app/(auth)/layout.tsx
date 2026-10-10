import { redirect } from "next/navigation";
import { ExpressionMascot } from "@/components/mascot/expression-mascot";
import { getSessionUser } from "@/lib/auth";

/** Centered card for /signup. Users who already have a profile go straight to the app. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSessionUser()) redirect("/");

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-[1.75rem] border-2 border-border bg-surface p-6 shadow-[0_4px_0_0_var(--border)]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <ExpressionMascot expression="excited" size={84} priority />
          <span className="font-display text-xl font-extrabold tracking-tight">Braina</span>
          <p className="text-xs text-muted">Grow your brain by using it.</p>
        </div>
        {children}
      </div>
    </main>
  );
}
