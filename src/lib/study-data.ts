/**
 * Mock data for the study app. Everything here is shaped like what the backend
 * will eventually return, so swapping it for API calls only touches the pages.
 */

/** Study session types, modelled on run types in a training plan. */
export type SessionType = "deep" | "intervals" | "tempo" | "recovery";

export const sessionTypes: Record<
  SessionType,
  { label: string; blurb: string; color: string; soft: string }
> = {
  deep: {
    label: "Deep Focus",
    blurb: "One long, uninterrupted block — your long run.",
    color: "bg-deep",
    soft: "bg-deep/12 text-deep",
  },
  intervals: {
    label: "Intervals",
    blurb: "Pomodoro reps: 25 min on, 5 min off.",
    color: "bg-intervals",
    soft: "bg-intervals/12 text-intervals",
  },
  tempo: {
    label: "Tempo",
    blurb: "Timed past-paper problems at exam pace.",
    color: "bg-tempo",
    soft: "bg-tempo/12 text-tempo",
  },
  recovery: {
    label: "Recovery",
    blurb: "Light review — flashcards, skim notes.",
    color: "bg-recovery",
    soft: "bg-recovery/12 text-recovery",
  },
};

export type Task = {
  id: string;
  type: SessionType;
  subject: string;
  title: string;
  minutes: number;
  detail: string;
  time: string;
  done: boolean;
};

export const todaysTasks: Task[] = [
  {
    id: "t1",
    type: "intervals",
    subject: "Linear Algebra",
    title: "4 × 25 min eigenvalue drills",
    minutes: 115,
    detail: "Series 6, exercises 1–8 · 5 min breaks",
    time: "09:00",
    done: true,
  },
  {
    id: "t2",
    type: "deep",
    subject: "Analysis II",
    title: "Long block: Fubini & change of variables",
    minutes: 90,
    detail: "Lecture 11–12 notes, no phone",
    time: "13:30",
    done: false,
  },
  {
    id: "t3",
    type: "tempo",
    subject: "Physics",
    title: "Past paper HS24, Q1–Q3",
    minutes: 60,
    detail: "Exam pace: 20 min per question",
    time: "16:00",
    done: false,
  },
  {
    id: "t4",
    type: "recovery",
    subject: "Algorithms",
    title: "Flashcards: graph algorithms",
    minutes: 20,
    detail: "Anki deck · 60 due cards",
    time: "21:00",
    done: false,
  },
];

export type PlanPhase = { name: string; weeks: number };

export type Plan = {
  id: string;
  title: string;
  subject: string;
  goal: string;
  weeks: number;
  hoursPerWeek: number;
  level: "Beginner" | "Intermediate" | "Advanced";
  gradient: string;
  phases: PlanPhase[];
  enrolled: number;
};

export const activePlan = {
  planId: "analysis-exam",
  currentWeek: 3,
  examDate: "2026-11-20",
  weekSessions: [
    { day: "Mon", type: "intervals", done: true },
    { day: "Tue", type: "deep", done: true },
    { day: "Wed", type: "recovery", done: true },
    { day: "Thu", type: "tempo", done: false },
    { day: "Fri", type: "deep", done: false },
    { day: "Sat", type: "intervals", done: false },
    { day: "Sun", type: null, done: false },
  ] as { day: string; type: SessionType | null; done: boolean }[],
};

export const plans: Plan[] = [
  {
    id: "analysis-exam",
    title: "Analysis II Exam Prep",
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
    enrolled: 412,
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
    enrolled: 1830,
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
    enrolled: 2950,
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
    enrolled: 640,
  },
];

export type CalendarEvent = {
  id: string;
  type: SessionType | "exam" | "lecture";
  title: string;
  start: string;
  minutes: number;
};

/**
 * Events keyed by offset from today, so the calendar always looks populated
 * whatever day the app is opened.
 */
export const calendarTemplate: Record<number, Omit<CalendarEvent, "id">[]> = {
  [-3]: [
    { type: "intervals", title: "Linear Algebra reps", start: "09:00", minutes: 100 },
    { type: "lecture", title: "Analysis II lecture", start: "13:15", minutes: 90 },
  ],
  [-2]: [{ type: "deep", title: "Physics problem set", start: "10:00", minutes: 120 }],
  [-1]: [
    { type: "recovery", title: "Flashcards", start: "20:00", minutes: 20 },
    { type: "lecture", title: "Algorithms lecture", start: "10:15", minutes: 90 },
  ],
  0: todaysTasks.map(({ type, title, time, minutes }) => ({
    type,
    title,
    start: time,
    minutes,
  })),
  1: [
    { type: "intervals", title: "Analysis II reps", start: "09:30", minutes: 100 },
    { type: "lecture", title: "Physics lecture", start: "14:15", minutes: 90 },
  ],
  2: [{ type: "deep", title: "Algorithms long block", start: "10:00", minutes: 150 }],
  4: [
    { type: "tempo", title: "Mock exam: Linear Algebra", start: "09:00", minutes: 120 },
    { type: "recovery", title: "Review mistakes", start: "17:00", minutes: 30 },
  ],
  5: [{ type: "intervals", title: "Physics reps", start: "13:00", minutes: 75 }],
  7: [{ type: "deep", title: "Analysis II long block", start: "09:00", minutes: 180 }],
  9: [{ type: "tempo", title: "Past paper HS23", start: "14:00", minutes: 90 }],
  12: [{ type: "exam", title: "Linear Algebra midterm", start: "10:00", minutes: 120 }],
  15: [{ type: "deep", title: "Analysis II long block", start: "09:00", minutes: 180 }],
};

