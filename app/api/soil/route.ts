import { NextRequest, NextResponse } from "next/server";
import { getNearestSoil } from "@/lib/db";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat y lon son obligatorios" }, { status: 400 });
  }
  return NextResponse.json({ soil: getNearestSoil(lat, lon) });
}
