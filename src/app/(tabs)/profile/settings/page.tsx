import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/app/(auth)/actions";
import { ChevronLeftIcon } from "@/components/icons";
import { NotificationSettings } from "@/components/notification-settings";
import { SettingsForms } from "@/components/settings-forms";
import { PageHeader } from "@/components/ui/primitives";
import { vapidPublicKey } from "@/lib/push";
import { getCurrentUser } from "@/lib/queries";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getCurrentUser();

  return (
    <>
      <Link href="/profile" className="mt-4 inline-flex items-center gap-1 text-sm text-muted md:mt-8">
        <ChevronLeftIcon className="size-4" /> Profile
      </Link>
      <PageHeader
        title="Settings"
        action={
          <form action={logout}>
            <button className="rounded-full bg-surface-2 px-4 py-2 text-sm font-medium">Log out</button>
          </form>
        }
      />
      <SettingsForms
        me={{
          name: user.name,
          handle: user.handle,
          program: user.program,
          hue: user.hue,
          weeklyGoalHours: user.weeklyGoalHours,
        }}
        notifications={<NotificationSettings vapidPublicKey={vapidPublicKey} nudgeStyle={user.nudgeStyle} />}
      />
    </>
  );
}
