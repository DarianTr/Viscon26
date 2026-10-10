import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { CalendarFeedSettings } from "@/components/calendar-feed-settings";
import { ChevronLeftIcon } from "@/components/icons";
import { NotificationSettings } from "@/components/notification-settings";
import { PrivacySettings } from "@/components/privacy-settings";
import { SettingsForms } from "@/components/settings-forms";
import { PageHeader } from "@/components/ui/primitives";
import { feedOrigin } from "@/lib/calendar-feed";
import { vapidPublicKey } from "@/lib/push";
import { getCurrentUser } from "@/lib/queries";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const origin = feedOrigin(await headers());

  return (
    <>
      <Link href="/profile" className="mt-4 inline-flex items-center gap-1 text-sm text-muted md:mt-8">
        <ChevronLeftIcon className="size-4" /> Profile
      </Link>
      <PageHeader title="Settings" />
      <SettingsForms
        me={{
          name: user.name,
          handle: user.handle,
          program: user.program,
          hue: user.hue,
        }}
        notifications={
          <>
            <PrivacySettings shareSessionsByDefault={user.shareSessionsByDefault} />
            <NotificationSettings vapidPublicKey={vapidPublicKey} nudgeStyle={user.nudgeStyle} />
            <CalendarFeedSettings origin={origin} token={user.calendarToken} />
          </>
        }
      />
    </>
  );
}
