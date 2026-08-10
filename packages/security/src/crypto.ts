import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENCRYPTED_SECRET_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export const SUBZERO_ENCRYPTION_KEY_ENV = "SUBZERO_ENCRYPTION_KEY";

export class SecretEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretEncryptionError";
  }
}

export class SecretDecryptionError extends Error {
  constructor() {
    super("Unable to decrypt secret");
    this.name = "SecretDecryptionError";
  }
}

/**
 * Accept a 32-byte key encoded as base64/base64url or as a 64-character hex
 * value. Keeping the key material external makes rotation possible without
 * ever storing it alongside provider keys or OAuth tokens.
 */
export function requireEncryptionKey(
  keyMaterial: string | undefined = process.env[SUBZERO_ENCRYPTION_KEY_ENV],
): Buffer {
  if (typeof keyMaterial !== "string" || keyMaterial.trim().length === 0) {
    throw new SecretEncryptionError(
      `${SUBZERO_ENCRYPTION_KEY_ENV} must be set to a 32-byte base64/base64url or hex key`,
    );
  }

  const normalized = keyMaterial.trim();
  const key = /^[0-9a-f]{64}$/i.test(normalized)
    ? Buffer.from(normalized, "hex")
    : decodeBase64Key(normalized);

  if (key.length !== 32) {
    throw new SecretEncryptionError(
      `${SUBZERO_ENCRYPTION_KEY_ENV} must decode to exactly 32 bytes`,
    );
  }

  return key;
}

/**
 * Encrypt a secret with AES-256-GCM. The serialized result contains a version,
 * random IV, authentication tag, and ciphertext; it never contains key
 * material or plaintext.
 */
export function encryptSecret(plaintext: string, keyMaterial?: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("Secret plaintext must be a string");
  }

  const key = requireEncryptionKey(keyMaterial);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTED_SECRET_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt a value created by encryptSecret. Any malformed, tampered, or
 * wrong-key ciphertext produces the same non-sensitive failure.
 */
export function decryptSecret(
  encryptedSecret: string,
  keyMaterial?: string,
): string {
  const key = requireEncryptionKey(keyMaterial);

  try {
    const { authTag, ciphertext, iv } = parseEncryptedSecret(encryptedSecret);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretDecryptionError();
  }
}

function decodeBase64Key(value: string): Buffer {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    throw new SecretEncryptionError(
      `${SUBZERO_ENCRYPTION_KEY_ENV} must be valid base64/base64url or hex`,
    );
  }

  return Buffer.from(value, "base64");
}

function parseEncryptedSecret(value: string): {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
} {
  if (typeof value !== "string") {
    throw new TypeError("Encrypted secret must be a string");
  }

  const [version, encodedIv, encodedAuthTag, encodedCiphertext, ...extra] =
    value.split(".");

  if (
    version !== ENCRYPTED_SECRET_VERSION ||
    extra.length > 0 ||
    !encodedIv ||
    !encodedAuthTag ||
    encodedCiphertext === undefined
  ) {
    throw new TypeError("Malformed encrypted secret");
  }

  const iv = decodeBase64Url(encodedIv);
  const authTag = decodeBase64Url(encodedAuthTag);
  const ciphertext = decodeBase64Url(encodedCiphertext, true);

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new TypeError("Malformed encrypted secret");
  }

  return { iv, authTag, ciphertext };
}

function decodeBase64Url(value: string, allowEmpty = false): Buffer {
  if (value.length === 0 && allowEmpty) {
    return Buffer.alloc(0);
  }

  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("Malformed encrypted secret");
  }

  return Buffer.from(value, "base64url");
}
