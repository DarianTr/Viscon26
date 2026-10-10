/**
 * Client for the ETH Vorlesungsverzeichnis (VVZ).
 *
 * Fetches a course detail page and extracts topic/content information from the
 * "Inhalt" / "Content" section. Falls back gracefully — callers are expected to
 * supply curated topics whenever the fetch or parse fails.
 */

export type VvzCourseData = {
  name: string;
  description: string;
  topics: string[];
  sourceUrl: string;
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

/** Extracts the first ETH course code (e.g. "252-0025-01") found in HTML. */
function extractCourseCodeFromHtml(html: string): string | null {
  // VVZ search results contain links like: lerneinheitscode=252-0025-01
  const m = html.match(/lerneinheitscode=(\d{3}-\d{4}-\d{2})/i);
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// HTML parsing helpers
// ---------------------------------------------------------------------------

function parseVvzHtml(html: string, sourceUrl: string): VvzCourseData | null {
  const name = extractTitle(html);
  const contentHtml = extractSection(html, ["Content", "Inhalt"]);
  if (!contentHtml) return null;

  const description = stripHtml(contentHtml).replace(/\s+/g, " ").trim().slice(0, 1000);
  const topics = extractTopics(contentHtml);
  if (topics.length === 0) return null;

  return { name, description, topics, sourceUrl };
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
