/**
 * @title Encrypted store
 * @notice AES-256-GCM storage for profile state. The platform supplies the 32-byte key.
 * @dev Desktop wraps the key with Electron safeStorage. Android uses the Keystore and iOS uses the Keychain. Private windows use `MemoryBackend` and never touch disk.
 */
import { b64d, b64e, bytes } from './profiles';

/**
 * @notice Where ciphertext is kept. Implementations read and write one string.
 */
export interface Backend {
  read(): Promise<string | null>;
  write(data: string): Promise<void>;
}

/**
 * @title Memory backend
 * @notice Keeps ciphertext in memory. Used by private windows.
 */
export class MemoryBackend implements Backend {
  data: string | null = null;
  /**
   * @notice Read the stored ciphertext.
   * @return The ciphertext, or null when nothing has been written.
   */
  async read() { return this.data; }
  /**
   * @notice Replace the stored ciphertext.
   * @param d Ciphertext to keep until the process exits.
   */
  async write(d: string) { this.data = d; }
}

/**
 * @title Encrypted store
 * @notice Encrypts a JSON value with AES-256-GCM before handing it to a backend.
 */
export class EncryptedStore<T> {
  private keyP: Promise<CryptoKey>;

  /**
   * @notice Import the raw key and bind a backend.
   * @param backend Where ciphertext is read and written.
   * @param rawKey 32-byte AES key. Any other length throws.
   */
  constructor(private backend: Backend, rawKey: Uint8Array) {
    if (rawKey.length !== 32) throw new Error('Store key must be 32 bytes');
    this.keyP = globalThis.crypto.subtle.importKey('raw', bytes(rawKey), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  /**
   * @notice Decrypt and parse the stored value.
   * @param fallback Value returned when the backend is empty.
   * @return The stored value, or `fallback`.
   */
  async load(fallback: T): Promise<T> {
    const raw = await this.backend.read();
    if (!raw) return fallback;
    const { iv, ct } = JSON.parse(raw);
    const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(b64d(iv)) }, await this.keyP, bytes(b64d(ct)));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /**
   * @notice Encrypt `value` with a fresh IV and write it.
   * @param value JSON-serialisable state.
   */
  async save(value: T): Promise<void> {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.keyP, new TextEncoder().encode(JSON.stringify(value)));
    await this.backend.write(JSON.stringify({ v: 1, iv: b64e(iv), ct: b64e(new Uint8Array(ct)) }));
  }
}

/**
 * @notice Create a 32-byte key for a new store.
 * @return Random bytes from WebCrypto.
 */
export function randomKey(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}
