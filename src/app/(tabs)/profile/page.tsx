import type { Metadata } from "next";
import Link from "next/link";
import { FlameIcon, PlusIcon, SettingsIcon } from "@/components/icons";
import { ExpressionMascot } from "@/components/mascot/expression-mascot";
import { BrainEvolution } from "@/components/profile/brain-evolution";
import { SubjectInvestment } from "@/components/profile/subject-investment";
import { Avatar, Card, PageHeader, Ring, SectionTitle } from "@/components/ui/primitives";
import { getCurrentUser, getProfile, getStudyBehavior } from "@/lib/queries";
import type { HourlyBucket } from "@/lib/queries";
import { subjectColor } from "@/lib/session-types";

export const metadata: Metadata = { title: "Profile" };

const days = ["M", "T", "W", "T", "F", "S", "S"];
const spiritAnimalDetails: Record<string, { name: string; emoji: string }> = {
  owl: { name: "Owl", emoji: "🦉" },
  fox: { name: "Fox", emoji: "🦊" },
  tortoise: { name: "Tortoise", emoji: "🐢" },
  wolf: { name: "Wolf", emoji: "🐺" },
  deer: { name: "Deer", emoji: "🦌" },
};

export default async function ProfilePage() {
  const user = await getCurrentUser();
  const [profile, behavior] = await Promise.all([getProfile(user), getStudyBehavior(user.id)]);
  const weekHours = profile.week.reduce((a, b) => a + b, 0);
  const goal = profile.weeklyGoal;
  const planned = goal.kind === "plan" ? goal.planned : null;
  // Logged and planned bars share one scale, so a full bar means "as planned".
  const maxDay = Math.max(...profile.week, ...(planned ?? []), 1);
  const maxSubject = Math.max(...profile.subjects.map((s) => s.hours), 1);
  const spiritAnimal = spiritAnimalDetails[profile.spiritAnimal] ?? spiritAnimalDetails.owl;
  // Only subjects with an upcoming exam get a countdown.
  const examSubjects = profile.subjects.filter((subject) => subject.examHoursRemaining !== null);

  return (
    <>
      <PageHeader
        title="Profile"
        action={
          <div className="flex items-center gap-2">
            {user.isAdmin && (
              <Link
                href="/admin"
                className="rounded-full border-2 border-border bg-surface-2 px-4 py-2 text-sm font-bold"
              >
                Admin
              </Link>
            )}
            <Link
              href="/profile/settings"
              aria-label="Settings"
              className="grid size-10 place-items-center rounded-full border-2 border-border bg-surface-2"
            >
              <SettingsIcon className="size-5" />
            </Link>
          </div>
        }
      />

      <Card>
        <div className="flex items-center gap-4">
          <span className="relative shrink-0">
            <Avatar initials={profile.initials} hue={profile.hue} size="lg" />
            <span
              aria-label={`${spiritAnimal.name} spirit animal`}
              className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full border-2 border-foreground bg-surface text-base"
            >
              {spiritAnimal.emoji}
            </span>
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold">{profile.name}</h2>
            <p className="text-sm text-muted">{profile.handle}</p>
            {profile.program && <p className="mt-1 text-sm">{profile.program}</p>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 divide-x-2 divide-border border-t-2 border-border pt-4 text-center">
          <Count label="Friends" value={profile.friends} href="/community?tab=friends" />
          <Count label="Day streak" value={profile.streak} icon />
        </div>
      </Card>

      <SectionTitle
        action={goal.kind === "plan" && <span className="max-w-[55%] truncate text-xs text-muted">{goal.plans.join(" + ")}</span>}
      >
        This week
      </SectionTitle>
      {goal.kind === "plan" ? (
        <Card className="flex items-center gap-6">
          <Ring value={goal.hours > 0 ? weekHours / goal.hours : weekHours > 0 ? 1 : 0} size={96} stroke={10}>
            <div className="text-center leading-none">
              <p className="font-display text-xl font-bold">{weekHours.toFixed(1)}</p>
              <p className="mt-1 text-[10px] text-muted">
                {goal.hours > 0 ? `/ ${formatHours(goal.hours)} h` : "nothing planned"}
              </p>
            </div>
          </Ring>
          <div className="flex h-28 flex-1 items-end gap-2">
            {profile.week.map((h, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="relative flex h-20 w-full items-end">
                  {/* What the plan schedules that day, behind what was logged */}
                  {planned && planned[i] > 0 && (
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-md bg-surface-2"
                      style={{ height: `${(planned[i] / maxDay) * 100}%` }}
                    />
                  )}
                  <div
                    className={`relative w-full rounded-md ${h ? "bg-accent" : "bg-surface-2"}`}
                    style={{ height: `${Math.max(6, (h / maxDay) * 100)}%` }}
                    title={planned ? `${h} h of ${formatHours(planned[i])} h planned` : `${h} h`}
                  />
                </div>
                <span className="text-[11px] text-muted">{days[i]}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <ExpressionMascot expression="sleepy" size={96} />
          <p className="max-w-[30ch] text-sm text-muted">
            {goal.kind === "upcoming"
              ? `${goal.plan} starts on ${new Date(`${goal.start}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} — your weekly goal comes from it.`
              : "Create a study plan to set your weekly goal."}
            {weekHours > 0 && ` You've logged ${weekHours.toFixed(1)} h this week.`}
          </p>
          {goal.kind === "none" && (
            <Link
              href="/plans/new"
              className="mt-1 inline-flex items-center gap-1.5 rounded-full border-[2.5px] border-foreground bg-foreground px-5 py-2.5 text-sm font-bold text-background shadow-[0_3px_0_0_var(--border)] active:translate-y-[3px] active:shadow-none"
            >
              <PlusIcon className="size-4" />
              Create a study plan
            </Link>
          )}
        </Card>
      )}

      <SectionTitle>All-time</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        <Total label="Hours" value={profile.totals.hours} />
        <Total label="Sessions" value={profile.totals.sessions} />
        <Total label="Braincells" value={profile.totals.kudos.toLocaleString("en-US")} />
      </div>

      <SectionTitle>Your brain, right now</SectionTitle>
      <BrainEvolution hours={profile.totals.hours} mascotHealth={profile.mascotHealth} />

      <SectionTitle>Exam countdowns</SectionTitle>
      {examSubjects.length === 0 ? (
        <Card className="text-sm text-muted">No upcoming exams.</Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {examSubjects.map((subject) => (
            <Card key={subject.name} className="border-l-4 p-4" style={{ borderLeftColor: subjectColor(subject.name).value }}>
              <p className={`truncate text-sm font-medium ${subjectColor(subject.name).text}`} title={subject.name}>{subject.name}</p>
              <ExamCountdown hours={subject.examHoursRemaining!} color={subjectColor(subject.name).value} />
            </Card>
          ))}
        </div>
      )}

      <SectionTitle>Time investment</SectionTitle>
      <SubjectInvestment subjects={profile.subjects} />

      <SectionTitle>Study behavior</SectionTitle>
      <StudyBehaviorCard behavior={behavior} />

      <SectionTitle>Subjects</SectionTitle>
      <Card className="flex flex-col gap-4">
        {profile.subjects.length === 0 && (
          <p className="text-sm text-muted">Create a study plan or finish a session to see your subjects here.</p>
        )}
        {profile.subjects.map((s) => (
          <div key={s.name}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted tabular-nums">{s.hours} h</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${(s.hours / maxSubject) * 100}%`, backgroundColor: subjectColor(s.name).value }} />
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
              <span className="text-[11px] leading-tight font-bold">{b.label}</span>
            </Card>
          </li>
        ))}
      </ul>

    </>
  );
}

/** 42.5 → "42.5", 40 → "40". */
function formatHours(hours: number) {
  return String(Math.round(hours * 10) / 10);
}

function Count({ label, value, icon, href }: { label: string; value: number; icon?: boolean; href?: string }) {
  const content = (
    <>
      <p className="inline-flex items-center gap-1 font-display text-lg font-bold">
        {icon && <FlameIcon className="size-4 text-accent" />}
        {value}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="rounded-lg transition-opacity hover:opacity-70">
        {content}
      </Link>
    );
  }
  return <div>{content}</div>;
}

function Total({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </Card>
  );
}

function StudyBehaviorCard({ behavior }: { behavior: { hourly: HourlyBucket[]; peakHour: number | null; totalSessions: number } }) {
  if (behavior.totalSessions === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 py-8 text-center">
        <ExpressionMascot expression="sleepy" size={96} />
        <p className="text-sm text-muted">Complete sessions to see your study patterns here.</p>
      </Card>
    );
  }

  const formatHour = (h: number) => {
    if (h === 0) return "12 AM";
    if (h < 12) return `${h} AM`;
    if (h === 12) return "12 PM";
    return `${h - 12} PM`;
  };

  // Show hours 5–23 (trim early-morning noise)
  const visible = behavior.hourly.slice(5, 24);
  const maxSessions = Math.max(...visible.map((b) => b.sessions), 1);
  const peakHour = behavior.peakHour;

  return (
    <Card>
      {peakHour !== null && (
        <p className="mb-4 text-sm">
          Most active at{" "}
          <span className="font-display font-bold text-accent">{formatHour(peakHour)}</span>
          {" "}— the strategy agent uses this to schedule your most important sessions then.
        </p>
      )}
      <div className="flex h-24 items-end gap-px overflow-hidden rounded-xl border-2 border-border p-1.5">
        {visible.map((bucket) => {
          const isPeak = bucket.hour === peakHour;
          const heightPct = bucket.sessions > 0 ? Math.max(8, (bucket.sessions / maxSessions) * 100) : 4;
          return (
            <div
              key={bucket.hour}
              className="group relative flex flex-1 flex-col items-center justify-end"
              style={{ height: "100%" }}
            >
              <div
                className={`w-full rounded-sm transition-opacity ${isPeak ? "bg-accent" : "bg-surface-2"} ${bucket.sessions === 0 ? "opacity-30" : ""}`}
                style={{ height: `${heightPct}%` }}
                title={`${formatHour(bucket.hour)}: ${bucket.sessions} session${bucket.sessions !== 1 ? "s" : ""}${bucket.avgFocus != null ? `, avg focus ${bucket.avgFocus}` : ""}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted">
        <span>{formatHour(5)}</span>
        <span>{formatHour(12)}</span>
        <span>{formatHour(23)}</span>
      </div>
      {(() => {
        const withFocus = behavior.hourly.filter((b) => b.avgFocus != null && b.sessions > 0);
        if (withFocus.length === 0) return null;
        const bestFocus = withFocus.reduce((best, cur) => (cur.avgFocus! > best.avgFocus! ? cur : best));
        return (
          <p className="mt-3 text-sm text-muted">
            Highest focus at{" "}
            <span className="font-medium text-foreground">{formatHour(bestFocus.hour)}</span>
            {" "}(avg {bestFocus.avgFocus}/100)
          </p>
        );
      })()}
    </Card>
  );
}

function ExamCountdown({ hours, color }: { hours: number; color: string }) {
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return (
    <p className="mt-2 font-display text-2xl font-bold tabular-nums" style={{ color }}>
      {days > 0 && <>{days}d </>}
      {remainingHours}h
      <span className="sr-only"> left</span>
    </p>
  );
}
