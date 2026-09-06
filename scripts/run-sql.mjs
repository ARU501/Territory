/**
 * Runs a .sql file against the project's Postgres database.
 *
 *   node scripts/run-sql.mjs supabase-schema.sql
 *
 * The connection string comes from POSTGRES_URL_NON_POOLING, read from (in order)
 * the environment, a file named by DB_ENV_FILE, or .env.local. That variable is
 * provisioned by the Supabase/Vercel integration; `vercel env pull <file>` fetches
 * it. It is a privileged credential — this script never prints it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          const key = l.slice(0, i).trim();
          let value = l.slice(i + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          return [key, value];
        })
    );
  } catch {
    return {};
  }
}

const fromFiles = {
  ...loadEnvFile(join(here, "..", ".env.local")),
  ...(process.env.DB_ENV_FILE ? loadEnvFile(process.env.DB_ENV_FILE) : {}),
};

const dsn = process.env.POSTGRES_URL_NON_POOLING ?? fromFiles.POSTGRES_URL_NON_POOLING;

if (!dsn) {
  console.error(
    "No POSTGRES_URL_NON_POOLING found.\n" +
      "Run:  vercel env pull <file> --environment=production\n" +
      "then: DB_ENV_FILE=<file> node scripts/run-sql.mjs <file.sql>"
  );
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/run-sql.mjs <file.sql>");
  process.exit(1);
}

const sqlPath = resolve(process.cwd(), file);
const sql = readFileSync(sqlPath, "utf8");

/**
 * Supabase serves a certificate from its own CA. Recent pg versions promote
 * sslmode=require to verify-full, which then rejects it, so ask for libpq
 * semantics: still encrypted, but without chain verification.
 */
function encryptedDsn(raw) {
  try {
    const u = new URL(raw);
    u.searchParams.set("sslmode", "require");
    u.searchParams.set("uselibpqcompat", "true");
    return u.toString();
  } catch {
    return raw;
  }
}

const client = new pg.Client({
  connectionString: encryptedDsn(dsn),
  // Supabase's session-mode pooler needs a moment on a cold project.
  connectionTimeoutMillis: 30000,
  statement_timeout: 120000,
});

const host = (() => {
  try {
    return new URL(dsn).host;
  } catch {
    return "(unparseable)";
  }
})();

console.log(`Applying ${file}`);
console.log(`  -> ${host}\n`);

try {
  await client.connect();
  const started = process.hrtime.bigint();
  const result = await client.query(sql);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  // A multi-statement script returns one result per statement; show any rows so
  // the file can double as an inspection query.
  for (const r of Array.isArray(result) ? result : [result]) {
    if (r?.rows?.length) console.table(r.rows);
  }

  console.log(`Applied cleanly in ${ms.toFixed(0)} ms.`);
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  if (err.position) {
    const upto = sql.slice(0, Number(err.position));
    const line = upto.split(/\n/).length;
    console.error(`  at line ${line}: ${sql.split(/\n/)[line - 1]?.trim()}`);
  }
  if (err.hint) console.error(`  hint: ${err.hint}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
