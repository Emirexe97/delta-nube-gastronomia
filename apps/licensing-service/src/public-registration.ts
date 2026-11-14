import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hashAccountPassword } from "./panel-auth.js";

const TTL = 30 * 60_000;
const COOLDOWN = 60_000;
const GENERIC = "Si el correo puede utilizarse, recibirás instrucciones.";
type Message = { to: string; subject: string; text: string };
export class PublicRegistrationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "PublicRegistrationError";
  }
}
function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function normalize(email: unknown): string {
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw new PublicRegistrationError(400, "invalid_email");
  return email.trim().toLowerCase();
}
function passwordValid(p: unknown): p is string {
  return (
    typeof p === "string" &&
    p.length >= 15 &&
    p.length <= 128 &&
    Buffer.byteLength(p, "utf8") <= 512
  );
}
export function createPublicRegistration(
  db: DatabaseSync,
  config: {
    origin: string;
    sendMail: (message: Message) => Promise<void>;
    now?: () => number;
  },
) {
  let origin: URL;
  try {
    origin = new URL(config.origin);
  } catch {
    throw new Error("Invalid public registration origin");
  }
  const localHttp =
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.origin !== config.origin ||
    (origin.protocol !== "https:" && !localHttp)
  )
    throw new Error("Invalid public registration origin");
  const now = config.now ?? Date.now;
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS public_email_tokens (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('REGISTER','RESET')), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS public_email_tokens_email ON public_email_tokens(email,purpose);
    CREATE TABLE IF NOT EXISTS public_email_cooldowns (email TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS license_trials (license_id TEXT PRIMARY KEY REFERENCES licenses(id), started_at INTEGER, ends_at INTEGER);`);
  let mailJobs = 0;
  let hashJobs = 0;
  const cooldown = db.prepare(
    "SELECT created_at FROM public_email_cooldowns WHERE email=?",
  );
  const exists = db.prepare("SELECT email FROM accounts WHERE email=?");
  async function start(emailInput: unknown, purpose: "REGISTER" | "RESET") {
    const email = normalize(emailInput);
    db.prepare("DELETE FROM public_email_cooldowns WHERE created_at<=?").run(
      now() - TTL,
    );
    if (mailJobs >= 4)
      throw new PublicRegistrationError(503, "temporarily_unavailable");
    const prior = cooldown.get(email) as { created_at: number } | undefined;
    if (prior && now() - prior.created_at < COOLDOWN) return GENERIC;
    const account = exists.get(email);
    if (
      (purpose === "REGISTER" && account) ||
      (purpose === "RESET" && !account)
    )
      return GENERIC;
    db.prepare("DELETE FROM public_email_tokens WHERE expires_at<=?").run(
      now(),
    );
    const pending = db
      .prepare(
        "SELECT count(*) AS n FROM public_email_tokens WHERE expires_at>?",
      )
      .get(now()) as { n: number };
    if (pending.n >= 10_000)
      throw new PublicRegistrationError(503, "temporarily_unavailable");
    const token = randomBytes(32).toString("base64url"),
      time = now();
    db.prepare(
      "INSERT INTO public_email_tokens(token_hash,email,purpose,expires_at,created_at) VALUES(?,?,?,?,?)",
    ).run(sha(token), email, purpose, time + TTL, time);
    db.prepare(
      "INSERT INTO public_email_cooldowns(email,created_at) VALUES(?,?) ON CONFLICT(email) DO UPDATE SET created_at=excluded.created_at",
    ).run(email, time);
    const fragment = purpose === "REGISTER" ? "registro" : "recuperar";
    const text = `Continúa aquí: ${origin.origin}/${fragment}/#token=${token}`;
    mailJobs++;
    try {
      await config.sendMail({
        to: email,
        subject:
          purpose === "REGISTER"
            ? "Completa tu registro"
            : "Restablece tu contraseña",
        text,
      });
    } catch {
      db.prepare("DELETE FROM public_email_tokens WHERE token_hash=?").run(
        sha(token),
      );
      db.prepare(
        "DELETE FROM public_email_cooldowns WHERE email=? AND created_at=?",
      ).run(
        email,
        time,
      ); /* Keep the same generic response for known and unknown addresses. */
    } finally {
      mailJobs--;
    }
    return GENERIC;
  }
  async function withToken(
    tokenInput: unknown,
    purpose: "REGISTER" | "RESET",
    password: unknown,
    action: (email: string, passwordHash: string) => void,
    businessName?: unknown,
  ) {
    if (typeof tokenInput !== "string" || tokenInput.length > 256)
      throw new PublicRegistrationError(400, "invalid_token");
    if (!passwordValid(password))
      throw new PublicRegistrationError(400, "invalid_password");
    if (hashJobs >= 4)
      throw new PublicRegistrationError(503, "temporarily_unavailable");
    const tokenHash = sha(tokenInput),
      time = now();
    const row = db
      .prepare(
        "SELECT email FROM public_email_tokens WHERE token_hash=? AND purpose=? AND expires_at>?",
      )
      .get(tokenHash, purpose, time) as { email: string } | undefined;
    if (!row)
      throw new PublicRegistrationError(400, "invalid_or_expired_token");
    if (
      purpose === "REGISTER" &&
      (typeof businessName !== "string" ||
        !businessName.trim() ||
        businessName.trim().length > 160)
    )
      throw new PublicRegistrationError(400, "invalid_business_name");
    hashJobs++;
    let hashed: string;
    try {
      hashed = await hashAccountPassword(password);
    } catch {
      throw new PublicRegistrationError(400, "invalid_password");
    } finally {
      hashJobs--;
    }
    const fresh = db
      .prepare(
        "SELECT email FROM public_email_tokens WHERE token_hash=? AND purpose=? AND expires_at>?",
      )
      .get(tokenHash, purpose, now()) as { email: string } | undefined;
    if (!fresh || fresh.email !== row.email)
      throw new PublicRegistrationError(400, "invalid_or_expired_token");
    try {
      db.exec("BEGIN IMMEDIATE");
      const claimed = db
        .prepare(
          "DELETE FROM public_email_tokens WHERE token_hash=? AND purpose=? AND expires_at>?",
        )
        .run(tokenHash, purpose, now());
      if (Number(claimed.changes) !== 1)
        throw new PublicRegistrationError(400, "invalid_or_expired_token");
      action(row.email, hashed);
      db.prepare(
        "DELETE FROM public_email_tokens WHERE email=? AND purpose=?",
      ).run(row.email, purpose);
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      if (e instanceof PublicRegistrationError) throw e;
      throw new PublicRegistrationError(409, "registration_conflict");
    }
    return { email: row.email };
  }
  return {
    startRegistration(email: unknown) {
      return start(email, "REGISTER");
    },
    completeRegistration(input: {
      token: unknown;
      businessName: unknown;
      password: unknown;
    }) {
      return withToken(
        input.token,
        "REGISTER",
        input.password,
        (email, passwordHash) => {
          const time = now(),
            license = randomBytes(18).toString("base64url"),
            activation = randomBytes(32).toString("hex");
          db.prepare(
            "INSERT INTO licenses(id,business_name,paid_through,revision,status,activation_hash,installation_id,created_at) VALUES(?,?,?,?,?,?,NULL,?)",
          ).run(
            license,
            (input.businessName as string).trim(),
            new Date(0).toISOString(),
            1,
            "ACTIVE",
            activation,
            new Date(time).toISOString(),
          );
          db.prepare(
            "INSERT INTO accounts(email,password_hash,license_id,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)",
          ).run(
            email,
            passwordHash,
            license,
            new Date(time).toISOString(),
            new Date(time).toISOString(),
          );
          db.prepare(
            "INSERT INTO license_trials(license_id,started_at,ends_at) VALUES(?,NULL,NULL)",
          ).run(license);
        },
        input.businessName,
      );
    },
    startReset(email: unknown) {
      return start(email, "RESET");
    },
    completeReset(input: { token: unknown; password: unknown }) {
      return withToken(
        input.token,
        "RESET",
        input.password,
        (email, passwordHash) => {
          const result = db
            .prepare(
              "UPDATE accounts SET password_hash=?,updated_at=? WHERE email=?",
            )
            .run(passwordHash, new Date(now()).toISOString(), email);
          if (Number(result.changes) !== 1) throw new Error("missing_account");
        },
      );
    },
  };
}
