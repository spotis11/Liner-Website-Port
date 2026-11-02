// FC / platform health probe: zero dependencies, zero side effects.
//
// Deliberately does NOT touch the database or any upstream service — the
// deployment health check must succeed as long as the Next.js server itself
// is up. A database problem should never take the health endpoint down with
// it (use /api/announcements or any real route to verify db connectivity).
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, ts: Date.now() });
}
