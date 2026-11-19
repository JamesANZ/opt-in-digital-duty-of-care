/**
 * @title On-device text embedding
 * @notice Turns text into a vector so a user's examples can match similar wording on any site.
 * @dev Hashed word unigrams, word bigrams, and character trigrams, L2-normalised. No model download. Semantic paraphrase beyond near-lexical matches is left to JEV. `Embedder` is the swap point for a neural model later.
 */

/**
 * @notice Something that embeds text into a fixed-length vector.
 */
export interface Embedder {
  dim: number;
  embed(text: string): Float32Array;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'on', 'for', 'at', 'this', 'that', 'with', 'be', 'are', 'was']);

/**
 * @notice Fold text into a comparable form before hashing.
 * @dev Lowercases, strips accents, expands common letter substitutions, and collapses repeated characters.
 * @param text Raw page or example text.
 * @return Normalised text, or an empty string.
 */
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

/**
 * @notice Hash a feature string into a 32-bit value.
 * @param str Feature such as a word, bigram, or character trigram.
 * @return Unsigned FNV-1a hash.
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * @title Hashed n-gram embedder
 * @notice Default on-device embedder. Signed hashing spreads features across `dim` buckets.
 */
export class HashedNgramEmbedder implements Embedder {
  /**
   * @notice Create an embedder.
   * @param dim Vector length. Defaults to 1024.
   */
  constructor(public dim = 1024) {}

  /**
   * @notice Embed one string.
   * @param text Text to embed. It is normalised first.
   * @return An L2-normalised vector of length `dim`.
   */
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

/**
 * @notice Cosine similarity of two equal-length vectors.
 * @dev Vectors from `HashedNgramEmbedder` are already L2-normalised, so this is their dot product.
 * @param a First vector.
 * @param b Second vector.
 * @return Similarity in about -1 to 1.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
