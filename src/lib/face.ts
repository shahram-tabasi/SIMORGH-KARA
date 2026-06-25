/**
 * Face-recognition helpers (server side). Embeddings are computed on-device
 * (TFLite FaceNet/MobileFaceNet); the server only stores L2-normalized vectors
 * and matches them with cosine similarity — no ML runtime needed here.
 */

/** Default cosine-similarity threshold for a confident match. */
export const FACE_MATCH_THRESHOLD = 0.62;

/** Validate an incoming embedding: finite numbers within a sane dimension. */
export function parseEmbedding(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length < 32 || input.length > 2048) return null;
  const out: number[] = [];
  for (const x of input) {
    const n = typeof x === "number" ? x : Number(x);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

/** L2-normalize so cosine similarity is a plain dot product. */
export function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const mag = Math.sqrt(sum);
  if (mag === 0) return v.slice();
  return v.map((x) => x / mag);
}

/** Cosine similarity of two equal-length, L2-normalized vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Best match for a probe against enrolled samples (already normalized). */
export function bestMatch(
  probe: number[],
  samples: { member_id: string; vec: number[] }[]
): { memberId: string; score: number } | null {
  let best: { memberId: string; score: number } | null = null;
  for (const s of samples) {
    const score = cosine(probe, s.vec);
    if (!best || score > best.score) best = { memberId: s.member_id, score };
  }
  return best;
}
