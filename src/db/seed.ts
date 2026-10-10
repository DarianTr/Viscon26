/**
 * Fills the database with demo data: `npm run db:seed`.
 *
 * Wipes every table first — unless run with `--if-empty`, in which case it
 * only seeds a database with no users (used by the Docker setup, so restarting
 * the stack never wipes data). All dates are relative to "now" in Zurich, so the
 * app always opens on a populated today, a live streak and a busy calendar.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as s from "./schema";
import { hashPassword } from "./password";

const TZ = "Europe/Zurich";
const DEMO_HANDLE = process.env.DEMO_USER_HANDLE ?? "tprazak";
/** Every seeded user gets this password; the demo user is also an admin. */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "stride";

const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: s });

// --- Deterministic randomness, so every seed looks the same --------------

let rngState = 42;
function rand() {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
const sample = <T,>(list: readonly T[], n: number) =>
  [...list].sort(() => rand() - 0.5).slice(0, Math.max(0, n));

// --- Time helpers ---------------------------------------------------------

/** Today's date in Zurich as [year, month (1-based), day]. */
const [ty, tm, td] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ })
  .format(new Date())
  .split("-")
  .map(Number);

function zurichOffsetMinutes(instant: Date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")!.value; // e.g. "GMT+02:00"
  const match = name.match(/([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

/** The instant of `hh:mm` Zurich time, `dayOffset` days from today. */
function at(dayOffset: number, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = new Date(Date.UTC(ty, tm - 1, td + dayOffset, h, m));
  return new Date(guess.getTime() - zurichOffsetMinutes(guess) * 60_000);
}

/** "YYYY-MM-DD" for `dayOffset` days from today. */
function day(dayOffset: number) {
  return new Date(Date.UTC(ty, tm - 1, td + dayOffset)).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday, for `dayOffset` days from today. */
function weekday(dayOffset: number) {
  return (new Date(Date.UTC(ty, tm - 1, td + dayOffset)).getUTCDay() + 6) % 7;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

// --- Content --------------------------------------------------------------

type StudyType = "deep" | "intervals" | "tempo" | "recovery";

const subjects = ["DiskMath", "Linear Algebra", "Algorithms", "EProg"];
const locations = ["ETH Main Library", "HG E 41", "CAB Study Room", "Home", "Polyterrasse", "LEE Library"];

const templates: Record<StudyType, { title: string; minutes: [number, number] }[]> = {
  deep: [
    { title: "Long block: lecture notes", minutes: [90, 180] },
    { title: "Problem set, no phone", minutes: [90, 150] },
  ],
  intervals: [
    { title: "4 × 25 min drills", minutes: [100, 120] },
    { title: "Pomodoro reps: exercises", minutes: [75, 125] },
  ],
  tempo: [
    { title: "Past paper at exam pace", minutes: [60, 120] },
    { title: "Timed mock questions", minutes: [45, 90] },
  ],
  recovery: [
    { title: "Flashcards", minutes: [15, 30] },
    { title: "Skim and summarise notes", minutes: [20, 40] },
  ],
};

function trace(length: number, base: number) {
  return Array.from({ length }, () =>
    Math.min(1, Math.max(0.3, base + (rand() - 0.5) * 0.35)),
  ).map((v) => Math.round(v * 100) / 100);
}

/** A completed session, ready to insert. */
function completed(
  userId: string,
  dayOffset: number,
  hhmm: string,
  type: StudyType,
  extra: Partial<typeof s.sessions.$inferInsert> = {},
): typeof s.sessions.$inferInsert {
  const tpl = pick(templates[type]);
  const minutes = between(...tpl.minutes);
  const start = at(dayOffset, hhmm);
  const focus = between(72, 97);
  return {
    userId,
    type,
    subject: pick(subjects),
    title: tpl.title,
    scheduledAt: start,
    plannedMinutes: minutes,
    completedAt: new Date(start.getTime() + minutes * 60_000),
    actualMinutes: minutes,
    focus,
    trace: trace(Math.max(6, Math.round(minutes / 12)), focus / 100),
    location: pick(locations),
    shared: rand() > 0.15,
    ...extra,
  };
}

const classmateNames = [
  "Noah Fischer", "Mia Huber", "Luca Schmid", "Emma Weber", "Leon Steiner",
  "Sofia Brunner", "Elias Baumann", "Lea Frei", "David Gerber", "Nina Zimmermann",
  "Samuel Moser", "Lara Widmer", "Julian Graf", "Elena Wyss", "Tim Roth",
  "Anna Kunz", "Matteo Rossi", "Chiara Bühler", "Ben Lüthi", "Zoe Kaufmann",
];

async function main() {
  if (process.argv.includes("--if-empty")) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.users);
    if (n > 0) {
      console.log(`Database already has ${n} users — skipping seed.`);
      return;
    }
  }

  console.log("Clearing tables…");
  await db.execute(sql`
    truncate table
      session_photos, session_tags, comments, kudos, sessions, enrollments,
      user_badges, badges, friendships, plans, auth_sessions, users, items
    restart identity cascade
  `);

  // --- Users --------------------------------------------------------------
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [me, lena, jonas, aisha, marco, ...classmates] = await db
    .insert(s.users)
    .values([
      { handle: DEMO_HANDLE, name: "Tomas P.", hue: 200, spiritAnimal: "fox", program: "BSc Computer Science · Semester 3", weeklyGoalHours: 25, isAdmin: true },
      { handle: "lena", name: "Lena Meier", hue: 260, spiritAnimal: "owl", program: "BSc Mathematics" },
      { handle: "jonas", name: "Jonas Keller", hue: 160, spiritAnimal: "wolf", program: "BSc Physics" },
      { handle: "aisha", name: "Aisha Rahman", hue: 20, spiritAnimal: "deer", program: "BSc Computer Science" },
      { handle: "marco", name: "Marco Bianchi", hue: 320, spiritAnimal: "tortoise", program: "BSc Chemistry" },
      ...classmateNames.map((name, i) => ({
        handle: name.toLowerCase().replace(/[^a-z]+/g, "."),
        name,
        hue: (i * 47) % 360,
        program: pick(["BSc Computer Science", "BSc Mathematics", "BSc Physics"]),
      })),
    ].map((u) => ({ ...u, passwordHash })))
    .returning();
  const friends = [lena, jonas, aisha, marco];
  const everyone = [me, ...friends, ...classmates];

  // The four friends know each other and the demo user; a few classmates have
  // sent the demo user requests, and the demo user has sent one.
  const accepted = new Date();
  await db.insert(s.friendships).values([
    ...friends.map((f) => ({ requesterId: f.id, addresseeId: me.id, acceptedAt: accepted })),
    ...friends.flatMap((a, i) =>
      friends.slice(i + 1).map((b) => ({ requesterId: a.id, addresseeId: b.id, acceptedAt: accepted })),
    ),
    ...classmates.slice(0, 3).map((c) => ({ requesterId: c.id, addresseeId: me.id })),
    { requesterId: me.id, addresseeId: classmates[3].id },
  ]);

  // --- Plans --------------------------------------------------------------
  await db.insert(s.plans).values([
    {
      id: "diskmath-exam",
      title: "DiskMath Exam Prep",
      subject: "Mathematics",
      goal: "Pass the session exam with a 5+",
      weeks: 8,
      hoursPerWeek: 10,
      level: "Intermediate",
      gradient: "from-[#fc4c02] to-[#e11d74]",
      phases: [
        { name: "Base", weeks: 2 },
        { name: "Build", weeks: 3 },
        { name: "Peak", weeks: 2 },
        { name: "Taper", weeks: 1 },
      ],
    },
    {
      id: "basisjahr",
      title: "Basisprüfung Marathon",
      subject: "All first-year subjects",
      goal: "Cover every subject before the block exam",
      weeks: 12,
      hoursPerWeek: 20,
      level: "Advanced",
      gradient: "from-[#5b5bf6] to-[#10a37f]",
      phases: [
        { name: "Base", weeks: 4 },
        { name: "Build", weeks: 4 },
        { name: "Peak", weeks: 3 },
        { name: "Taper", weeks: 1 },
      ],
    },
    {
      id: "couch-to-focus",
      title: "Couch to 5 Hours",
      subject: "Focus habit",
      goal: "Build up to 5 focused hours a day",
      weeks: 6,
      hoursPerWeek: 6,
      level: "Beginner",
      gradient: "from-[#10a37f] to-[#5bc0f6]",
      phases: [
        { name: "Base", weeks: 3 },
        { name: "Build", weeks: 3 },
      ],
    },
    {
      id: "algo-sprint",
      title: "Algorithms Sprint",
      subject: "Computer Science",
      goal: "Ace A&D with timed problem sets",
      weeks: 4,
      hoursPerWeek: 8,
      level: "Intermediate",
      gradient: "from-[#e11d74] to-[#5b5bf6]",
      phases: [
        { name: "Build", weeks: 3 },
        { name: "Taper", weeks: 1 },
      ],
    },
  ]);

  // The demo user is in week 3 of the DiskMath plan.
  const mondayOffset = -weekday(0);
  const planStart = mondayOffset - 14;
  await db.insert(s.enrollments).values([
    { userId: me.id, planId: "diskmath-exam", startedOn: day(planStart), examDate: day(42) },
    ...[...friends, ...classmates].map((u) => ({
      userId: u.id,
      planId: pick(["diskmath-exam", "basisjahr", "couch-to-focus", "algo-sprint"]),
      startedOn: day(-between(0, 40)),
    })),
  ]);

  // --- The demo user's sessions ---------------------------------------------
  const mine: (typeof s.sessions.$inferInsert)[] = [];
  const studyTypes: StudyType[] = ["deep", "intervals", "tempo", "recovery"];

  // History: a 12-day streak ending today, with an older patchier stretch.
  for (let d = -45; d <= -1; d++) {
    if (d === -12) continue; // the day the streak broke
    if (d < -12 && rand() < 0.25) continue;
    const count = between(1, 3);
    const times = sample(["08:30", "10:00", "13:30", "16:00", "20:00"], count).sort();
    for (const time of times) {
      mine.push(
        completed(me.id, d, time, pick(studyTypes), {
          planId: d >= planStart ? "diskmath-exam" : null,
        }),
      );
    }
  }

  // Today: one session done, three to go.
  mine.push(
    {
      userId: me.id, planId: "diskmath-exam", type: "intervals", subject: "Linear Algebra",
      title: "4 × 25 min eigenvalue drills", detail: "Series 6, exercises 1–8 · 5 min breaks",
      scheduledAt: at(0, "09:00"), plannedMinutes: 115,
      completedAt: at(0, "10:55"), actualMinutes: 115, focus: 91,
      trace: [0.7, 0.85, 0.9, 0.6, 0.88, 0.93, 0.9, 0.5, 0.86, 0.94],
      location: "ETH Main Library",
    },
    {
      userId: me.id, planId: "diskmath-exam", type: "deep", subject: "DiskMath",
      title: "Long block: Fubini & change of variables", detail: "Lecture 11–12 notes, no phone",
      scheduledAt: at(0, "13:30"), plannedMinutes: 90,
    },
    {
      userId: me.id, planId: "diskmath-exam", type: "tempo", subject: "EProg",
      title: "Past paper HS24, Q1–Q3", detail: "Exam pace: 20 min per question",
      scheduledAt: at(0, "16:00"), plannedMinutes: 60,
    },
    {
      userId: me.id, planId: "diskmath-exam", type: "recovery", subject: "Algorithms",
      title: "Flashcards: graph algorithms", detail: "Anki deck · 60 due cards",
      scheduledAt: at(0, "21:00"), plannedMinutes: 20,
    },
  );

  // Upcoming plan sessions.
  const upcoming: [number, StudyType, string, string, string, number][] = [
    [1, "intervals", "DiskMath", "DiskMath reps", "09:30", 100],
    [2, "deep", "Algorithms", "Algorithms long block", "10:00", 150],
    [4, "tempo", "Linear Algebra", "Mock exam: Linear Algebra", "09:00", 120],
    [4, "recovery", "Linear Algebra", "Review mistakes", "17:00", 30],
    [5, "intervals", "EProg", "EProg reps", "13:00", 75],
    [7, "deep", "DiskMath", "DiskMath long block", "09:00", 180],
    [9, "tempo", "EProg", "Past paper HS23", "14:00", 90],
    [11, "recovery", "DiskMath", "Formula sheet review", "19:00", 30],
    [15, "deep", "DiskMath", "DiskMath long block", "09:00", 180],
    [18, "intervals", "Algorithms", "Dynamic programming reps", "10:00", 100],
    [22, "tempo", "DiskMath", "Past paper FS25", "09:00", 120],
  ];
  for (const [d, type, subject, title, time, minutes] of upcoming) {
    mine.push({ userId: me.id, planId: "diskmath-exam", type, subject, title, scheduledAt: at(d, time), plannedMinutes: minutes });
  }

  // Weekly lectures, and an exam.
  const lectures: [number, string, string][] = [
    [0, "10:15", "Algorithms lecture"],
    [1, "13:15", "DiskMath lecture"],
    [3, "14:15", "EProg lecture"],
  ];
  for (let week = -6; week <= 8; week++) {
    for (const [wd, time, title] of lectures) {
      const d = mondayOffset + week * 7 + wd;
      mine.push({
        userId: me.id, type: "lecture", subject: title.replace(" lecture", ""), title,
        scheduledAt: at(d, time), plannedMinutes: 90,
      });
    }
  }
  mine.push({
    userId: me.id, type: "exam", subject: "Linear Algebra", title: "Linear Algebra midterm",
    scheduledAt: at(12, "10:00"), plannedMinutes: 120,
  });

  // --- Friends' sessions ------------------------------------------------------
  const theirs: (typeof s.sessions.$inferInsert)[] = [];
  for (const [i, friend] of friends.entries()) {
    for (let d = -14; d <= -1; d++) {
      if (rand() < 0.2) continue;
      theirs.push(completed(friend.id, d, pick(["09:00", "13:00", "17:00"]), pick(studyTypes)));
    }
    // Make the weekly leaderboard spread out a bit.
    for (let extra = 0; extra < 3 - i; extra++) {
      theirs.push(completed(friend.id, Math.min(-1, mondayOffset + extra), "19:00", "deep"));
    }
  }

  // The headline posts at the top of the feed.
  const headline = (
    user: typeof me,
    agoMinutes: number,
    session: Omit<typeof s.sessions.$inferInsert, "userId" | "scheduledAt" | "plannedMinutes" | "completedAt">,
  ) => {
    const end = minutesAgo(agoMinutes);
    const minutes = session.actualMinutes!;
    theirs.push({
      ...session,
      userId: user.id,
      scheduledAt: new Date(end.getTime() - minutes * 60_000),
      plannedMinutes: minutes,
      completedAt: end,
    });
  };
  headline(lena, 24, {
    type: "intervals", subject: "Linear Algebra", title: "Morning eigen-grind", actualMinutes: 125, focus: 92,
    location: "ETH Main Library", note: "Finally clicked why similar matrices share eigenvalues 🎉",
    trace: [0.6, 0.8, 0.9, 0.5, 0.85, 0.95, 0.9, 0.4, 0.8, 0.92, 0.95, 0.88],
  });
  headline(jonas, 65, {
    type: "tempo", subject: "Physics", title: "Past paper at exam pace", actualMinutes: 90, focus: 87,
    location: "HG E 41", trace: [0.7, 0.75, 0.82, 0.9, 0.88, 0.8, 0.85, 0.9, 0.93, 0.7],
  });
  headline(aisha, 190, {
    type: "deep", subject: "Algorithms", title: "3 h deep block, no phone", actualMinutes: 185, focus: 95,
    location: "CAB Study Room", note: "New personal best for longest focus streak 💪",
    trace: [0.5, 0.7, 0.85, 0.92, 0.95, 0.97, 0.96, 0.94, 0.9, 0.93, 0.95, 0.9, 0.85, 0.8],
  });
  headline(marco, 60 * 22, {
    type: "recovery", subject: "Chemistry", title: "Evening flashcards", actualMinutes: 25, focus: 78,
    location: "Home", trace: [0.6, 0.7, 0.75, 0.8, 0.7, 0.65],
  });

  const inserted = await db
    .insert(s.sessions)
    .values([...mine, ...theirs])
    .returning({ id: s.sessions.id, userId: s.sessions.userId, completedAt: s.sessions.completedAt, shared: s.sessions.shared });

  // --- Kudos and comments on shared activities --------------------------------
  const posts = inserted.filter((p) => p.completedAt && p.shared);
  const kudosRows = posts.flatMap((post) => {
    const fans = everyone.filter((u) => u.id !== post.userId);
    return sample(fans, between(0, 14)).map((u) => ({ sessionId: post.id, userId: u.id }));
  });
  await db.insert(s.kudos).values(kudosRows).onConflictDoNothing();

  const lines = [
    "Beast mode 🔥", "How do you stay focused that long?", "See you at the library tomorrow!",
    "Which past paper was that?", "Respect 👏", "Saving this for my own plan",
  ];
  const recent = posts
    .filter((p) => p.completedAt! > minutesAgo(60 * 24 * 3))
    .sort((a, b) => +b.completedAt! - +a.completedAt!);
  await db.insert(s.comments).values(
    recent.flatMap((post) =>
      sample(friends.filter((f) => f.id !== post.userId), between(0, 3)).map((u) => ({
        sessionId: post.id,
        userId: u.id,
        body: pick(lines),
      })),
    ),
  );

  // Some recent posts by the friend group were studied together. Everyone in
  // the group is friends with everyone else, so any of them can be tagged.
  const group = [me, ...friends];
  const tagRows = recent
    .filter((post) => group.some((u) => u.id === post.userId))
    .flatMap((post) =>
      sample(group.filter((u) => u.id !== post.userId), pick([0, 0, 1, 2])).map((u) => ({
        sessionId: post.id,
        userId: u.id,
      })),
    );
  if (tagRows.length > 0) await db.insert(s.sessionTags).values(tagRows);

  // --- Badges ---------------------------------------------------------------------
  await db.insert(s.badges).values([
    { id: "streak-10", emoji: "🔥", label: "10-day streak", position: 1 },
    { id: "early-bird", emoji: "🌅", label: "Early bird", position: 2 },
    { id: "deep-3h", emoji: "🧠", label: "3 h deep block", position: 3 },
    { id: "hours-100", emoji: "🏔️", label: "100 h club", position: 4 },
    { id: "plan-finisher", emoji: "🏁", label: "Plan finisher", position: 5 },
  ]);
  await db.insert(s.userBadges).values(
    ["streak-10", "early-bird", "deep-3h"].map((badgeId) => ({ userId: me.id, badgeId })),
  );

  // --- Starter items -------------------------------------------------------------
  await db.insert(s.items).values(
    ["Pitch the idea", "Ship the MVP", "Win the hackathon"].map((title) => ({ title })),
  );

  console.log(
    `Seeded ${everyone.length} users, ${inserted.length} sessions, ${kudosRows.length} kudos. ` +
      `Log in as @${DEMO_HANDLE} (admin) or any other handle, password "${DEMO_PASSWORD}".`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
