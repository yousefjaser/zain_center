import { NextResponse } from "next/server";
// import { getSupabaseClient } from "../../../lib/supabaseClient";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      const expected = `Bearer ${cronSecret}`;
      if (auth !== expected) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
    }
    const apiKey = process.env.NEXT_PUBLIC_CURRENCYAPI_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: "missing currencyapi key" }, { status: 400 });
    const url = `https://api.currencyapi.com/v3/latest?base_currency=JOD&currencies=ILS&apikey=${apiKey}`;
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json();
    const rate = j?.data?.ILS?.value;
    if (typeof rate !== "number") throw new Error("invalid rate");

    // Optionally, persist on server with service role here.
    return NextResponse.json({ ok: true, rate });
  } catch (e) {
    const message = e instanceof Error ? e.message : "error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}


