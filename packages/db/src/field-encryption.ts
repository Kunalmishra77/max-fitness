import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Face templates at rest (privacy plan §4; attendance spec §11; ADR-107).
 *
 * This is the most personal thing the system stores, and the one a member cannot be issued
 * a replacement for. A leaked database must not hand anybody a working gallery, so the
 * vector is encrypted in the column rather than relying on the database being private.
 *
 * **AES-256-GCM**, authenticated, because the numbers must come back exactly as they went
 * in. A single flipped bit moves the member in vector space, and the failure would not look
 * like corruption — it would look like a member who quietly stopped being recognised, with
 * nothing in any log to say why. GCM's tag turns that into an error.
 *
 * Layout: `version(1) | nonce(12) | ciphertext | tag(16)`. The version byte is there so the
 * scheme can change later without making every template already stored unreadable.
 */

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Read the key from whatever form it was pasted in.
 *
 * Base64 and hex both, because people paste whichever their generator printed, and a key
 * silently accepted at the wrong length is a weaker cipher that nobody notices.
 */
export function keyFromEnv(value: string): Buffer {
  for (const encoding of ['base64', 'hex'] as const) {
    const key = Buffer.from(value, encoding);
    if (key.length === KEY_BYTES) return key;
  }
  // The value itself never appears in the message: it is the key.
  throw new Error(`FIELD_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (64 hex characters, or 44 of base64)`);
}

/**
 * Float32, not float64.
 *
 * The engine produced float32; storing doubles would double every template's size for
 * precision that was never there. 128 floats is 512 bytes, and a gym's whole gallery fits
 * in memory many times over.
 */
export function encryptVector(vector: readonly number[], key: Buffer): Buffer {
  const plain = Buffer.from(new Float32Array(vector).buffer);
  // A fresh nonce every time. Reusing one under the same key breaks GCM outright, and
  // identical ciphertext for identical vectors would itself leak which members match.
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), nonce, sealed, cipher.getAuthTag()]);
}

export function decryptVector(record: Buffer, key: Buffer): number[] {
  if (record.length < 1 + NONCE_BYTES + TAG_BYTES) {
    throw new Error('The face template is too short to be a valid record');
  }
  const version = record[0];
  if (version !== VERSION) {
    throw new Error(`Unknown face template version ${String(version)}`);
  }

  const nonce = record.subarray(1, 1 + NONCE_BYTES);
  const tag = record.subarray(record.length - TAG_BYTES);
  const sealed = record.subarray(1 + NONCE_BYTES, record.length - TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(sealed), decipher.final()]);
  } catch {
    // The original error names the cipher and the operation, which is of no use to anyone
    // and of some use to an attacker. What matters is that it did not verify.
    throw new Error('The face template could not be decrypted — wrong key, or it has been altered');
  }

  // Copied rather than viewed: `plain.buffer` may be a slice of a larger pooled allocation,
  // and a Float32Array over it would read whatever else Node happened to put there.
  const floats = new Float32Array(plain.byteLength / Float32Array.BYTES_PER_ELEMENT);
  Buffer.from(floats.buffer).set(plain);
  return [...floats];
}
