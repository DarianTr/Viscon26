"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const DAY = 86_400_000;

/** Colors per kind of data point (CSS variables from globals.css). */
export const TYPE_COLOR: Record<string, string> = {
  practice: "var(--deep)",
  quiz: "var(--intervals)",
  mock: "var(--recovery)",
  exam: "var(--tempo)",
};
export const TYPE_LABEL: Record<string, string> = {
  practice: "Practice sheet",
  quiz: "Quiz",
  mock: "Mock exam",
  exam: "Exam",
};

/** Exams are assumed to be in the morning, as in the knowledge service. */
export const examTime = (date: string) => Date.parse(`${date}T09:00:00Z`);

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Zurich" });
export const formatDay = (t: number) => shortDate.format(new Date(t));

/** Width of an element, kept up to date. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Bumps when the color scheme changes, so canvases repaint with the new colors. */
export function useSchemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setV((x) => x + 1);
    mq.addEventListener("change", bump);
    return () => mq.removeEventListener("change", bump);
  }, []);
  return v;
}

function cssColor(variable: string): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = `var(${variable})`;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
  probe.remove();
  return [rgb[0], rgb[1], rgb[2]];
}

export type Density = { m: number; s: number; peak: number } | null;

/**
 * Paint a distribution over time: each pixel's opacity is the normal density
 * at that value relative to the column's peak. `lookup` takes a time in ms.
 * Values are scores (0–1) on the y axis from `lo` (bottom) to `hi` (top).
 */
export function paintDensity(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  t0: number,
  t1: number,
  lookup: (t: number) => Density,
  lo = 0,
  hi = 1,
  colorVar = "--foreground",
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(width * dpr));
  const H = Math.max(1, Math.round(height * dpr));
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(W, H);
  const [r, g, b] = cssColor(colorVar);
  for (let i = 0; i < W; i++) {
    const c = lookup(t0 + ((i + 0.5) / W) * (t1 - t0));
    if (!c) continue;
    for (let j = 0; j < H; j++) {
      const z = (hi - ((j + 0.5) / H) * (hi - lo) - c.m) / c.s;
      if (z > 3.3 || z < -3.3) continue;
      const k = 4 * (j * W + i);
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = Math.round(255 * c.peak * Math.exp(-0.5 * z * z));
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Value of a piecewise-linear series at t; at a jump the later point wins. */
export function interpolate(pts: { t: number; m: number; s: number }[], t: number) {
  if (!pts.length || t < pts[0].t || t > pts[pts.length - 1].t) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = pts[lo];
  const b = pts[lo + 1];
  if (!b || b.t === a.t) return a;
  const w = (t - a.t) / (b.t - a.t);
  return { t, m: a.m + w * (b.m - a.m), s: a.s + w * (b.s - a.s) };
}

/** A small vertical bar shaded like the score's own measurement distribution. */
export function MeasurementGradients({ prefix }: { prefix: string }) {
  return (
    <defs>
      {Object.entries(TYPE_COLOR).map(([type, color]) => (
        <linearGradient key={type} id={`${prefix}-${type}`} x1="0" x2="0" y1="0" y2="1">
          {Array.from({ length: 13 }, (_, i) => {
            const z = 1.96 - (3.92 * i) / 12;
            return <stop key={i} offset={i / 12} stopColor={color} stopOpacity={Math.exp(-0.5 * z * z)} />;
          })}
        </linearGradient>
      ))}
    </defs>
  );
}
