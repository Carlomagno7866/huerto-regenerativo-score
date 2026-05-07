import { NextRequest, NextResponse } from "next/server";
import { getChileCommunes, getChileRegions } from "@/lib/db";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const region = request.nextUrl.searchParams.get("region") ?? undefined;
  return NextResponse.json({
    regions: getChileRegions(),
    communes: getChileCommunes(region)
  });
}
