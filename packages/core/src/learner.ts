import { cosine, Embedder, HashedNgramEmbedder } from './embed';

export type Polarity = 'harmful' | 'fine';

export interface Example {
  id: string;
  text: string;
  categoryId: string;
  polarity: Polarity;
  /** User's own explanation of why. */
  note?: string;
  /** Host where it was tagged, kept locally for the user's own review. */
  host?: string;
  createdAt: number;
  source: 'tag' | 'override' | 'import';
}

export interface LearnedHit {
  categoryId: string;
  similarity: number;
  exampleId: string;
  /** True when a "fine" example matched more strongly and cancelled the hit. */
  suppressed: boolean;
  suppressedBy?: string;
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Split long text into overlapping windows so a short example can match inside a long post. */
export function windows(text: string, maxWords = 40): string[] {
  const sentences = text.split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [text];
  for (let i = 0; i < sentences.length; i++) {
    out.push(sentences[i]);
    if (i + 1 < sentences.length) out.push(sentences[i] + ' ' + sentences[i + 1]);
  }
  const words = text.split(/\s+/);
  if (words.length > maxWords) {
    for (let i = 0; i < words.length; i += Math.floor(maxWords / 2)) out.push(words.slice(i, i + maxWords).join(' '));
  }
  return [...new Set(out)].slice(0, 64);
}

export class Learner {
  private vectors = new Map<string, Float32Array>();
  examples: Example[] = [];

  constructor(private embedder: Embedder = new HashedNgramEmbedder()) {}

  load(examples: Example[]) {
    this.examples = [...examples];
    this.vectors.clear();
    for (const e of this.examples) this.vectors.set(e.id, this.embedder.embed(e.text));
  }

  add(input: Omit<Example, 'id' | 'createdAt'> & Partial<Pick<Example, 'id' | 'createdAt'>>): Example {
    const ex: Example = { id: input.id ?? uid(), createdAt: input.createdAt ?? Date.now(), ...input } as Example;
    this.examples.push(ex);
    this.vectors.set(ex.id, this.embedder.embed(ex.text));
    return ex;
  }

  remove(id: string): boolean {
    const before = this.examples.length;
    this.examples = this.examples.filter((e) => e.id !== id);
    this.vectors.delete(id);
    return this.examples.length < before;
  }

  removeCategory(categoryId: string) {
    for (const e of this.examples.filter((x) => x.categoryId === categoryId)) this.remove(e.id);
  }

  /**
   * Find the best learned match for `text`.
   * @param thresholdFor returns the similarity threshold for a category (from user sensitivity).
   */
  match(text: string, thresholdFor: (categoryId: string) => number): LearnedHit | null {
    if (this.examples.length === 0) return null;
    const wins = windows(text).map((w) => this.embedder.embed(w));
    let bestPos: { e: Example; s: number } | null = null;
    let bestNeg: { e: Example; s: number } | null = null;
    for (const e of this.examples) {
      const ev = this.vectors.get(e.id)!;
      let s = 0;
      for (const w of wins) s = Math.max(s, cosine(ev, w));
      if (e.polarity === 'harmful') {
        if (s >= thresholdFor(e.categoryId) && (!bestPos || s > bestPos.s)) bestPos = { e, s };
      } else if (!bestNeg || s > bestNeg.s) bestNeg = { e, s };
    }
    if (!bestPos) return null;
    const suppressed = !!bestNeg && bestNeg.s >= bestPos.s && bestNeg.s >= thresholdFor(bestNeg.e.categoryId);
    return {
      categoryId: bestPos.e.categoryId,
      similarity: bestPos.s,
      exampleId: bestPos.e.id,
      suppressed,
      suppressedBy: suppressed ? bestNeg!.e.id : undefined,
    };
  }

  /** Learning progress per category, for the dashboard. */
  stats(): Record<string, { harmful: number; fine: number }> {
    const out: Record<string, { harmful: number; fine: number }> = {};
    for (const e of this.examples) {
      out[e.categoryId] ??= { harmful: 0, fine: 0 };
      out[e.categoryId][e.polarity]++;
    }
    return out;
  }
}

/** Map a 0..1 sensitivity to a cosine similarity threshold. Higher sensitivity = looser match. */
export function similarityThreshold(sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 0.8 - 0.4 * s; // 0 -> 0.80, 0.5 -> 0.60, 1 -> 0.40
}
