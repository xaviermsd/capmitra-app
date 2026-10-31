import { NextResponse } from "next/server";
import { serverKey, serverKeyReason } from "@/lib/serverKeys";

export const dynamic = "force-dynamic";

/** Tells the app whether THIS visitor may use the server's keys, and why (never the keys themselves). */
export async function GET(req: Request) {
  const eleven = !!(await serverKey(req, "ELEVENLABS_API_KEY"));
  return NextResponse.json({
    serverElevenLabs: eleven,
    serverSarvam: !!(await serverKey(req, "SARVAM_API_KEY")),
    keyReason: eleven ? await serverKeyReason(req) : null,
  });
}
