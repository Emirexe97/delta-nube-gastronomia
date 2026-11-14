import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createPublicRegistration,
  PublicRegistrationError,
} from "./public-registration.js";
import type { RegistrationMail } from "./registration-mail.js";

export type Downloads = Partial<
  Record<"windows" | "macArm64" | "macX64", { url: string; label: string }>
>;
export type PublicAccountConfig = {
  origin: string;
  sendMail: (message: RegistrationMail) => Promise<void>;
};
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
const assets: Record<string, [string, string]> = {
  "/registro/": ["registro/index.html", "text/html; charset=utf-8"],
  "/recuperar/": ["recuperar/index.html", "text/html; charset=utf-8"],
  "/descargas/": ["descargas/index.html", "text/html; charset=utf-8"],
  "/public-assets/account.js": [
    "public-assets/account.js",
    "text/javascript; charset=utf-8",
  ],
  "/public-assets/account.css": [
    "public-assets/account.css",
    "text/css; charset=utf-8",
  ],
};
function respond(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(value));
}
function cleanDownloads(downloads: Downloads): Downloads {
  const out: Downloads = {};
  for (const key of ["windows", "macArm64", "macX64"] as const) {
    const entry = downloads[key];
    if (!entry) continue;
    const url = new URL(entry.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      entry.label.length > 120
    )
      throw new Error(
        "Downloads require public HTTPS URLs without credentials or fragments",
      );
    out[key] = { url: url.href, label: entry.label };
  }
  return out;
}
export function downloadsFromEnv(env: NodeJS.ProcessEnv): Downloads {
  return cleanDownloads({
    ...(env.PUBLIC_DOWNLOAD_WINDOWS
      ? {
          windows: {
            url: env.PUBLIC_DOWNLOAD_WINDOWS,
            label: "Windows · 64 bits",
          },
        }
      : {}),
    ...(env.PUBLIC_DOWNLOAD_MAC_ARM64
      ? {
          macArm64: {
            url: env.PUBLIC_DOWNLOAD_MAC_ARM64,
            label: "Mac · Apple Silicon (M1 o posterior)",
          },
        }
      : {}),
    ...(env.PUBLIC_DOWNLOAD_MAC_X64
      ? { macX64: { url: env.PUBLIC_DOWNLOAD_MAC_X64, label: "Mac · Intel" } }
      : {}),
  });
}
export function createPublicAccountHttp(
  db: DatabaseSync,
  config?: PublicAccountConfig,
  downloads: Downloads = {},
) {
  const registration = config
    ? createPublicRegistration(db, config)
    : undefined;
  const links = cleanDownloads(downloads);
  db.exec(
    `CREATE TABLE IF NOT EXISTS public_rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);`,
  );
  function limit(key: string, max: number, period: number) {
    const now = Date.now();
    db.prepare("DELETE FROM public_rate_limits WHERE expires_at<=?").run(now);
    // Socket IP only: untrusted forwarded headers must never bypass the quota.
    const bucket = createHash("sha256").update(key).digest("hex");
    const row = db
      .prepare("SELECT count FROM public_rate_limits WHERE bucket=?")
      .get(bucket) as { count: number } | undefined;
    if (row && row.count >= max) return true;
    if (
      !row &&
      (
        db.prepare("SELECT count(*) n FROM public_rate_limits").get() as {
          n: number;
        }
      ).n >= 10_000
    )
      return true;
    db.prepare(
      "INSERT INTO public_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1",
    ).run(bucket, now + period);
    return false;
  }
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ip: string,
  ): Promise<boolean> => {
    const path = url.pathname;
    if (
      ["/registro", "/recuperar", "/descargas"].includes(path) &&
      ["GET", "HEAD"].includes(req.method ?? "")
    ) {
      res.writeHead(308, { ...headers, location: `${path}/` });
      res.end();
      return true;
    }
    if (assets[path] && ["GET", "HEAD"].includes(req.method ?? "")) {
      const [file, contentType] = assets[path]!;
      const data = readFileSync(new URL(`./public/${file}`, import.meta.url));
      res.writeHead(200, {
        ...headers,
        "content-type": contentType,
        "content-length": data.length,
      });
      res.end(req.method === "HEAD" ? undefined : data);
      return true;
    }
    if (!path.startsWith("/public/api/")) return false;
    if (req.method === "GET" && path === "/public/api/config") {
      respond(res, 200, {
        registrationEnabled: !!registration,
        downloads: links,
      });
      return true;
    }
    const handlers: Record<
      string,
      (input: Record<string, unknown>) => Promise<unknown>
    > = registration
      ? {
          "/public/api/registration/start": (b) =>
            registration.startRegistration(b.email),
          "/public/api/registration/complete": (b) =>
            registration.completeRegistration({
              token: b.token,
              password: b.password,
              businessName: b.businessName,
            }),
          "/public/api/password-reset/start": (b) =>
            registration.startReset(b.email),
          "/public/api/password-reset/complete": (b) =>
            registration.completeReset({
              token: b.token,
              password: b.password,
            }),
        }
      : {};
    if (!registration) {
      respond(res, 503, { error: "registration_unavailable" });
      return true;
    }
    if (req.method !== "POST" || !handlers[path]) {
      respond(res, 404, { error: "not_found" });
      return true;
    }
    if (req.headers.origin !== config!.origin) {
      respond(res, 403, { error: "invalid_origin" });
      return true;
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")
    ) {
      respond(res, 415, { error: "unsupported_media_type" });
      return true;
    }
    if (
      limit(`public:${ip}`, 20, 60_000) ||
      (path.endsWith("/start") && limit("public-mail-daily", 100, 86_400_000))
    ) {
      res.setHeader("retry-after", "60");
      respond(res, 429, { error: "rate_limited" });
      return true;
    }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 8192) {
          respond(res, 413, { error: "body_too_large" });
          return true;
        }
        chunks.push(bytes);
      }
      let value: unknown;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new PublicRegistrationError(400, "invalid_body");
      }
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new PublicRegistrationError(400, "invalid_body");
      const result = await handlers[path]!(value as Record<string, unknown>);
      respond(
        res,
        path.endsWith("/start") ? 202 : 200,
        path.endsWith("/start")
          ? {
              message: "Si corresponde, recibirás un correo con instrucciones.",
            }
          : result,
      );
    } catch (error) {
      respond(
        res,
        error instanceof PublicRegistrationError ? error.status : 503,
        {
          error:
            error instanceof PublicRegistrationError
              ? error.code
              : "temporarily_unavailable",
        },
      );
    }
    return true;
  };
}
