/**
 * Client for the ETH Vorlesungsverzeichnis (VVZ).
 *
 * Fetches a course detail page and extracts topic/content information from the
 * "Inhalt" / "Content" section. Falls back gracefully — callers are expected to
 * supply curated topics whenever the fetch or parse fails.
 *
 * Also discovers publicly-accessible course materials (PDFs, exercise sheets,
 * scripts) linked from the course's own website.
 */

export type VvzCourseData = {
  name: string;
  description: string;
  topics: string[];
  /** VVZ "Lernziel" / "Learning objective" section. */
  learningObjectives: string;
  /** VVZ "Literatur" / "Literature" section (textbook references). */
  literature: string;
  /** Script/lecture-notes note from VVZ "Skript" / "Lecture notes" section. */
  scriptNote: string;
  /** First external non-ETH-VVZ URL found in the course's links section. */
  websiteUrl: string | null;
  sourceUrl: string;
};

export type ResourceLink = {
  title: string;
  url: string;
  type: "script" | "exercises" | "slides" | "exam" | "solution" | "website" | "other";
};

const VVZ_BASE =
  "https://www.vvz.ethz.ch/Vorlesungsverzeichnis/sucheLehrangebotPre.view";

// Try most-recent completed semesters first.
const SEMESTERS = ["2025W", "2025S", "2024W", "2024S"];

export async function fetchVvzCourse(courseCode: string): Promise<VvzCourseData | null> {
  for (const semester of SEMESTERS) {
    const url =
      `${VVZ_BASE}?semkez=${semester}&anzeigeSet=LERNEINHEIT` +
      `&lerneinheitscode=${encodeURIComponent(courseCode)}&lang=en`;
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/html", "User-Agent": "VisCon26/1.0 (course-profiler)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const parsed = parseVvzHtml(html, url);
      if (parsed && parsed.topics.length >= 3) return parsed;
    } catch {
      // Network error or timeout — try the next semester.
    }
  }
  return null;
}

/**
 * Searches VVZ by course name and returns topic data for the best match.
 * Useful when no course code is known — e.g. when a student adds an arbitrary
 * subject name that isn't already in course_profiles.
 */
