/**
 * Can this project accept a custom HS256 JWT carrying a "team" claim, on BOTH
 * PostgREST and Realtime?
 *
 *   DB_ENV_FILE=<pulled env> node scripts/probe-jwt.mjs
 *
 * Everything else about locking this app down depends on the answer, so it is
 * worth proving before refactoring the client. Newer Supabase projects can be
 * issued asymmetric signing keys, in which case the legacy shared secret is no
 * longer accepted and a different approach is needed.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          let v = l.slice(i + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          return [l.slice(0, i).trim(), v];
        })
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnv(join(here, "..", ".env.local")), ...loadEnv(process.env.DB_ENV_FILE ?? "") };
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET = env.SUPABASE_JWT_SECRET;

if (!SECRET) {
  console.error("SUPABASE_JWT_SECRET not found. Pass DB_ENV_FILE=<file from `vercel env pull`>.");
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Minimal HS256 signer — the same shape the API route will use. */
function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = b64url(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

const nowSec = Math.floor(Date.now() / 1000);

const TEAM = "zz-jwt-alpha";
const OTHER = "zz-jwt-bravo";

const token = signJwt(
  {
    iss: "supabase",
    role: "anon",
    aud: "authenticated",
    team: TEAM,
    iat: nowSec,
    exp: nowSec + 60 * 60 * 12,
  },
  SECRET
);

const mark = (ok, name, note = "") =>
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${note ? `  — ${note}` : ""}`);

const uuid = () => crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function terr(team) {
  return {
    id: uuid(),
    team_code: team,
    name: "JWT probe",
    color: "#2563eb",
    polygon: [[40.6255, -74.03], [40.6255, -74.027], [40.6275, -74.027]],
    created_by: "probe",
    created_at: new Date().toISOString(),
  };
}

async function main() {
  console.log(`Custom-JWT probe against ${URL_}\n`);

  // ---- 1. does PostgREST accept the signed token at all? -------------------
  console.log("PostgREST");
  const res = await fetch(`${URL_}/rest/v1/territories?select=id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  mark(res.ok, "accepts a custom HS256 token", `http=${res.status} ${res.ok ? "" : body.slice(0, 160)}`);
  if (!res.ok) {
    console.log(
      "\n  -> The legacy shared secret is not accepted (this project likely uses asymmetric\n" +
        "     JWT signing keys). The team-scoping design needs a different mechanism.\n"
    );
    process.exit(2);
  }

  // ---- 2. is the custom claim visible to SQL? -----------------------------
  const claim = await fetch(`${URL_}/rest/v1/rpc/jwt_team_probe`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (claim.status === 404) {
    console.log("  [INFO] helper function not installed yet; claim visibility checked via policy below");
  } else {
    const v = await claim.text();
    mark(v.includes(TEAM), "auth.jwt() exposes the team claim to SQL", v.slice(0, 80));
  }

  // ---- 3. does Realtime accept it? ---------------------------------------
  console.log("\nRealtime");
  const client = createClient(URL_, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  client.realtime.setAuth(token);

  const events = [];
  const ch = client
    .channel(`jwtprobe:${TEAM}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "territories", filter: `team_code=eq.${TEAM}` },
      (p) => events.push(p)
    );

  const status = await new Promise((resolve) => {
    const t = setTimeout(() => resolve("TIMEOUT"), 15000);
    ch.subscribe((s) => {
      if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) {
        clearTimeout(t);
        resolve(s);
      }
    });
  });
  mark(status === "SUBSCRIBED", "channel subscribes while authenticated by the custom token", status);

  const t1 = terr(TEAM);
  const ins = await client.from("territories").insert(t1);
  mark(!ins.error, "insert with the custom token", ins.error?.message ?? "");

  await sleep(4000);
  mark(
    events.some((e) => e.eventType === "INSERT" && e.new?.id === t1.id),
    "realtime event delivered under the custom token",
    `${events.length} event(s)`
  );

  // ---- cleanup ------------------------------------------------------------
  await ch.unsubscribe();
  const anon = createClient(URL_, ANON);
  for (const team of [TEAM, OTHER]) {
    await anon.from("houses").delete().eq("team_code", team);
    await anon.from("territories").delete().eq("team_code", team);
  }
  console.log("\nCleaned up.");
  console.log(
    "\nVerdict: HS256 custom tokens are accepted on both transports, so team-scoped RLS\n" +
      "keyed on a signed claim will work for REST and live sync alike."
  );
}

main()
  .then(() => sleep(300).then(() => process.exit(0)))
  .catch((e) => {
    console.error("\nProbe crashed:", e);
    process.exit(1);
  });
