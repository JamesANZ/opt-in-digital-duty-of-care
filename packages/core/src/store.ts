/**
 * Encrypted state store. AES-256-GCM via WebCrypto. The platform supplies the raw key:
 *  - desktop: random key wrapped by Electron safeStorage (OS keychain)
 *  - Android: Android Keystore
 *  - iOS: Keychain
 * Private windows use MemoryBackend and never touch disk.
 */
import { b64d, b64e, bytes } from './profiles';

export interface Backend {
  read(): Promise<string | null>;
  write(data: string): Promise<void>;
}

export class MemoryBackend implements Backend {
  data: string | null = null;
  async read() { return this.data; }
  async write(d: string) { this.data = d; }
}

export class EncryptedStore<T> {
  private keyP: Promise<CryptoKey>;

  constructor(private backend: Backend, rawKey: Uint8Array) {
    if (rawKey.length !== 32) throw new Error('Store key must be 32 bytes');
    this.keyP = globalThis.crypto.subtle.importKey('raw', bytes(rawKey), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async load(fallback: T): Promise<T> {
    const raw = await this.backend.read();
    if (!raw) return fallback;
    const { iv, ct } = JSON.parse(raw);
    const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(b64d(iv)) }, await this.keyP, bytes(b64d(ct)));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async save(value: T): Promise<void> {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.keyP, new TextEncoder().encode(JSON.stringify(value)));
    await this.backend.write(JSON.stringify({ v: 1, iv: b64e(iv), ct: b64e(new Uint8Array(ct)) }));
  }
}

export function randomKey(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}
