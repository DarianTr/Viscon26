"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { ClockIcon, XIcon } from "@/components/icons";
import { eventLabel, formatMinutes, phaseLabels, subjectColor } from "@/lib/session-types";
import type { CalendarEvent } from "@/lib/types";

/** Space kept between the popover and the block it points at, and around the viewport edge. */
const gap = 10;
const margin = 12;
/** Half the arrow's diagonal, so it sits flush against the popover's border. */
const arrow = 7;

const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

type Side = "right" | "left" | "below" | "above";

/** Borders the arrow shares with the popover, so it reads as a speech bubble's tail. */
const arrowEdges: Record<Side, string> = {
  right: "border-b-2 border-l-2",
  left: "border-t-2 border-r-2",
  below: "border-t-2 border-l-2",
  above: "border-b-2 border-r-2",
};

/**
 * Where the bubble goes: beside the block, like Apple Calendar, where there's
 * room — on a phone's narrow week columns, above or below it instead.
 */
function place(anchor: DOMRect, width: number, height: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
  // Point at the part of a tall block that's on screen.
  const cy = (Math.max(anchor.top, 0) + Math.min(anchor.bottom, vh)) / 2;
  const cx = anchor.left + anchor.width / 2;

  const beside = (side: "right" | "left", left: number) => {
    const top = clamp(cy - height / 2, margin, vh - margin - height);
    return { side, left, top, arrowAt: clamp(cy - top, 18, height - 18) };
  };
  if (anchor.right + gap + width <= vw - margin) return beside("right", anchor.right + gap);
  if (anchor.left - gap - width >= margin) return beside("left", anchor.left - gap - width);

  const left = clamp(cx - width / 2, margin, vw - margin - width);
  const side: Side = anchor.bottom + gap + height <= vh - margin || anchor.top - gap - height < margin ? "below" : "above";
  const top = side === "below" ? anchor.bottom + gap : anchor.top - gap - height;
  return { side, left, top: clamp(top, margin, vh - margin - height), arrowAt: clamp(cx - left, 18, width - 18) };
}

/**
 * A small bubble with a calendar block's details, pointing at the block that
 * was clicked. Esc, a click elsewhere or scrolling the page closes it.
 */
export function EventPopover({
  event,
  anchor,
  onClose,
  children,
}: {
  event: CalendarEvent;
  /** The clicked block's position on screen. */
  anchor: DOMRect;
  onClose: () => void;
  /** Actions for the block, e.g. skip, edit and delete. */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLSpanElement>(null);
  const titleId = useId();
  const start = new Date(event.start);

  // Measure, then place before paint, so it never flashes in the wrong spot.
  useLayoutEffect(() => {
    const box = ref.current;
    const tail = arrowRef.current;
    if (!box || !tail) return;
    const { side, left, top, arrowAt } = place(anchor, box.offsetWidth, box.offsetHeight);
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, visibility: "visible" });
    tail.className = `absolute size-3.5 rotate-45 border-foreground bg-surface ${arrowEdges[side]}`;
    Object.assign(tail.style, {
      left: side === "right" ? `${-arrow - 1}px` : side === "left" ? "" : `${arrowAt - arrow}px`,
      right: side === "left" ? `${-arrow - 1}px` : "",
      top: side === "below" ? `${-arrow - 1}px` : side === "above" ? "" : `${arrowAt - arrow}px`,
      bottom: side === "above" ? `${-arrow - 1}px` : "",
    });
  }, [anchor, event]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    // The bubble is fixed to the screen; once the block scrolls away it points at nothing.
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      style={{ visibility: "hidden" }}
      className="fixed z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border-2 border-foreground bg-surface text-foreground shadow-[0_4px_0_0_var(--foreground)] motion-safe:animate-[popover-in_120ms_ease-out]"
    >
      <span ref={arrowRef} aria-hidden />
      {/* Above the arrow, so its inner half doesn't show through. */}
      <div className="relative rounded-2xl bg-surface p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">{eventLabel(event)}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1.5 grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
        <h3 id={titleId} className={`mt-0.5 font-display text-base leading-snug font-bold ${event.skipped ? "text-muted line-through" : ""}`}>
          {event.title}
        </h3>

        <div className="mt-3 space-y-1 text-sm">
          <p>{dayFormat.format(start)}</p>
          <p className="flex items-center gap-1.5 text-muted tabular-nums">
            <ClockIcon className="size-3.5" />
            {timeFormat.format(start)}–{timeFormat.format(new Date(event.end))} · {formatMinutes(event.minutes)}
          </p>
        </div>

        {(event.subject || event.prepPhase || event.done || event.skipped) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-xs">
            {event.subject && (
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span className="size-2 rounded-full" style={{ background: subjectColor(event.subject).value }} />
                {event.subject}
              </span>
            )}
            {event.prepPhase && <span className="text-muted">· {phaseLabels[event.prepPhase]} phase</span>}
            {event.done && <span className="ml-auto rounded-full bg-recovery/12 px-2 py-0.5 font-semibold text-recovery">Done</span>}
            {event.skipped && <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-muted">Skipped</span>}
          </div>
        )}
        {event.cheatsheetMinutes !== null && event.cheatsheetMinutes > 0 && (
          <p className="mt-1.5 text-xs text-muted">
            {formatMinutes(event.cheatsheetMinutes)} cheatsheet
            {event.cheatsheetTarget !== null && ` · aim: ${event.cheatsheetTarget}%`}
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-muted">{event.manual ? "Added by you" : "From your study plan"}</p>

        {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
      </div>
    </div>
  );
}
