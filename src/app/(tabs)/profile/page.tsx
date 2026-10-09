import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/app/(auth)/actions";
import { ActivityCard } from "@/components/community/activity-card";
import { FlameIcon, SettingsIcon } from "@/components/icons";
import { Avatar, Card, PageHeader, Ring, SectionTitle } from "@/components/ui/primitives";
import { getCurrentUser, getFeed, getProfile } from "@/lib/queries";
import { subjectColors } from "@/lib/session-types";

export const metadata: Metadata = { title: "Profile" };

const days = ["M", "T", "W", "T", "F", "S", "S"];
const POSTS_STEP = 10;

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const user = await getCurrentUser();
  // ?posts=N shows the latest N posts; "Show more" bumps it.
  const requested = Number((await searchParams).posts);
  const shown = Number.isInteger(requested) ? Math.min(Math.max(requested, POSTS_STEP), 200) : POSTS_STEP;
  const [profile, posts] = await Promise.all([
    getProfile(user),
    getFeed(user.id, { mineOnly: true, limit: shown + 1 }),
  ]);
  const hasMore = posts.length > shown;
  const weekHours = profile.week.reduce((a, b) => a + b, 0);
  const maxDay = Math.max(...profile.week, 1);
  const maxSubject = Math.max(...profile.subjects.map((s) => s.hours), 1);

  return (
    <>
      <PageHeader
        title="Profile"
        action={
          <div className="flex items-center gap-2">
            {user.isAdmin && (
              <Link href="/admin" className="rounded-full bg-surface-2 px-4 py-2 text-sm font-medium">
                Admin
              </Link>
            )}
            <form action={logout}>
              <button className="rounded-full bg-surface-2 px-4 py-2 text-sm font-medium">Log out</button>
            </form>
            <Link
              href="/profile/settings"
              aria-label="Settings"
              className="grid size-10 place-items-center rounded-full bg-surface-2"
            >
              <SettingsIcon className="size-5" />
            </Link>
          </div>
        }
      />

      <Card>
        <div className="flex items-center gap-4">
          <Avatar initials={profile.initials} hue={profile.hue} size="lg" />
          <div className="min-w-0">
            <h2 className="text-xl font-bold">{profile.name}</h2>
            <p className="text-sm text-muted">{profile.handle}</p>
            {profile.program && <p className="mt-1 text-sm">{profile.program}</p>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 divide-x divide-border text-center">
          <Count label="Followers" value={profile.followers} />
          <Count label="Following" value={profile.following} />
          <Count label="Day streak" value={profile.streak} icon />
        </div>
      </Card>

      <SectionTitle>This week</SectionTitle>
      <Card className="flex items-center gap-6">
        <Ring value={weekHours / profile.weeklyGoal} size={96} stroke={10}>
          <div className="text-center leading-none">
            <p className="text-xl font-bold">{weekHours.toFixed(1)}</p>
            <p className="mt-1 text-[10px] text-muted">/ {profile.weeklyGoal} h</p>
          </div>
        </Ring>
        <div className="flex h-28 flex-1 items-end gap-2">
          {profile.week.map((h, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex h-20 w-full items-end">
                <div
                  className={`w-full rounded-md ${h ? "bg-accent" : "bg-surface-2"}`}
                  style={{ height: `${Math.max(6, (h / maxDay) * 100)}%` }}
                  title={`${h} h`}
                />
              </div>
              <span className="text-[11px] text-muted">{days[i]}</span>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle>All-time</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        <Total label="Hours" value={profile.totals.hours} />
        <Total label="Sessions" value={profile.totals.sessions} />
        <Total label="Kudos" value={profile.totals.kudos.toLocaleString("en-US")} />
      </div>

      <SectionTitle>Subjects</SectionTitle>
      <Card className="flex flex-col gap-4">
        {profile.subjects.length === 0 && (
          <p className="text-sm text-muted">Finish a session to see your subjects here.</p>
        )}
        {profile.subjects.map((s, i) => (
          <div key={s.name}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted tabular-nums">{s.hours} h</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full rounded-full ${subjectColors[i % subjectColors.length]}`} style={{ width: `${(s.hours / maxSubject) * 100}%` }} />
            </div>
          </div>
        ))}
      </Card>

      <SectionTitle>Achievements</SectionTitle>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {profile.badges.map((b) => (
          <li key={b.label}>
            <Card className={`flex flex-col items-center gap-2 p-3 text-center ${b.earned ? "" : "opacity-40 grayscale"}`}>
              <span className="text-3xl">{b.emoji}</span>
              <span className="text-[11px] leading-tight font-medium">{b.label}</span>
            </Card>
          </li>
        ))}
      </ul>

      <SectionTitle>Your posts</SectionTitle>
      {posts.length === 0 ? (
        <Card className="py-10 text-center text-sm text-muted">
          Finish a session and it shows up here.
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {posts.slice(0, shown).map((activity) => (
            <li key={activity.id}>
              <ActivityCard activity={activity} />
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <Link
          href={`/profile?posts=${shown + POSTS_STEP}`}
          scroll={false}
          className="mt-4 block rounded-2xl bg-surface-2 py-3 text-center text-sm font-medium"
        >
          Show more
        </Link>
      )}
    </>
  );
}

function Count({ label, value, icon }: { label: string; value: number; icon?: boolean }) {
  return (
    <div>
      <p className="inline-flex items-center gap-1 text-lg font-bold">
        {icon && <FlameIcon className="size-4 text-accent" />}
        {value}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </Card>
  );
}
