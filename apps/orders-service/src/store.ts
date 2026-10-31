import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { StoreConfig } from "./config.js";
import {
  parseWebOrderSubmission,
  quotedTotalMinor,
  createWhatsAppUrl,
  WebOrderValidationError,
  type WebOrderRecord,
  type CreateWebOrderResult,
} from "@gastronomy/web-orders";

type AuthScope = {
  storeId: string;
  siteId: string | null;
  role: "submit" | "receive";
};
type Row = {
  id: string;
  reference: string;
  store_id: string;
  site_id: string;
  sequence: number;
  created_at: string;
  received_at: string | null;
  submission: string;
  quoted_total_minor: number;
};
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export class OrdersStore {
  readonly db: DatabaseSync;
  readonly scopes = new Map<string, AuthScope>();
  constructor(dbPath: string, stores: StoreConfig[]) {
    this.db = new DatabaseSync(dbPath);
    const version = Number(
      (this.db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    );
    if (version > 1) {
      this.db.close();
      throw new Error("Unsupported orders database version");
    }
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stores (id TEXT PRIMARY KEY, whatsapp_number TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sites (store_id TEXT NOT NULL REFERENCES stores(id), id TEXT NOT NULL, PRIMARY KEY(store_id,id));
      CREATE TABLE IF NOT EXISTS orders (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, reference TEXT NOT NULL UNIQUE,
        store_id TEXT NOT NULL REFERENCES stores(id), site_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        body_hash TEXT NOT NULL, submission TEXT NOT NULL, quoted_total_minor INTEGER NOT NULL,
        created_at TEXT NOT NULL, received_at TEXT,
        UNIQUE(store_id,site_id,idempotency_key), FOREIGN KEY(store_id,site_id) REFERENCES sites(store_id,id)
      );
      CREATE INDEX IF NOT EXISTS orders_store_sequence ON orders(store_id,sequence);
    `);
    const syncStore = this.db.prepare(
      "INSERT INTO stores(id,whatsapp_number) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET whatsapp_number=excluded.whatsapp_number",
    );
    const syncSite = this.db.prepare(
      "INSERT OR IGNORE INTO sites(store_id,id) VALUES(?,?)",
    );
    for (const store of stores) {
      syncStore.run(store.id, store.whatsappNumber);
      for (const site of store.sites) syncSite.run(store.id, site.id);
      this.scopes.set(store.receiveTokenHash.toLowerCase(), {
        storeId: store.id,
        siteId: null,
        role: "receive",
      });
      for (const site of store.sites)
        this.scopes.set(site.submitTokenHash.toLowerCase(), {
          storeId: store.id,
          siteId: site.id,
          role: "submit",
        });
    }
    this.db.exec("PRAGMA user_version=1;");
  }
  authenticate(token: string): AuthScope | undefined {
    return this.scopes.get(digest(token));
  }
  private record(row: Row): WebOrderRecord {
    return {
      id: row.id,
      reference: row.reference,
      storeId: row.store_id,
      siteId: row.site_id,
      sequence: row.sequence,
      createdAt: row.created_at,
      receivedAt: row.received_at,
      status: "PENDING_CONFIRMATION",
      paymentStatus: "UNVERIFIED",
      quotedTotalMinor: row.quoted_total_minor,
      submission: parseWebOrderSubmission(JSON.parse(row.submission)),
    };
  }
  submit(
    storeId: string,
    siteId: string,
    key: string,
    value: unknown,
  ): { status: 200 | 201; result: CreateWebOrderResult } {
    let submission;
    try {
      submission = parseWebOrderSubmission(value);
    } catch (error) {
      if (error instanceof WebOrderValidationError)
        throw Object.assign(new Error("invalid_submission"), {
          status: 400,
          code: "bad_request",
        });
      throw error;
    }
    const serialized = JSON.stringify(submission);
    const bodyHash = digest(serialized);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare(
          "SELECT * FROM orders WHERE store_id=? AND site_id=? AND idempotency_key=?",
        )
        .get(storeId, siteId, key) as (Row & { body_hash: string }) | undefined;
      if (old) {
        if (old.body_hash !== bodyHash) {
          this.db.exec("ROLLBACK");
          throw Object.assign(new Error("conflict"), { status: 409 });
        }
        this.db.exec("COMMIT");
        const phone = (
          this.db
            .prepare("SELECT whatsapp_number FROM stores WHERE id=?")
            .get(storeId) as { whatsapp_number: string }
        ).whatsapp_number;
        return {
          status: 200,
          result: {
            order: this.record(old),
            whatsappUrl: createWhatsAppUrl(
              phone,
              this.record(old).submission,
              old.reference,
            ),
          },
        };
      }
      const id = randomUUID();
      const reference = `WEB-${randomUUID()}`;
      const createdAt = new Date().toISOString();
      this.db
        .prepare(
          "INSERT INTO orders(id,reference,store_id,site_id,idempotency_key,body_hash,submission,quoted_total_minor,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          reference,
          storeId,
          siteId,
          key,
          bodyHash,
          serialized,
          quotedTotalMinor(submission),
          createdAt,
        );
      const row = this.db
        .prepare("SELECT * FROM orders WHERE id=?")
        .get(id) as Row;
      this.db.exec("COMMIT");
      const phone = (
        this.db
          .prepare("SELECT whatsapp_number FROM stores WHERE id=?")
          .get(storeId) as { whatsapp_number: string }
      ).whatsapp_number;
      return {
        status: 201,
        result: {
          order: this.record(row),
          whatsappUrl: createWhatsAppUrl(phone, submission, reference),
        },
      };
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction already ended */
      }
      throw error;
    }
  }
  list(
    storeId: string,
    after: number,
    limit: number,
  ): { orders: WebOrderRecord[]; nextCursor: number; hasMore: boolean } {
    const rows = this.db
      .prepare(
        "SELECT * FROM orders WHERE store_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?",
      )
      .all(storeId, after, limit + 1) as Row[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((row) => this.record(row));
    return {
      orders: page,
      nextCursor: page.at(-1)?.sequence ?? after,
      hasMore,
    };
  }
  acknowledge(storeId: string, id: string): WebOrderRecord | undefined {
    this.db
      .prepare(
        "UPDATE orders SET received_at=COALESCE(received_at,?) WHERE id=? AND store_id=?",
      )
      .run(new Date().toISOString(), id, storeId);
    const row = this.db
      .prepare("SELECT * FROM orders WHERE id=? AND store_id=?")
      .get(id, storeId) as Row | undefined;
    return row ? this.record(row) : undefined;
  }
  close(): void {
    this.db.close();
  }
}
