/**
 * Password & PIN hashing with argon2id, using Node's BUILT-IN crypto.argon2 (Node >= 24.7).
 * No native npm module, so nothing breaks when a lockfile made on Windows deploys to Linux.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet baseline for argon2id:
 *   memory 19 MiB, 2 passes, parallelism 1.
 *
 * Hashes are stored in the standard PHC string format, which records its own parameters:
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 * so we can raise the cost later and still verify old hashes (see needsRehash).
 */
import "server-only";
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

const PARAMS = { memory: 19_456, passes: 2, parallelism: 1 } as const;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

// Upper bounds when PARSING a stored hash: a tampered DB row must not be able to make us
// burn 4 GiB of RAM per login attempt (a denial-of-service vector).
const MAX = { memory: 262_144, passes: 10, parallelism: 8 } as const;

/** Longest input we'll hash. Bounds CPU per request; 256 is far beyond any real password. */
export const MAX_SECRET_LENGTH = 256;

function derive(
  secret: string,
  salt: Buffer,
  p: { memory: number; passes: number; parallelism: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: Buffer.from(secret.normalize("NFKC"), "utf8"), // same password typed on any device → same bytes
        nonce: salt,
        tagLength: TAG_BYTES,
        ...p,
      },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");

/** Hash a password or PIN for storage. */
export async function hashSecret(secret: string): Promise<string> {
  if (secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
    throw new RangeError("Secret length out of range");
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(secret, salt, PARAMS);
  const { memory: m, passes: t, parallelism: p } = PARAMS;
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(key)}`;
}

interface Parsed {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  key: Buffer;
}

function parse(stored: string): Parsed | null {
  const m =
    /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      stored,
    );
  if (!m) return null;
  const [memory, passes, parallelism] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
  ];
  if (
    memory > MAX.memory ||
    passes > MAX.passes ||
    parallelism > MAX.parallelism
  )
    return null;
  if (passes < 1 || parallelism < 1 || memory < 8 * parallelism) return null;
  return {
    memory,
    passes,
    parallelism,
    salt: Buffer.from(m[4]!, "base64"),
    key: Buffer.from(m[5]!, "base64"),
  };
}

/**
 * Check a password/PIN against a stored hash. Returns false (never throws) for a wrong
 * secret or a malformed hash. Comparison is constant-time.
 */
export async function verifySecret(
  secret: string,
  stored: string,
): Promise<boolean> {
  if (secret.length === 0 || secret.length > MAX_SECRET_LENGTH) return false;
  const p = parse(stored);
  if (!p || p.salt.length < 8 || p.key.length < 16) return false;
  const key = await derive(secret, p.salt, p);
  return key.length === p.key.length && timingSafeEqual(key, p.key);
}

/** True if a stored hash used weaker parameters than today's; rehash after a good login. */
export function needsRehash(stored: string): boolean {
  const p = parse(stored);
  return (
    !p ||
    p.memory < PARAMS.memory ||
    p.passes < PARAMS.passes ||
    p.parallelism !== PARAMS.parallelism
  );
}

// A real hash of a random value, verified when the email doesn't exist so "no such user"
// takes as long as "wrong password". Otherwise response timing reveals which emails exist.
let dummyHash: Promise<string> | undefined;
export async function burnVerifyTime(secret: string): Promise<void> {
  dummyHash ??= hashSecret(randomBytes(16).toString("hex"));
  await verifySecret(secret, await dummyHash);
}
