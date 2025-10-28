// Simple E2E crypto helpers using Web Crypto
// - Derives a room key from a passphrase using PBKDF2
// - Encrypts/decrypts using AES-GCM with random IV

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array) {
  const saltView = new Uint8Array(salt);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt: saltView, iterations: 100_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return key;
}

export function randomBytes(len: number) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

export async function encryptText(key: CryptoKey, plaintext: string) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, textEncoder.encode(plaintext));
  const payload = new Uint8Array(iv.byteLength + ct.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(ct), iv.byteLength);
  return `enc:${btoa(String.fromCharCode(...payload))}`;
}

export async function decryptText(key: CryptoKey, cipher: string) {
  try {
    if (!cipher.startsWith("enc:")) return null;
    const b64 = cipher.slice(4);
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const data = raw.slice(12);
    const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return textDecoder.decode(ptBuf);
  } catch {
    return null; // can't decrypt
  }
}
