import type { Metadata } from "next";
import { FlameIcon, SettingsIcon } from "@/components/icons";
import { SubjectInvestment } from "@/components/profile/subject-investment";
import { Avatar, Card, PageHeader, Ring, SectionTitle } from "@/components/ui/primitives";
import { getCurrentUser, getProfile } from "@/lib/queries";
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
  const profile = await getProfile(await getCurrentUser());
  const weekHours = profile.week.reduce((a, b) => a + b, 0);
  const maxDay = Math.max(...profile.week, 1);
  const maxSubject = Math.max(...profile.subjects.map((s) => s.hours), 1);
  const spiritAnimal = spiritAnimalDetails[profile.spiritAnimal] ?? spiritAnimalDetails.owl;
  const examSubjects = profile.subjects;

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
          <span className="relative shrink-0">
            <Avatar initials={profile.initials} hue={profile.hue} size="lg" />
            <span
              aria-label={`${spiritAnimal.name} spirit animal`}
              className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full bg-surface text-base shadow-sm ring-1 ring-border"
            >
              {spiritAnimal.emoji}
            </span>
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold">{profile.name}</h2>
            <p className="text-sm text-muted">{profile.handle}</p>
            {profile.program && <p className="mt-1 text-sm">{profile.program}</p>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 divide-x divide-border border-t border-border pt-4 text-center">
          <Count label="Friends" value={profile.friends} />
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

      <SectionTitle>Exam countdowns</SectionTitle>
      {examSubjects.length === 0 ? (
        <Card className="text-sm text-muted">No subjects yet.</Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {examSubjects.map((subject) => (
            <Card key={subject.name} className="border-l-4 p-4" style={{ borderLeftColor: subjectColor(subject.name).value }}>
              <p className={`truncate text-sm font-medium ${subjectColor(subject.name).text}`} title={subject.name}>{subject.name}</p>
              {subject.examHoursRemaining === null ? (
                <p className="mt-2 text-sm text-muted">No exam date set</p>
              ) : (
                <ExamCountdown hours={subject.examHoursRemaining} color={subjectColor(subject.name).value} />
              )}
            </Card>
          ))}
        </div>
      )}

      <SectionTitle>Time investment</SectionTitle>
      <SubjectInvestment
        subjects={profile.subjects.slice(0, 4).map((subject) => subject.name)}
        userKey={profile.handle}
      />

      <SectionTitle>Subjects</SectionTitle>
      <Card className="flex flex-col gap-4">
        {profile.subjects.length === 0 && (
          <p className="text-sm text-muted">Finish a session to see your subjects here.</p>
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

function ExamCountdown({ hours, color }: { hours: number; color: string }) {
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return (
    <p className="mt-2 text-2xl font-bold tabular-nums" style={{ color }}>
      {days > 0 && <>{days}d </>}
      {remainingHours}h
      <span className="sr-only"> left</span>
    </p>
  );
}
