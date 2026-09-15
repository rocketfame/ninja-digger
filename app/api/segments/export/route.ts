/** GET /api/segments/export?seg=&p=&src=&tier=&days= — CSV of the current segment view (dashboard auth). */
import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";
import { SEGMENTS, segmentRows } from "@/lib/segments";
import { csvCell } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const q = new URL(request.url).searchParams;
  const seg = q.get("seg") ?? undefined;
  const rows = await segmentRows({
    segment: seg && (SEGMENTS as readonly string[]).includes(seg) ? seg : undefined,
    platform: q.get("p") ?? undefined, source: q.get("src") ?? undefined, tier: q.get("tier") ?? undefined,
    days: q.get("days") ? parseInt(q.get("days")!, 10) || undefined : undefined, limit: 20000, offset: 0,
  });
  const header = "email,name,segment,platform,source,tier,followers,country,channel,first_touch,opens,clicks,orders,revenue,profile_url\n";
  const body = rows.map((r) => [r.email, r.name, r.segment, r.platform, r.source, r.tier, r.followers, r.country, r.channel, r.first_touch, r.opens, r.clicks, r.orders, r.revenue, r.profile_url].map(csvCell).join(",")).join("\n");
  const name = `segments-${seg ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(header + body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });
}
