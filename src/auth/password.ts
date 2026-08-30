import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
} as const;

const INVALID_CREDENTIAL_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$kWx9FtKHU4X1LHGcX9FlGg$8eYWb4uEqhggZKAUpgx/MM/Zm/GClopQDS0vDTyBkqE";

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function verifyPasswordCredential(
  passwordHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  const verified = await verifyPassword(passwordHash ?? INVALID_CREDENTIAL_HASH, password);
  return Boolean(passwordHash) && verified;
}
