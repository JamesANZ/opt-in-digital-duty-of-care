/**
 * @title Personal learner
 * @notice Matches new text against examples the user has taught, entirely on device.
 */

import { cosine, Embedder, HashedNgramEmbedder } from './embed';

/**
 * @notice Whether an example is something the user does not want, or something they marked as fine.
 */
export type Polarity = 'harmful' | 'fine';

/**
 * @notice One piece of text the user taught the browser.
 */
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

/**
 * @notice The closest taught example for a piece of text.
 */
export interface LearnedHit {
  categoryId: string;
  similarity: number;
  exampleId: string;
  /** True when a "fine" example matched more strongly and cancelled the hit. */
  suppressed: boolean;
  suppressedBy?: string;
}

/**
 * @notice Mint an id for a new example.
 * @return A short id from random bits and the current time.
 */
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * @notice Split long text so a short example can match inside a long post.
 * @param text Text to window.
 * @param maxWords Word count of each sliding window. Defaults to 40.
 * @return The full text, sentences, sentence pairs, and word windows, capped at 64 pieces.
 */
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

/**
 * @title Learner
 * @notice Stores taught examples and finds the best match for new text.
 */
export class Learner {
  private vectors = new Map<string, Float32Array>();
  examples: Example[] = [];

  /**
   * @notice Create a learner.
   * @param embedder Embedder used for new and loaded examples. Defaults to the hashed n-gram embedder.
   */
  constructor(private embedder: Embedder = new HashedNgramEmbedder()) {}

  /**
   * @notice Replace the stored examples and recompute their vectors.
   * @param examples Examples loaded from the encrypted profile.
   */
  load(examples: Example[]) {
    this.examples = [...examples];
    this.vectors.clear();
    for (const e of this.examples) this.vectors.set(e.id, this.embedder.embed(e.text));
  }

  /**
   * @notice Store one example and its vector.
   * @param input Example fields. `id` and `createdAt` are filled in when omitted.
   * @return The stored example.
   */
  add(input: Omit<Example, 'id' | 'createdAt'> & Partial<Pick<Example, 'id' | 'createdAt'>>): Example {
    const ex: Example = { id: input.id ?? uid(), createdAt: input.createdAt ?? Date.now(), ...input } as Example;
    this.examples.push(ex);
    this.vectors.set(ex.id, this.embedder.embed(ex.text));
    return ex;
  }

  /**
   * @notice Delete one example.
   * @param id Example id.
   * @return True when an example was removed.
   */
  remove(id: string): boolean {
    const before = this.examples.length;
    this.examples = this.examples.filter((e) => e.id !== id);
    this.vectors.delete(id);
    return this.examples.length < before;
  }

  /**
   * @notice Delete every example in a category.
   * @param categoryId Category id, usually a custom category being removed.
   */
  removeCategory(categoryId: string) {
    for (const e of this.examples.filter((x) => x.categoryId === categoryId)) this.remove(e.id);
  }

  /**
   * @notice Find the best taught match for a piece of text.
   * @dev A "fine" example that matches at least as strongly as the harmful one suppresses the hit.
   * @param text Text to compare with the stored examples.
   * @param thresholdFor Similarity threshold for a category, from that category's sensitivity.
   * @return The best harmful match, including when a fine example suppressed it, or null.
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

  /**
   * @notice Count taught examples per category.
   * @return Harmful and fine counts keyed by category id.
   */
  stats(): Record<string, { harmful: number; fine: number }> {
    const out: Record<string, { harmful: number; fine: number }> = {};
    for (const e of this.examples) {
      out[e.categoryId] ??= { harmful: 0, fine: 0 };
      out[e.categoryId][e.polarity]++;
    }
    return out;
  }
}

/**
 * @notice Turn a sensitivity slider into the cosine similarity a match must reach.
 * @dev 0 maps to 0.80 and 1 maps to 0.40. Higher sensitivity is a looser match.
 * @param sensitivity Sensitivity from 0 to 1. Values outside that range are clamped.
 * @return Cosine threshold.
 */
export function similarityThreshold(sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 0.8 - 0.4 * s; // 0 -> 0.80, 0.5 -> 0.60, 1 -> 0.40
}
