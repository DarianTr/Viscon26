import type { SVGProps } from "react";

/** Minimal stroke icon set, so the app has no icon-library dependency. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const TodayIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const PlansIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Icon>
);

export const CalendarIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
  </Icon>
);

export const CommunityIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6" />
  </Icon>
);

export const ProfileIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);

export const PlayIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </Icon>
);

export const PauseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 5v14M16 5v14" strokeWidth={3} />
  </Icon>
);

export const SkipIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 5.5v13l9-6.5z" fill="currentColor" />
    <path d="M18.5 5v14" strokeWidth={2.4} />
  </Icon>
);

export const UndoIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth={2.5} />
  </Icon>
);

export const ClockIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const FlameIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 22c4 0 7-2.7 7-6.8 0-3.6-2.4-6.1-4.1-8.2-.6 2-1.6 3.1-2.9 3.6C12.3 7.1 10.7 4.3 8.6 2c-.2 3.6-3.6 6.4-3.6 12.3C5 19 8 22 12 22z" />
  </Icon>
);

export const HeartIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 20s-7.5-4.6-9.2-9.4C1.6 7.2 3.8 4 7.2 4c2 0 3.4 1 4.8 2.8C13.4 5 14.8 4 16.8 4c3.4 0 5.6 3.2 4.4 6.6C19.5 15.4 12 20 12 20z" />
  </Icon>
);

/**
 * Braincells (kudos): one cute cartoon neuron — a soft, slightly irregular
 * cell body with a happy face, four short dendrites that fork into little
 * prongs, and one clearly longer axon curving away to the lower right with a
 * forked tip. Branches are tubes that merge into the body, so it reads as one
 * cell. Outlined in the text colour like the other icons; `active` (given)
 * fills it with gold and adds a soft glow and a tiny spark.
 */
const SOMA = "M9.4 3.9c3-.2 5.6 2 5.7 5 .1 2.7-1.4 5.1-3.9 5.8-2.8.9-6.1-.2-6.9-3.1-.8-3 .8-7.5 5.1-7.7Z";
const DENDRITES: { tube: string; tips: string }[] = [
  { tube: "M7.4 6.9C6.5 5.7 5.6 4.8 4.6 4", tips: "M4.6 4 2.9 4M4.6 4l-1-1.5M4.6 4l.3-1.8" },
  { tube: "M11.4 6.5c.8-1.2 1.6-2.1 2.6-2.7", tips: "M14 3.8l1.8.1M14 3.8l1.4-1.3M14 3.8l-.1-1.8" },
  { tube: "M6 10.4c-1.1.2-2.2.8-3 1.6", tips: "M3 12l-1.7-.4M3 12l-1.5 1.1M3 12l-.2 1.8" },
  { tube: "M13.3 8.7c1.1-.5 2.1-.6 3.1-.4", tips: "M16.4 8.3l1.6-.8M16.4 8.3l1.8.6M16.4 8.3l1.1 1.5" },
];
const AXON = {
  tube: "M11.4 12.6c1.4 1.9 3.4 2.1 4.6 3.6 1.1 1.4 1.8 2.7 3.4 3.7",
  tips: "M19.4 19.9l1.9-.1M19.4 19.9l1.5 1.4M19.4 19.9l.1 2",
};

export function BraincellIcon({ active = false, ...p }: P & { active?: boolean }) {
  // Ink brown in light mode, light in dark mode, so the outline never disappears.
  const line = active ? "var(--foreground)" : "currentColor";
  // The face sits on the gold body: always dark ink there.
  const face = active ? "#250A04" : "currentColor";
  // Not given: hollow, filled with the card's colour so tubes still merge into the body.
  const fill = active ? "var(--gold)" : "var(--surface)";
  const branches = [...DENDRITES.map((d) => ({ ...d, outer: 2.6, inner: 1.15 })), { ...AXON, outer: 2.9, inner: 1.45 }];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={active ? { filter: "drop-shadow(0 0 1.5px color-mix(in srgb, var(--gold) 65%, transparent))" } : undefined}
      {...p}
    >
      {/* forked tips, then each branch's outline */}
      {branches.map((b) => (
        <path key={`tips-${b.tube}`} d={b.tips} stroke={line} strokeWidth={1.2} />
      ))}
      {branches.map((b) => (
        <path key={`edge-${b.tube}`} d={b.tube} stroke={line} strokeWidth={b.outer} />
      ))}
      {/* the cell body */}
      <path d={SOMA} fill={fill} stroke={line} strokeWidth={1.5} />
      {/* branch insides, over the body's edge so they grow out of it */}
      {branches.map((b) => (
        <path key={`core-${b.tube}`} d={b.tube} stroke={fill} strokeWidth={b.inner} />
      ))}
      {/* face */}
      <circle cx={7.9} cy={8.8} r={0.85} fill={face} />
      <circle cx={11.3} cy={8.8} r={0.85} fill={face} />
      <path d="M8.2 10.9q1.4 1.3 2.8 0" stroke={face} strokeWidth={1.2} />
      {active && (
        <>
          <ellipse cx={6.6} cy={10.6} rx={0.85} ry={0.5} fill="var(--accent)" fillOpacity={0.45} />
          <ellipse cx={12.6} cy={10.6} rx={0.85} ry={0.5} fill="var(--accent)" fillOpacity={0.45} />
          {/* a tiny spark */}
          <path d="M20.3 11.9q.25 1.1 1.3 1.35-1.05.25-1.3 1.35-.25-1.1-1.3-1.35 1.05-.25 1.3-1.35Z" fill="var(--gold)" />
        </>
      )}
    </svg>
  );
}

export const CommentIcon = (p: P) => (
  <Icon {...p}>
    <path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.4A8.5 8.5 0 1 1 21 12z" />
  </Icon>
);

export const ChevronDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

export const MoonIcon = (p: P) => (
  <Icon {...p}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
  </Icon>
);

export const ChevronLeftIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const ChevronRightIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const SettingsIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);

export const MapPinIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
);

export const LockIcon = (p: P) => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);

export const GlobeIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18z" />
  </Icon>
);

export const XIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const CameraIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
);

export const EditIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Icon>
);

export const TrashIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  </Icon>
);

export const UsersIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
  </Icon>
);

export const SwordsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2" />
    <path d="M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2" />
  </Icon>
);