export async function fetchVvzCourseByName(name: string): Promise<VvzCourseData | null> {
  for (const semester of SEMESTERS) {
    const searchUrl =
      `${VVZ_BASE}?semkez=${semester}&anzeigeSet=LERNEINHEIT` +
      `&suche=${encodeURIComponent(name)}&lang=en`;
    try {
      const res = await fetch(searchUrl, {
        headers: { Accept: "text/html", "User-Agent": "VisCon26/1.0 (course-profiler)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();

      // Case 1: the search matched exactly one course and VVZ redirected to its
      // detail page — try parsing directly.
      const direct = parseVvzHtml(html, searchUrl);
      if (direct && direct.topics.length >= 3) return direct;

      // Case 2: search results page — find the first course code link and
      // fetch its detail page.
      const code = extractCourseCodeFromHtml(html);
      if (code) {
        const detail = await fetchVvzCourse(code);
        if (detail) return detail;
      }
    } catch {
      // Try next semester.
    }
  }
  return null;
}

/**
 * Fetches a course website and returns links to course materials (PDFs,
 * exercise sheets, scripts). Handles relative URLs. Returns at most 40
 * links to avoid flooding the DB.
 */
export async function discoverResourceLinks(websiteUrl: string): Promise<ResourceLink[]> {
  let html: string;
  try {
    const res = await fetch(websiteUrl, {
      headers: { Accept: "text/html", "User-Agent": "VisCon26/1.0 (course-profiler)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const base = new URL(websiteUrl);
  const links: ResourceLink[] = [];
  const seen = new Set<string>();

  // Match all <a href="...">text</a> pairs.
  const linkRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null && links.length < 40) {
    const raw = m[1].trim();
    const text = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) continue;

    let href: string;
    try {
      href = new URL(raw, base).href;
    } catch {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);

    const type = classifyResource(href, text);
    if (type === null) continue; // skip nav links, images, etc.

    const title = text.length >= 3 ? text : inferTitle(href);
    links.push({ title: title.slice(0, 200), url: href, type });
  }

  return links;
}

/**
 * Fetches a URL and returns the plain-text content, capped at 100 k chars.
 * Returns null for non-HTML responses (PDFs, images) or on error.
 */
export async function fetchPageContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "VisCon26/1.0 (course-profiler)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    // Only extract text from HTML pages, not PDFs or binaries.
    if (!ct.includes("html") && !ct.includes("text/plain")) return null;
    const html = await res.text();
    const text = stripHtml(html).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return text.slice(0, 100_000);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: resource classification
// ---------------------------------------------------------------------------

const EXERCISE_RE = /exercise|exercises|uebung|übung|serie|blatt|aufgabe|homework|hw\d/i;
const SCRIPT_RE = /script|skript|lecture.note|notes|vorlesung/i;
const SOLUTION_RE = /solution|lösung|losung|sol\b/i;
const EXAM_RE = /exam|pruefung|prüfung|klausur|midterm|final/i;
const SLIDES_RE = /slide|folie|presentation/i;

function classifyResource(url: string, text: string): ResourceLink["type"] | null {
  const combined = `${url} ${text}`.toLowerCase();

  // Always include PDFs — they're course materials.
  const isPdf = url.toLowerCase().endsWith(".pdf");

  // Skip clearly non-content links.
  const skip = /\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|mp4|zip)$/i;
  if (!isPdf && skip.test(url)) return null;

  // Skip pure navigation links (very short text, no PDF, no keywords).
  if (!isPdf && text.length < 4 && !EXERCISE_RE.test(combined) && !SCRIPT_RE.test(combined)) {
    return null;
  }

  if (SOLUTION_RE.test(combined)) return "solution";
  if (EXAM_RE.test(combined)) return "exam";
  if (EXERCISE_RE.test(combined)) return "exercises";
  if (SLIDES_RE.test(combined)) return "slides";
  if (SCRIPT_RE.test(combined)) return "script";
  if (isPdf) return "other";

  // Non-PDF links that don't match keywords: only keep if they look like
  // sub-pages of the same course site.
  return "website";
}

function inferTitle(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path.split("/").filter(Boolean).pop()?.replace(/[-_]/g, " ").replace(/\.pdf$/i, "") ?? url;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Internal: VVZ HTML parsing
// ---------------------------------------------------------------------------

/** Extracts the first ETH course code (e.g. "252-0025-01") found in HTML. */
function extractCourseCodeFromHtml(html: string): string | null {
  // VVZ search results contain links like: lerneinheitscode=252-0025-01
  const m = html.match(/lerneinheitscode=(\d{3}-\d{4}-\d{2})/i);
  return m?.[1] ?? null;
}

function parseVvzHtml(html: string, sourceUrl: string): VvzCourseData | null {
  const name = extractTitle(html);
  const contentHtml = extractSection(html, ["Content", "Inhalt"]);
  if (!contentHtml) return null;

  const description = stripHtml(contentHtml).replace(/\s+/g, " ").trim().slice(0, 1000);
  const topics = extractTopics(contentHtml);
  if (topics.length === 0) return null;

  const learningObjectives = extractSectionText(html, [
    "Learning objective",
    "Lernziel",
    "Learning objectives",
  ]);
  const literature = extractSectionText(html, [
    "Literature / Suggested reading",
    "Literatur",
    "Literature",
    "Suggested reading",
  ]);
  const scriptNote = extractSectionText(html, ["Lecture notes", "Skript"]);
  const websiteUrl = extractCourseWebsite(html, sourceUrl);

  return { name, description, topics, learningObjectives, literature, scriptNote, websiteUrl, sourceUrl };
}

function extractTitle(html: string): string {
  // VVZ page: <title>Discrete Mathematics | Course Catalogue | ETH Zurich</title>
  const m = html.match(/<title>([^|<]+)/i);
  return m ? m[1].trim() : "Unknown";
}

/**
 * Finds a labelled section in VVZ HTML.
 * Two common layouts:
 *   1. Table row: <th>Content</th><td>…content…</td>
 *   2. Labelled heading: <h3>Content</h3>…<p>…</p>
 */
function extractSection(html: string, labels: string[]): string | null {
  for (const label of labels) {
    // Layout 1 – table cell
    const tableRe = new RegExp(
      `<t[hd][^>]*>\\s*${label}\\s*<\\/t[hd]>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
      "i",
    );
    const tableMatch = html.match(tableRe);
    if (tableMatch?.[1]?.trim()) return tableMatch[1];

    // Layout 2 – heading + following block
    const headingRe = new RegExp(
      `<h[23][^>]*>\\s*${label}\\s*<\\/h[23]>([\\s\\S]*?)(?=<h[23]|<\\/div>|<\\/section>)`,
      "i",
    );
    const headingMatch = html.match(headingRe);
    if (headingMatch?.[1]?.trim()) return headingMatch[1];
  }
  return null;
}

/** Extract a section as plain text (used for objectives, literature, etc.). */
function extractSectionText(html: string, labels: string[]): string {
  const sectionHtml = extractSection(html, labels);
  if (!sectionHtml) return "";
  return stripHtml(sectionHtml).replace(/\s+/g, " ").trim().slice(0, 2000);
}

/**
 * Finds the course's own website URL from the VVZ "Links" or content
 * sections. Prefers non-VVZ ETH links (n.ethz.ch, disco.ethz.ch, etc.)
 * over generic ETH.ch navigation.
 */
function extractCourseWebsite(html: string, sourceUrl: string): string | null {
  // Try the explicit Links section first.
  const linksHtml =
    extractSection(html, ["Links", "Link", "External links", "Webseite", "Website"]) ?? html;

  const hrefRe = /href=["']([^"']+)["']/gi;
  const skip = /vvz\.ethz\.ch|javascript:|mailto:|#|\.css|\.js|www\.ethz\.ch\/en\/|\.ethz\.ch\/(de|en)\//i;
  const prefer = /\.ethz\.ch\//i;

  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(linksHtml)) !== null) {
    const href = m[1].trim();
    if (!href.startsWith("http")) continue;
    if (skip.test(href)) continue;
    candidates.push(href);
  }

  // Prefer links that look like course sub-sites over generic ETH pages.
  return candidates.find((u) => prefer.test(u) && !u.includes("news") && !u.includes("search"))
    ?? candidates[0]
    ?? null;
}

function extractTopics(html: string): string[] {
  const topics: string[] = [];

  // 1. Explicit list items are the cleanest source.
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html)) !== null) {
    const text = clean(stripHtml(m[1]));
    if (text.length >= 3 && text.length < 120) topics.push(text);
  }
  if (topics.length >= 3) return topics.slice(0, 16);

  // 2. Sentences or phrases split on punctuation / line breaks.
  const raw = stripHtml(html);
  const parts = raw
    .split(/[;\n•·–\-]{1,3}/)
    .map(clean)
    .filter((s) => s.length >= 4 && s.length < 120);
  return parts.slice(0, 16);
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^[-•\s]+|[-•\s]+$/g, "").trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "");
}
