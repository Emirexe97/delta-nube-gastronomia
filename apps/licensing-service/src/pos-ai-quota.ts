import type { DatabaseSync } from "node:sqlite";

const USER_DAILY_LIMIT = 20;
const MERCHANT_DAILY_LIMIT = 100;
const COOLDOWN_MS = 60_000;
const RETENTION_DAYS = 8;

type Options = { now?: () => string };
type Reservation = {
  merchantId: string;
  userId: string;
  requestId: string;
};
type Status =
  "allowed" | "user_daily_limit" | "merchant_daily_limit" | "cooldown";
export type PosAiQuotaResult = {
  allowed: boolean;
  idempotent: boolean;
  status: Status;
  remaining: { user: number; merchant: number };
  /** Seconds until retry is allowed; 0 if not blocked by a timed limit. */
  retryAfter: number;
};

export class PosAiQuotaError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 200
  );
}

function buenosAiresDay(iso: string): string {
  const millis = Date.parse(iso);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== iso) {
    throw new PosAiQuotaError("invalid_now", 500);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(millis));
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localParts(millis: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(millis));
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function nextBuenosAiresMidnight(millis: number): number {
  const local = localParts(millis);
  const nextDate = new Date(
    Date.UTC(
      Number(local.year),
      Number(local.month) - 1,
      Number(local.day) + 1,
    ),
  );
  const target = Date.UTC(
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth(),
    nextDate.getUTCDate(),
  );
  let guess = target;
  // Reconcile target wall-clock midnight with the timezone offset (without assuming its DST rules).
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess);
    const represented = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    guess += target - represented;
  }
  return guess;
}

function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

/** Persistent quota gate. Store identifiers and metadata only, never prompts or completions. */
export function createPosAiQuota(db: DatabaseSync, options: Options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  db.exec(`
    CREATE TABLE IF NOT EXISTS pos_ai_quota_requests (
      merchant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      day TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status='allowed'),
      PRIMARY KEY (merchant_id, user_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS pos_ai_quota_merchant_day ON pos_ai_quota_requests(merchant_id, day);
    CREATE INDEX IF NOT EXISTS pos_ai_quota_user_day ON pos_ai_quota_requests(merchant_id, user_id, day);
    CREATE INDEX IF NOT EXISTS pos_ai_quota_cooldown ON pos_ai_quota_requests(merchant_id, user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS pos_ai_quota_retention ON pos_ai_quota_requests(created_at);
  `);

  function reserve(input: Reservation): PosAiQuotaResult {
    if (
      !input ||
      !validId(input.merchantId) ||
      !validId(input.userId) ||
      !validId(input.requestId)
    ) {
      throw new PosAiQuotaError("invalid_quota_request", 400);
    }
    return tx(db, () => {
      const iso = now();
      const nowMs = Date.parse(iso);
      const day = buenosAiresDay(iso);
      db.prepare("DELETE FROM pos_ai_quota_requests WHERE created_at < ?").run(
        new Date(nowMs - RETENTION_DAYS * 86_400_000).toISOString(),
      );

      const prior = db
        .prepare(
          `SELECT status FROM pos_ai_quota_requests
        WHERE merchant_id=? AND user_id=? AND request_id=?`,
        )
        .get(input.merchantId, input.userId, input.requestId) as
        { status: "allowed" } | undefined;
      const counts = () => {
        const user = db
          .prepare(
            `SELECT COUNT(*) AS n FROM pos_ai_quota_requests
          WHERE merchant_id=? AND user_id=? AND day=? AND status='allowed'`,
          )
          .get(input.merchantId, input.userId, day) as { n: number };
        const merchant = db
          .prepare(
            `SELECT COUNT(*) AS n FROM pos_ai_quota_requests
          WHERE merchant_id=? AND day=? AND status='allowed'`,
          )
          .get(input.merchantId, day) as { n: number };
        return {
          user: Math.max(0, USER_DAILY_LIMIT - user.n),
          merchant: Math.max(0, MERCHANT_DAILY_LIMIT - merchant.n),
        };
      };
      if (prior) {
        return {
          allowed: true,
          idempotent: true,
          status: "allowed",
          remaining: counts(),
          retryAfter: 0,
        };
      }

      let status: Status = "allowed";
      let retryAfter = 0;
      const remaining = counts();
      if (remaining.user <= 0) {
        status = "user_daily_limit";
        retryAfter = Math.ceil((nextBuenosAiresMidnight(nowMs) - nowMs) / 1000);
      } else if (remaining.merchant <= 0) {
        status = "merchant_daily_limit";
        retryAfter = Math.ceil((nextBuenosAiresMidnight(nowMs) - nowMs) / 1000);
      } else {
        const last = db
          .prepare(
            `SELECT created_at FROM pos_ai_quota_requests
          WHERE merchant_id=? AND user_id=? AND status='allowed' ORDER BY created_at DESC LIMIT 1`,
          )
          .get(input.merchantId, input.userId) as
          { created_at: string } | undefined;
        if (last) {
          const wait = Date.parse(last.created_at) + COOLDOWN_MS - nowMs;
          if (wait > 0) {
            status = "cooldown";
            retryAfter = Math.ceil(wait / 1000);
          }
        }
      }
      if (status === "allowed") {
        db.prepare(
          `INSERT INTO pos_ai_quota_requests
          (merchant_id,user_id,request_id,day,created_at,status) VALUES(?,?,?,?,?,'allowed')`,
        ).run(input.merchantId, input.userId, input.requestId, day, iso);
      }
      const after =
        status === "allowed"
          ? { user: remaining.user - 1, merchant: remaining.merchant - 1 }
          : remaining;
      return {
        allowed: status === "allowed",
        idempotent: false,
        status,
        remaining: after,
        retryAfter,
      };
    });
  }
  return { reserve };
}

export const POS_AI_QUOTA_LIMITS = {
  userPerBuenosAiresDay: USER_DAILY_LIMIT,
  merchantPerBuenosAiresDay: MERCHANT_DAILY_LIMIT,
  cooldownSeconds: 60,
} as const;
