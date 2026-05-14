/**
 * Stub for `next/server`.
 *
 * Once UI's `server/og-utils.js` imports from `next/server` to build Open
 * Graph image responses. The Nyrima extension never invokes those
 * code paths; we only need to satisfy the import.
 */

export class NextResponse extends Response {
  static json(data: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(data), {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  }
  static redirect(_url: string | URL, _status?: number): Response {
    return new Response(null, { status: 302 });
  }
  static rewrite(_url: string | URL): Response {
    return new Response(null);
  }
  static next(): Response {
    return new Response(null);
  }
}

export class NextRequest extends Request {
  nextUrl = new URL("https://localhost/");
}

export const userAgent = (_req: Request) => ({
  isBot: false,
  ua: "",
  browser: { name: "", version: "" },
  device: { model: "", type: "", vendor: "" },
  engine: { name: "", version: "" },
  os: { name: "", version: "" },
  cpu: { architecture: "" },
});
