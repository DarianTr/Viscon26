import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { handle, jsonError } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import type { CourseMaterialType } from "@/db/schema";

type Ctx = RouteContext<"/api/plans/[id]/subjects/files">;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB per file
const MAX_FILES_PER_REQUEST = 10;
const MAX_CONTENT_LENGTH = 100_000; // chars stored per file

/**
 * POST /api/plans/[id]/subjects/files
 * Multipart form data fields:
 *   subject  — the subject name this file belongs to
 *   files    — one or more files
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id: planId } = await ctx.params;

    // Verify plan ownership.
    const [plan] = await db
      .select({ id: s.userPlans.id })
      .from(s.userPlans)
      .where(and(eq(s.userPlans.id, planId), eq(s.userPlans.userId, user.id)));
    if (!plan) return jsonError(404, "Plan not found");

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return jsonError(400, "Expected multipart/form-data");
    }

    const subject = (formData.get("subject") as string | null)?.trim();
    if (!subject) return jsonError(400, "subject field is required");

    const rawFiles = formData.getAll("files") as File[];
    if (rawFiles.length === 0) return jsonError(400, "No files provided");
    if (rawFiles.length > MAX_FILES_PER_REQUEST) {
      return jsonError(400, `Maximum ${MAX_FILES_PER_REQUEST} files per request`);
    }

    const saved: { id: string; filename: string; type: CourseMaterialType }[] = [];

    for (const file of rawFiles) {
      if (file.size > MAX_FILE_SIZE) {
        return jsonError(413, `File "${file.name}" exceeds the 20 MB limit`);
      }

      const mimeType = file.type || guessMimeType(file.name);
      const type = classifyFile(file.name, mimeType);

      // Extract text content for searchable formats.
      const content = await extractText(file, mimeType);

      const [row] = await db
        .insert(s.userCourseMaterials)
        .values({
          userId: user.id,
          userPlanId: planId,
          subject,
          filename: file.name,
          mimeType,
          type,
          fileSize: file.size,
          content,
        })
        .returning({ id: s.userCourseMaterials.id });

      saved.push({ id: row.id, filename: file.name, type });
    }

    return Response.json({ saved }, { status: 201 });
  });
}

/**
 * GET /api/plans/[id]/subjects/files?subject=Analysis
 * Lists materials for a plan (and optionally a specific subject).
 */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id: planId } = await ctx.params;
    const subject = new URL(req.url).searchParams.get("subject");

    const [plan] = await db
      .select({ id: s.userPlans.id })
      .from(s.userPlans)
      .where(and(eq(s.userPlans.id, planId), eq(s.userPlans.userId, user.id)));
    if (!plan) return jsonError(404, "Plan not found");

    const rows = await db
      .select({
        id: s.userCourseMaterials.id,
        subject: s.userCourseMaterials.subject,
        filename: s.userCourseMaterials.filename,
        type: s.userCourseMaterials.type,
        fileSize: s.userCourseMaterials.fileSize,
        hasContent: s.userCourseMaterials.content,
        createdAt: s.userCourseMaterials.createdAt,
      })
      .from(s.userCourseMaterials)
      .where(
        subject
          ? and(eq(s.userCourseMaterials.userPlanId, planId), eq(s.userCourseMaterials.subject, subject))
          : eq(s.userCourseMaterials.userPlanId, planId),
      );

    return Response.json({
      materials: rows.map((r) => ({ ...r, hasContent: r.hasContent !== null })),
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    tex: "text/x-tex",
    py: "text/x-python",
    ipynb: "application/x-ipynb+json",
  };
  return map[ext] ?? "application/octet-stream";
}

const EXERCISE_RE = /exercise|exercises|uebung|übung|serie|blatt|aufgabe|homework/i;
const EXAM_RE = /exam|pruefung|prüfung|klausur|midterm|final/i;
const SOLUTION_RE = /solution|lösung|losung|sol\b/i;
const SLIDES_RE = /slide|folie|presentation|vorlesung/i;
const SCRIPT_RE = /script|skript|lecture.note|notes/i;

function classifyFile(filename: string, mime: string): CourseMaterialType {
  const name = filename.toLowerCase();
  if (SOLUTION_RE.test(name)) return "solution";
  if (EXAM_RE.test(name)) return "exam";
  if (EXERCISE_RE.test(name)) return "exercises";
  if (SLIDES_RE.test(name)) return "slides";
  if (SCRIPT_RE.test(name)) return "script";
  if (mime === "application/pdf") return "other";
  return "other";
}

async function extractText(file: File, mimeType: string): Promise<string | null> {
  // Plain text formats: read directly.
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/x-ipynb+json" ||
    mimeType === "application/json"
  ) {
    const text = await file.text();
    return text.slice(0, MAX_CONTENT_LENGTH) || null;
  }

  // PDFs: attempt basic text extraction by scanning for readable text streams.
  // This covers text-based PDFs without requiring a native binary dependency.
  if (mimeType === "application/pdf") {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const text = extractPdfText(buffer);
      return text ? text.slice(0, MAX_CONTENT_LENGTH) : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Minimal PDF text extraction: reads raw content streams and decodes BT/ET
 * text blocks. Covers the majority of text-based ETH course PDFs without
 * requiring a native binary (pdf-parse / pdfjs-dist).
 *
 * Returns null for scanned/image-only PDFs or encrypted files.
 */
function extractPdfText(buf: Buffer): string | null {
  const raw = buf.toString("latin1");

  // Quick sanity check.
  if (!raw.startsWith("%PDF")) return null;

  const chunks: string[] = [];

  // Extract text from BT (Begin Text) … ET (End Text) blocks.
  const btRe = /BT([\s\S]*?)ET/g;
  let m: RegExpExecArray | null;
  while ((m = btRe.exec(raw)) !== null) {
    const block = m[1];
    // Tj / TJ operators carry the visible text.
    const tjRe = /\(([^)]*)\)\s*Tj|\[([^\]]*)\]\s*TJ/g;
    let tj: RegExpExecArray | null;
    while ((tj = tjRe.exec(block)) !== null) {
      const segment = tj[1] ?? tj[2] ?? "";
      // Decode escape sequences and filter non-printable bytes.
      const decoded = segment
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, " ")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
        .replace(/[^\x20-\x7E\n]/g, "");
      if (decoded.trim()) chunks.push(decoded);
    }
  }

  if (chunks.length === 0) return null;
  return chunks.join(" ").replace(/\s{3,}/g, "  ").trim();
}
