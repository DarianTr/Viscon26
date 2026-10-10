/**
 * Score ↔ grade conversion and the small bits of probability the knowledge
 * pages need. Shared by server and client code.
 *
 * Scores are fractions correct (0–1). Grades use the Swiss 1–6 scale, mapped
 * linearly for now: grade = 1 + 5 × score.
 */

export const toGrade = (score: number) => 1 + 5 * score;
export const fromGrade = (grade: number) => (grade - 1) / 5;
/** A score's sd expressed in grade units. */
export const gradeSd = (sd: number) => 5 * sd;

export const formatGrade = (score: number) => toGrade(Math.min(1, Math.max(0, score))).toFixed(2);

/** z for a central 90% interval. */
export const Z90 = 1.6449;

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, error < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Chance that a normal(mean, sd) score reaches at least `target` (both as scores). */
export const chanceAtLeast = (mean: number, sd: number, target: number) =>
  1 - normalCdf((target - mean) / Math.max(sd, 1e-9));
