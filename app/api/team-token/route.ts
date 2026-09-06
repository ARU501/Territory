import { NextResponse } from "next/server";
import { signTeamToken } from "@/lib/jwt";
import { slugifyTeam } from "@/lib/team";

// Signing needs node:crypto and must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exchanges a team code for a token that pins the caller to that one team.
 *
 * This is deliberately not authentication: anyone who knows a team code can get
 * a token for it, exactly as anyone who knows it could type it into the app.
 * What it buys is that a browser can no longer read or delete data belonging to
 * teams it did not name — the database enforces the scope, not the client.
 */
export async function POST(request: Request) {
  let team = "";
  try {
    const body = await request.json();
    team = slugifyTeam(typeof body?.team === "string" ? body.team : "");
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (team.length < 3) {
    return NextResponse.json({ error: "Team code is too short." }, { status: 400 });
  }

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "The server has no SUPABASE_JWT_SECRET configured." },
      { status: 503 }
    );
  }

  const { token, expiresAt } = signTeamToken(team, secret);
  return NextResponse.json(
    { team, token, expiresAt },
    { headers: { "Cache-Control": "no-store" } }
  );
}
