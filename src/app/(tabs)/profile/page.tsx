import type { Metadata } from "next";
import { FlameIcon, SettingsIcon } from "@/components/icons";
import { Avatar, Card, PageHeader, Ring, SectionTitle } from "@/components/ui/primitives";
import { profile } from "@/lib/study-data";

export const metadata: Metadata = { title: "Profile" };

const days = ["M", "T", "W", "T", "F", "S", "S"];

export default function ProfilePage() {
  const weekHours = profile.week.reduce((a, b) => a + b, 0);
  const maxDay = Math.max(...profile.week, 1);
  const maxSubject = Math.max(...profile.subjects.map((s) => s.hours));

  return (
    <>
      <PageHeader
        title="Profile"
        action={
          <button aria-label="Settings" className="grid size-10 place-items-center rounded-full bg-surface-2">
            <SettingsIcon className="size-5" />
          </button>
        }
      />

      <Card>
        <div className="flex items-center gap-4">
          <Avatar initials={profile.initials} hue={200} size="lg" />
          <div className="min-w-0">
            <h2 className="text-xl font-bold">{profile.name}</h2>
            <p className="text-sm text-muted">{profile.handle}</p>
            <p className="mt-1 text-sm">{profile.program}</p>
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
        {profile.subjects.map((s) => (
          <div key={s.name}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted tabular-nums">{s.hours} h</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full rounded-full ${s.color}`} style={{ width: `${(s.hours / maxSubject) * 100}%` }} />
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
