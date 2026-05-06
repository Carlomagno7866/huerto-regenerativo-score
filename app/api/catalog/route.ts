import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/db";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const search = params.get("search") ?? "";
  const limit = Number(params.get("limit") ?? 80);
  return NextResponse.json({ crops: getCatalog(search, Math.min(Math.max(limit, 1), 120)) });
}
