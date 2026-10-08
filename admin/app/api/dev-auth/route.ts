import { timingSafeEqual } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE = "vesper_dev_admin";

function configured(): boolean {
  return process.env.VESPER_RUNTIME_ENV === "development" &&
    process.env.VESPER_ENABLE_DEV_ADMIN_AUTH === "true" &&
    Boolean(process.env.VESPER_DEV_ADMIN_PASSWORD) &&
    Boolean(process.env.VESPER_DEV_ADMIN_PRIVATE_KEY_B64);
}

function matchesPassword(value: string): boolean {
  const expected = Buffer.from(process.env.VESPER_DEV_ADMIN_PASSWORD ?? "");
  const received = Buffer.from(value);
  return expected.length > 0 && expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET() {
  if (!configured()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const token = (await cookies()).get(COOKIE)?.value;
  return token
    ? NextResponse.json({ token }, { headers: { "cache-control": "no-store" } })
    : NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export async function POST(request: Request) {
  if (!configured()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  if (!body || typeof body.password !== "string" || !matchesPassword(body.password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const privatePem = Buffer.from(process.env.VESPER_DEV_ADMIN_PRIVATE_KEY_B64!, "base64").toString("utf8");
  const key = await importPKCS8(privatePem, "RS256");
  const token = await new SignJWT({ name: "Vesper Preview Admin", email: "preview@vesper.local" })
    .setProtectedHeader({ alg: "RS256", kid: "vesper-dev-admin-1", typ: "JWT" })
    .setIssuer("https://dev-admin.vesper.local")
    .setAudience("vesper-admin-preview")
    .setSubject("dev-admin-preview")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(key);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return response;
}
