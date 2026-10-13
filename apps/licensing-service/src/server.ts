import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
  createPublicKey,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  signLease,
  verifyLease,
  GRACE_MS,
  type LicenseLease,
} from "@gastronomy/licensing";

const MAX_BODY = 16 * 1024;
type Env = {
  dbPath: string;
  adminToken: string;
  privateKey: string;
  rateLimit?: number;
};
type LicenseRow = {
  id: string;
  business_name: string;
  paid_through: string;
  revision: number;
  status: "ACTIVE" | "SUSPENDED";
  activation_hash: string;
  installation_id: string | null;
};
type RateEntry = { count: number; reset: number; blockedUntil: number };

function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return false;
  const millis = Date.parse(value);
  return (
    new Date(millis).toISOString() === value &&
    Number.isFinite(millis + GRACE_MS) &&
    millis + GRACE_MS <= 8.64e15
  );
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(data);
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > MAX_BODY)
      throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(b);
  }
  if (!chunks.length)
    throw Object.assign(new Error("Body required"), { status: 400 });
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}
function validId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(v);
}

export function createLicenseServer(
  env: Env,
  suppliedDb?: DatabaseSync,
): { server: Server; close: () => void } {
  if (Buffer.byteLength(env.adminToken) < 32)
    throw new Error("ADMIN_TOKEN must be at least 32 bytes");
  if (!env.dbPath || !env.dbPath.match(/^(?:[A-Za-z]:\\|\\\\|\/)/))
    throw new Error("DB_PATH must be absolute");
  const db = suppliedDb ?? new DatabaseSync(env.dbPath);
  const schema = `
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY, business_name TEXT NOT NULL, paid_through TEXT NOT NULL,
      revision INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED')),
      activation_hash TEXT NOT NULL UNIQUE, installation_id TEXT UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS renewals (
      idempotency_key TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES licenses(id),
      paid_through TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
    );`;
  db.exec(schema);
  const privateKey = env.privateKey;
  const publicKey = createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();
  const rates = new Map<string, RateEntry>();
  const maxRate = Math.max(5, Math.min(1000, env.rateLimit ?? 30));
  const throttled = (key: string): boolean => {
    const now = Date.now();
    let e = rates.get(key);
    if (!e && rates.size >= 10_000) {
      for (const [k, v] of rates)
        if (now >= v.reset && now >= v.blockedUntil) rates.delete(k);
      if (rates.size >= 10_000) return true;
    }
    if (!e || now >= e.reset) {
      e = { count: 0, reset: now + 60_000, blockedUntil: 0 };
      rates.set(key, e);
    }
    if (now < e.blockedUntil) return true;
    e.count++;
    if (e.count > maxRate) {
      e.blockedUntil = now + 60_000;
      return true;
    }
    if (rates.size > 10000)
      for (const [k, v] of rates)
        if (now >= v.reset && now >= v.blockedUntil) rates.delete(k);
    return false;
  };
  const issueToken = (row: LicenseRow, installationId: string): string => {
    const paid = Date.parse(row.paid_through);
    const lease: LicenseLease = {
      schema: 1,
      product: "delta-nube-gastronomia",
      licenseId: row.id,
      installationId,
      businessName: row.business_name,
      issuedAt: new Date().toISOString(),
      paidThrough: row.paid_through,
      graceUntil: new Date(paid + GRACE_MS).toISOString(),
      revision: row.revision,
      status: row.status,
    };
    return signLease(lease, privateKey);
  };
  const rowById = (id: string): LicenseRow | undefined =>
    db.prepare("SELECT * FROM licenses WHERE id = ?").get(id) as
      LicenseRow | undefined;
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const rawTarget = req.url ?? "";
      if (!rawTarget.startsWith("/") || rawTarget.startsWith("//"))
        return json(res, 400, { error: "invalid_request_target" });
      const url = new URL(rawTarget, "http://localhost");
      if (
        url.origin !== "http://localhost" ||
        url.username ||
        url.password ||
        url.hash
      )
        return json(res, 400, { error: "invalid_request_target" });
      const ip = req.socket.remoteAddress ?? "unknown";
      if (req.method === "GET" && url.pathname === "/health")
        return json(res, 200, { status: "ok" });
      if (url.pathname.startsWith("/admin/")) {
        const bucket = `admin:${ip}`;
        if (throttled(bucket)) return json(res, 429, { error: "rate_limited" });
        const header = req.headers.authorization ?? "";
        const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
        if (!safeEqual(provided, env.adminToken))
          return json(res, 401, { error: "unauthorized" });
        if (req.method === "POST" && url.pathname === "/admin/licenses") {
          if (!isJson(req))
            return json(res, 415, { error: "unsupported_media_type" });
          const b = await body(req);
          if (
            typeof b.businessName !== "string" ||
            !b.businessName.trim() ||
            b.businessName.length > 160 ||
            !canonicalIso(b.paidThrough)
          )
            return json(res, 400, { error: "invalid_license" });
          const id = randomBytes(16).toString("base64url");
          const code = randomBytes(32).toString("base64url");
          const createdAt = new Date().toISOString();
          db.prepare(
            "INSERT INTO licenses(id,business_name,paid_through,revision,status,activation_hash,installation_id,created_at) VALUES(?,?,?,?,?,?,NULL,?)",
          ).run(
            id,
            b.businessName.trim(),
            b.paidThrough,
            1,
            "ACTIVE",
            hash(code),
            createdAt,
          );
          return json(res, 201, {
            license: {
              id,
              businessName: b.businessName.trim(),
              paidThrough: b.paidThrough,
              revision: 1,
              status: "ACTIVE",
              installationId: null,
              createdAt,
            },
            activationCode: code,
          });
        }
        const renewMatch = url.pathname.match(
          /^\/admin\/licenses\/([A-Za-z0-9_-]{8,128})\/renew$/,
        );
        if (req.method === "POST" && renewMatch) {
          const b = await body(req);
          const id = renewMatch[1]!;
          if (
            !canonicalIso(b.paidThrough) ||
            typeof b.reason !== "string" ||
            !b.reason.trim() ||
            b.reason.length > 500 ||
            typeof b.idempotencyKey !== "string" ||
            !/^[A-Za-z0-9_-]{8,128}$/.test(b.idempotencyKey)
          )
            return json(res, 400, { error: "invalid_renewal" });
          const prior = db
            .prepare(
              "SELECT license_id,paid_through,reason FROM renewals WHERE idempotency_key = ?",
            )
            .get(b.idempotencyKey) as
            | { license_id: string; paid_through: string; reason: string }
            | undefined;
          if (prior)
            return prior.license_id === id &&
              prior.paid_through === b.paidThrough &&
              prior.reason === b.reason.trim()
              ? json(res, 200, {
                  license: publicRow(rowById(id)!),
                  idempotent: true,
                })
              : json(res, 409, { error: "idempotency_conflict" });
          const row = rowById(id);
          if (!row) return json(res, 404, { error: "not_found" });
          if (Date.parse(b.paidThrough) < Date.parse(row.paid_through))
            return json(res, 409, { error: "renewal_cannot_shorten" });
          const update = db.prepare(
            "UPDATE licenses SET paid_through = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
          );
          db.exec("BEGIN IMMEDIATE");
          try {
            db.prepare(
              "INSERT INTO renewals(idempotency_key,license_id,paid_through,reason,created_at) VALUES(?,?,?,?,?)",
            ).run(
              b.idempotencyKey,
              id,
              b.paidThrough,
              b.reason.trim(),
              new Date().toISOString(),
            );
            update.run(b.paidThrough, id, row.revision);
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          return json(res, 200, {
            license: publicRow(rowById(id)!),
            idempotent: false,
          });
        }
        if (req.method === "GET" && url.pathname === "/admin/licenses") {
          const rows = db
            .prepare(
              "SELECT * FROM licenses ORDER BY created_at DESC LIMIT 1000",
            )
            .all() as LicenseRow[];
          return json(res, 200, { licenses: rows.map(publicRow) });
        }
        return json(res, 404, { error: "not_found" });
      }
      if (
        req.method === "POST" &&
        (url.pathname === "/v1/activate" || url.pathname === "/v1/verify")
      ) {
        if (throttled(`public:${ip}`))
          return json(res, 429, { error: "rate_limited" });
        if (!isJson(req))
          return json(res, 415, { error: "unsupported_media_type" });
        const b = await body(req);
        if (!validId(b.installationId))
          return json(res, 400, { error: "invalid_installation" });
        if (url.pathname === "/v1/activate") {
          if (typeof b.code !== "string" || b.code.length > 128)
            return json(res, 400, { error: "invalid_activation" });
          const row = db
            .prepare("SELECT * FROM licenses WHERE activation_hash = ?")
            .get(hash(b.code)) as LicenseRow | undefined;
          if (!row) return json(res, 401, { error: "invalid_activation" });
          if (row.installation_id && row.installation_id !== b.installationId)
            return json(res, 409, { error: "installation_mismatch" });
          if (!row.installation_id) {
            let result;
            try {
              result = db
                .prepare(
                  "UPDATE licenses SET installation_id = ? WHERE id = ? AND installation_id IS NULL",
                )
                .run(b.installationId, row.id);
            } catch {
              return json(res, 409, { error: "installation_mismatch" });
            }
            if (Number(result.changes) !== 1) {
              const latest = rowById(row.id);
              if (latest?.installation_id !== b.installationId)
                return json(res, 409, { error: "installation_mismatch" });
            }
          }
          return json(res, 200, {
            token: issueToken(rowById(row.id)!, b.installationId),
          });
        }
        if (typeof b.token !== "string" || b.token.length > 8192)
          return json(res, 400, { error: "invalid_token" });
        try {
          const lease = verifyLease(b.token, publicKey, b.installationId);
          const row = rowById(lease.licenseId);
          if (
            !row ||
            row.installation_id !== b.installationId ||
            lease.revision > row.revision
          )
            throw new Error();
          return json(res, 200, { token: issueToken(row, b.installationId) });
        } catch {
          return json(res, 401, { error: "invalid_token" });
        }
      }
      return json(res, 404, { error: "not_found" });
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status: unknown }).status)
          : 500;
      return json(res, status >= 400 && status < 500 ? status : 500, {
        error: status === 500 ? "internal_error" : "bad_request",
      });
    }
  };
  const server = createServer((req, res) => {
    void handler(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "internal_error" });
      else res.destroy();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = 1_000;
  server.on("connection", (socket) =>
    socket.setTimeout(15_000, () => socket.destroy()),
  );
  let databaseClosed = false;
  const close = () => {
    if (databaseClosed) return;
    databaseClosed = true;
    if (server.listening) server.close();
    db.close();
  };
  return { server, close };
}
function publicRow(row: LicenseRow): unknown {
  return {
    id: row.id,
    businessName: row.business_name,
    paidThrough: row.paid_through,
    revision: row.revision,
    status: row.status,
    installationId: row.installation_id,
  };
}
function isJson(req: IncomingMessage): boolean {
  return /^application\/json(?:\s*;|$)/i.test(
    req.headers["content-type"] ?? "",
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const dbPath = process.env.DB_PATH;
  const adminFile = process.env.ADMIN_TOKEN_FILE;
  const privateFile = process.env.LEASE_PRIVATE_KEY_FILE;
  if (!dbPath || !adminFile || !privateFile)
    throw new Error("Set DB_PATH, ADMIN_TOKEN_FILE and LEASE_PRIVATE_KEY_FILE");
  const { server, close } = createLicenseServer({
    dbPath,
    adminToken: readFileSync(adminFile, "utf8").trim(),
    privateKey: readFileSync(privateFile, "utf8"),
  });
  const port = Number(process.env.PORT ?? 8097);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("PORT must be an integer from 1 to 65535");
  server.listen(port, process.env.HOST ?? "0.0.0.0");
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      close();
      process.exitCode = 0;
    });
    server.closeAllConnections();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
