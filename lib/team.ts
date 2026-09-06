/**
 * Team codes end up inside PostgREST realtime filters (`team_code=eq.<code>`),
 * where a comma or space would break the filter syntax, so they are reduced to
 * a plain slug before they are used or stored.
 */
export function slugifyTeam(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