export type Activity = {
  id: string;
  user: { name: string; initials: string; hue: number };
  postedAgo: string;
  location: string;
  title: string;
  type: SessionType;
  subject: string;
  minutes: number;
  focus: number;
  pages: number;
  /** Focus level over the session, 0–1, sampled evenly. */
  trace: number[];
  kudos: number;
  comments: number;
  note?: string;
};

export const feed: Activity[] = [
  {
    id: "a1",
    user: { name: "Lena Meier", initials: "LM", hue: 260 },
    postedAgo: "24 min ago",
    location: "ETH Main Library",
    title: "Morning eigen-grind",
    type: "intervals",
    subject: "Linear Algebra",
    minutes: 125,
    focus: 92,
    pages: 18,
    trace: [0.6, 0.8, 0.9, 0.5, 0.85, 0.95, 0.9, 0.4, 0.8, 0.92, 0.95, 0.88],
    kudos: 24,
    comments: 3,
    note: "Finally clicked why similar matrices share eigenvalues 🎉",
  },
  {
    id: "a2",
    user: { name: "Jonas Keller", initials: "JK", hue: 160 },
    postedAgo: "1 h ago",
    location: "HG E 41",
    title: "Past paper at exam pace",
    type: "tempo",
    subject: "Physics",
    minutes: 90,
    focus: 87,
    pages: 6,
    trace: [0.7, 0.75, 0.82, 0.9, 0.88, 0.8, 0.85, 0.9, 0.93, 0.7],
    kudos: 11,
    comments: 1,
  },
  {
    id: "a3",
    user: { name: "Aisha Rahman", initials: "AR", hue: 20 },
    postedAgo: "3 h ago",
    location: "CAB Study Room",
    title: "3 h deep block, no phone",
    type: "deep",
    subject: "Algorithms",
    minutes: 185,
    focus: 95,
    pages: 42,
    trace: [0.5, 0.7, 0.85, 0.92, 0.95, 0.97, 0.96, 0.94, 0.9, 0.93, 0.95, 0.9, 0.85, 0.8],
    kudos: 57,
    comments: 9,
    note: "New personal best for longest focus streak 💪",
  },
  {
    id: "a4",
    user: { name: "Marco Bianchi", initials: "MB", hue: 320 },
    postedAgo: "Yesterday",
    location: "Home",
    title: "Evening flashcards",
    type: "recovery",
    subject: "Chemistry",
    minutes: 25,
    focus: 78,
    pages: 0,
    trace: [0.6, 0.7, 0.75, 0.8, 0.7, 0.65],
    kudos: 6,
    comments: 0,
  },
];

export type LeaderboardEntry = {
  name: string;
  initials: string;
  hue: number;
  hours: number;
  you?: boolean;
};

export const leaderboard: LeaderboardEntry[] = [
  { name: "Aisha Rahman", initials: "AR", hue: 20, hours: 31.5 },
  { name: "Lena Meier", initials: "LM", hue: 260, hours: 28.0 },
  { name: "You", initials: "TP", hue: 200, hours: 22.75, you: true },
  { name: "Jonas Keller", initials: "JK", hue: 160, hours: 19.25 },
  { name: "Marco Bianchi", initials: "MB", hue: 320, hours: 12.5 },
];

export const clubs = [
  { name: "D-INFK First Years", members: 842, emoji: "💻" },
  { name: "Analysis Survivors", members: 1204, emoji: "∫" },
  { name: "5am Library Club", members: 96, emoji: "🌅" },
];

export const profile = {
  name: "Tomas P.",
  initials: "TP",
  handle: "@tprazak",
  program: "BSc Computer Science · Semester 3",
  followers: 128,
  following: 96,
  streak: 12,
  totals: { hours: 214, sessions: 186, kudos: 1340 },
  /** Hours per day, Monday first. */
  week: [3.5, 4.25, 2.0, 5.0, 3.0, 1.5, 0],
  weeklyGoal: 25,
  subjects: [
    { name: "Analysis II", hours: 72, color: "bg-deep" },
    { name: "Linear Algebra", hours: 58, color: "bg-intervals" },
    { name: "Algorithms", hours: 49, color: "bg-tempo" },
    { name: "Physics", hours: 35, color: "bg-recovery" },
  ],
  badges: [
    { emoji: "🔥", label: "10-day streak", earned: true },
    { emoji: "🌅", label: "Early bird", earned: true },
    { emoji: "🧠", label: "3 h deep block", earned: true },
    { emoji: "🏔️", label: "100 h club", earned: true },
    { emoji: "🏁", label: "Plan finisher", earned: false },
    { emoji: "👑", label: "Club #1", earned: false },
  ],
};

export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
