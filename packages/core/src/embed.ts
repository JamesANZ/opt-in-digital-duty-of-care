/**
 * On-device text embedding used for personal learning.
 *
 * A hashed bag of word unigrams, word bigrams and character trigrams, L2-normalised.
 * It is small (no model download), deterministic and fast enough to run on every block of
 * every page on a phone. It captures lexical and near-lexical similarity ("you're so ugly"
 * vs "ur sooo ugly lol"); semantic paraphrase beyond that is delegated to JEV, which receives
 * the user's description and examples for each custom category.
 *
 * The interface (`Embedder`) lets a platform swap in a neural on-device model later.
 */

export interface Embedder {
  dim: number;
  embed(text: string): Float32Array;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'on', 'for', 'at', 'this', 'that', 'with', 'be', 'are', 'was']);

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // common obfuscations
    .replace(/[@]/g, 'a').replace(/[$]/g, 's').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
    .replace(/(.)\1{2,}/g, '$1$1') // soooo -> soo
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class HashedNgramEmbedder implements Embedder {
  constructor(public dim = 1024) {}

  embed(text: string): Float32Array {
    const v = new Float32Array(this.dim);
    const norm = normalise(text);
    const words = norm.split(' ').filter((w) => w && !STOP.has(w));
    const add = (feat: string, weight: number) => {
      const h = fnv1a(feat);
      const sign = (h & 1) === 0 ? 1 : -1; // signed hashing reduces collision bias
      v[(h >>> 1) % this.dim] += sign * weight;
    };
    for (let i = 0; i < words.length; i++) {
      add('w:' + words[i], 1.0);
      if (i + 1 < words.length) add('b:' + words[i] + '_' + words[i + 1], 0.8);
    }
    const compact = norm.replace(/ /g, '_');
    for (let i = 0; i + 3 <= compact.length; i++) add('c:' + compact.slice(i, i + 3), 0.35);
    let n = 0;
    for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
