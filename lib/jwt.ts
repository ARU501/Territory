import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-side only. Mints the short-lived token that scopes a browser to one
 * team, signed with the project's JWT secret so Postgres can trust the claim.
 *
 * This module must never be imported from a client component: SUPABASE_JWT_SECRET
 * has no NEXT_PUBLIC_ prefix, so it is not available in the browser bundle and an
 * accidental import would fail loudly at build time rather than leak the secret.
 */

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Tokens outlive a shift but not a week, so a leaked one stops working on its own. */
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface TeamToken {
  token: string;
  expiresAt: number;
}

export function signTeamToken(team: string, secret: string, nowMs = Date.now()): TeamToken {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;

  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: "supabase",
      // Keeps the anon Postgres role; the policies key off the team claim below.
      role: "anon",
      aud: "authenticated",
      sub: `team:${team}`,
      team,
      iat,
      exp,
    })
  );

  const data = `${header}.${payload}`;
  const signature = b64url(createHmac("sha256", secret).update(data).digest());

  return { token: `${data}.${signature}`, expiresAt: exp * 1000 };
}

/** Constant-time comparison, used by the tests that assert tokens are stable. */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
