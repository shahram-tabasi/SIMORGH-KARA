import "server-only";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";

/**
 * قرارداد پاسخ همهٔ سرویس‌های HRC نسخهٔ ۲.
 *
 * Every response is `{ ok, data | error, requestId }`. The requestId is echoed
 * in the response header and in the server log line, so a field report ("the
 * watch said error at 14:32") can be traced to one request.
 */

export interface OkBody<T> {
  ok: true;
  data: T;
  requestId: string;
}
export interface ErrBody {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

export class HrcError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) =>
  new HrcError(400, "bad_request", m, d);
export const unauthorized = (m = "احراز هویت نشد") =>
  new HrcError(401, "unauthorized", m);
export const forbidden = (m = "دسترسی لازم را ندارید") =>
  new HrcError(403, "forbidden", m);
export const notFound = (m = "یافت نشد") => new HrcError(404, "not_found", m);
export const tooMany = (m = "تعداد درخواست بیش از حد مجاز") =>
  new HrcError(429, "rate_limited", m);

export function requestId(req: Request): string {
  return req.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
}

function send<T>(body: OkBody<T> | ErrBody, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "x-request-id": body.requestId, "cache-control": "no-store" },
  });
}

/**
 * Wrap a route handler: assigns a request id, maps `HrcError` and `ZodError`
 * to the envelope, and never leaks an internal message to the caller.
 */
export function route<T>(
  handler: (req: Request, rid: string) => Promise<T>
): (req: Request) => Promise<NextResponse> {
  return async (req: Request) => {
    const rid = requestId(req);
    const started = Date.now();
    try {
      const data = await handler(req, rid);
      return send({ ok: true, data, requestId: rid }, 200);
    } catch (e) {
      if (e instanceof ZodError) {
        return send(
          {
            ok: false,
            error: {
              code: "invalid_payload",
              message: "ساختار درخواست معتبر نیست",
              details: e.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
              })),
            },
            requestId: rid,
          },
          400
        );
      }
      if (e instanceof HrcError) {
        return send(
          {
            ok: false,
            error: { code: e.code, message: e.message, details: e.details },
            requestId: rid,
          },
          e.status
        );
      }
      // Unexpected: log it in full, tell the caller nothing but the id.
      console.error(
        `[hrc] ${req.method} ${new URL(req.url).pathname} rid=${rid} ` +
          `ms=${Date.now() - started}`,
        e
      );
      return send(
        {
          ok: false,
          error: { code: "internal", message: "خطای داخلی سرور" },
          requestId: rid,
        },
        500
      );
    }
  };
}

/** Parse and validate a JSON body. */
export async function body<S extends ZodTypeAny>(
  req: Request,
  schema: S
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("بدنهٔ درخواست JSON معتبر نیست");
  }
  return schema.parse(raw);
}
