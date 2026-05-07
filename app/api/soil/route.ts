import { NextRequest, NextResponse } from "next/server";
import { getCommuneSoil, getNearestSoil } from "@/lib/db";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const commune = request.nextUrl.searchParams.get("commune");
  if (commune) {
    const soil = getCommuneSoil(commune);
    if (!soil) {
      return NextResponse.json({ error: "comuna no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ soil });
  }

  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat y lon son obligatorios" }, { status: 400 });
  }
  return NextResponse.json({ soil: getNearestSoil(lat, lon) });
}
