import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { StoreConfig } from "./config.js";
import type { TenantSite } from "./tenant-storefront.js";
import {
  parseWebOrderSubmission,
  quotedTotalMinor,
  createWhatsAppUrl,
  parseWebCatalogSnapshot,
  WebOrderValidationError,
  type WebOrderRecord,
  type CreateWebOrderResult,
} from "@gastronomy/web-orders";

type AuthScope = {
  storeId: string;
  receiveInstallationId?: string;
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
    if (version > 2) {
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
      CREATE TABLE IF NOT EXISTS web_catalogs (store_id TEXT PRIMARY KEY REFERENCES stores(id), snapshot TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tenant_sites (
        license_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL UNIQUE,
        store_id TEXT NOT NULL UNIQUE REFERENCES stores(id), slug TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '', accent TEXT NOT NULL DEFAULT '#1f6f50',
        design_mode TEXT NOT NULL DEFAULT 'STANDARD' CHECK(design_mode IN ('STANDARD','CUSTOM')),
        template_key TEXT, receive_hash TEXT NOT NULL UNIQUE
      );
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
        ...(store.receiveInstallationId
          ? { receiveInstallationId: store.receiveInstallationId }
          : {}),
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
    this.db.exec("PRAGMA user_version=2;");
  }
  authenticate(token: string): AuthScope | undefined {
    const hash = digest(token);
    const configured = this.scopes.get(hash);
    if (configured) return configured;
    const tenant = this.db
      .prepare(
        "SELECT store_id,installation_id FROM tenant_sites WHERE receive_hash=?",
      )
      .get(hash) as { store_id: string; installation_id: string } | undefined;
    return tenant
      ? {
          storeId: tenant.store_id,
          receiveInstallationId: tenant.installation_id,
          siteId: null,
          role: "receive",
        }
      : undefined;
  }
  provisionTenant(input: {
    licenseId: string;
    installationId: string;
    businessName: string;
    slug: string;
    whatsappNumber: string;
    receiveToken: string;
  }): {
    storeId: string;
    slug: string;
    displayName: string;
    tagline: string;
    accent: string;
    designMode: "STANDARD" | "CUSTOM";
  } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare(
          "SELECT license_id,installation_id,store_id,slug,display_name,tagline,accent,design_mode FROM tenant_sites WHERE license_id=? OR installation_id=?",
        )
        .get(input.licenseId, input.installationId) as
        | (Omit<TenantSite, "template_key"> & {
            license_id: string;
            installation_id: string;
          })
        | undefined;
      if (existing) {
        if (
          existing.license_id !== input.licenseId ||
          existing.installation_id !== input.installationId
        )
          throw Object.assign(new Error("conflict"), { status: 409 });
        const nextReceiveHash = digest(input.receiveToken);
        this.db
          .prepare(
            "UPDATE tenant_sites SET receive_hash=? WHERE store_id=? AND receive_hash<>?",
          )
          .run(nextReceiveHash, existing.store_id, nextReceiveHash);
        this.db.exec("COMMIT");
        return {
          storeId: existing.store_id,
          slug: existing.slug,
          displayName: existing.display_name,
          tagline: existing.tagline,
          accent: existing.accent,
          designMode: existing.design_mode,
        };
      }
      if (
        this.db
          .prepare("SELECT 1 FROM tenant_sites WHERE slug=?")
          .get(input.slug)
      )
        throw Object.assign(new Error("conflict"), { status: 409 });
      const storeId = `tenant_${randomUUID().replaceAll("-", "")}`;
      if (
        this.db
          .prepare("SELECT 1 FROM stores WHERE lower(id)=?")
          .get(input.slug)
      )
        throw Object.assign(new Error("conflict"), { status: 409 });
      const displayName = input.businessName.trim().slice(0, 80) || input.slug;
      this.db
        .prepare("INSERT INTO stores(id,whatsapp_number) VALUES(?,?)")
        .run(storeId, input.whatsappNumber);
      this.db
        .prepare("INSERT INTO sites(store_id,id) VALUES(?,?)")
        .run(storeId, "web");
      this.db
        .prepare(
          "INSERT INTO tenant_sites(license_id,installation_id,store_id,slug,display_name,receive_hash) VALUES(?,?,?,?,?,?)",
        )
        .run(
          input.licenseId,
          input.installationId,
          storeId,
          input.slug,
          displayName,
          digest(input.receiveToken),
        );
      this.db.exec("COMMIT");
      return {
        storeId,
        slug: input.slug,
        displayName,
        tagline: "",
        accent: "#1f6f50",
        designMode: "STANDARD",
      };
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw e;
    }
  }
  getTenantBySlug(slug: string): TenantSite | undefined {
    return this.db
      .prepare(
        "SELECT store_id,slug,display_name,tagline,accent,design_mode,template_key FROM tenant_sites WHERE slug=?",
      )
      .get(slug) as TenantSite | undefined;
  }
  updateTenantBranding(
    storeId: string,
    value: { displayName: string; tagline: string; accent: string },
  ): boolean {
    const result = this.db
      .prepare(
        "UPDATE tenant_sites SET display_name=?,tagline=?,accent=? WHERE store_id=? AND design_mode='STANDARD'",
      )
      .run(value.displayName, value.tagline, value.accent, storeId);
    return Number(result.changes) === 1;
  }
  getTenantBranding(
    storeId: string,
  ):
    | {
        displayName: string;
        tagline: string;
        accent: string;
        designMode: "STANDARD" | "CUSTOM";
      }
    | undefined {
    const row = this.db
      .prepare(
        "SELECT display_name,tagline,accent,design_mode FROM tenant_sites WHERE store_id=?",
      )
      .get(storeId) as
      | {
          display_name: string;
          tagline: string;
          accent: string;
          design_mode: "STANDARD" | "CUSTOM";
        }
      | undefined;
    return row
      ? {
          displayName: row.display_name,
          tagline: row.tagline,
          accent: row.accent,
          designMode: row.design_mode,
        }
      : undefined;
  }
  publishCatalog(storeId: string, value: unknown): { revision: number } {
    const snapshot = parseWebCatalogSnapshot(value);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare("SELECT revision FROM web_catalogs WHERE store_id=?")
        .get(storeId) as { revision: number } | undefined;
      const revision = (old?.revision ?? 0) + 1;
      this.db
        .prepare(
          "INSERT INTO web_catalogs(store_id,snapshot,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(store_id) DO UPDATE SET snapshot=excluded.snapshot,revision=excluded.revision,updated_at=excluded.updated_at",
        )
        .run(
          storeId,
          JSON.stringify(snapshot),
          revision,
          new Date().toISOString(),
        );
      this.db.exec("COMMIT");
      return { revision };
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }
  getCatalog(
    storeId: string,
  ):
    | {
        snapshot: ReturnType<typeof parseWebCatalogSnapshot>;
        revision: number;
        updatedAt: string;
      }
    | undefined {
    const row = this.db
      .prepare(
        "SELECT snapshot,revision,updated_at FROM web_catalogs WHERE store_id=?",
      )
      .get(storeId) as
      { snapshot: string; revision: number; updated_at: string } | undefined;
    return row
      ? {
          snapshot: parseWebCatalogSnapshot(JSON.parse(row.snapshot)),
          revision: row.revision,
          updatedAt: row.updated_at,
        }
      : undefined;
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
    requirePublishedCatalog = false,
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
      const currentCatalog = this.getCatalog(storeId);
      if (!currentCatalog && requirePublishedCatalog) {
        this.db.exec("ROLLBACK");
        throw Object.assign(new Error("catalog_not_published"), {
          status: 409,
          code: "catalog_not_published",
        });
      }
      if (currentCatalog) {
        const prices = new Map(
          currentCatalog.snapshot.products.map((p) => [p.productRef, p]),
        );
        const priceKey =
          submission.fulfillment.type === "DELIVERY"
            ? "deliveryPriceMinor"
            : "takeawayPriceMinor";
        if (
          submission.items.some((item) => {
            const product = prices.get(item.productRef);
            return (
              !product ||
              product[priceKey] !== item.unitPriceMinor ||
              (requirePublishedCatalog && item.name !== product.name)
            );
          })
        ) {
          this.db.exec("ROLLBACK");
          throw Object.assign(new Error("catalog_changed"), {
            status: 409,
            code: "catalog_changed",
          });
        }
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
