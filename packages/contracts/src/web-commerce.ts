import type { OrderDto } from "./index";
import type { WebOrderRecord } from "@gastronomy/web-orders";
export type {
  WebOrderRecord,
  WebCatalogSnapshot,
} from "@gastronomy/web-orders";

export interface WebOrderDraft {
  customerName: string;
  customerPhone: string;
  type: "TAKEAWAY" | "DELIVERY";
  deliveryAddress: string;
  deliveryFeeMinor: number;
  notes: string;
  items: Array<{ productRef: string; quantity: number; notes: string }>;
}
export interface WebInboxEntry {
  original: WebOrderRecord;
  draft: WebOrderDraft;
  revision: number;
  status: "PENDING" | "CONFIRMED" | "REJECTED" | "REVIEW_RESTORE";
  orderId: string | null;
}
export interface WebSyncStatus {
  state: "UNCONFIGURED" | "PENDING" | "SYNCING" | "SYNCED" | "ERROR";
  lastSyncedAt: string | null;
  message: string;
}
export interface WebSiteStatus {
  state: "UNCONFIGURED" | "NOT_REGISTERED" | "PENDING" | "ACTIVE" | "ERROR";
  slug: string | null;
  url: string | null;
  displayName: string;
  tagline: string;
  accent: string;
  designMode: "STANDARD" | "CUSTOM";
  message: string;
}
export interface WebCommerceApi {
  getWebSiteStatus(): Promise<WebSiteStatus>;
  /** Acts on the canonical site of this installation, never a renderer-supplied URL. */
  shareWebSite(action: "open" | "copy" | "qr"): Promise<{ completed: boolean }>;
  registerWebSite(input: {
    slug: string;
    whatsappNumber: string;
  }): Promise<WebSiteStatus>;
  updateWebSiteBranding(input: {
    displayName: string;
    tagline: string;
    accent: string;
  }): Promise<WebSiteStatus>;
  setWebPublication(input: {
    productId: string;
    enabled: boolean;
  }): Promise<void>;
  getWebSyncStatus(): Promise<WebSyncStatus>;
  retryWebSync(): Promise<WebSyncStatus>;
  listWebOrders(): Promise<WebInboxEntry[]>;
  saveWebOrderDraft(input: {
    id: string;
    revision: number;
    draft: WebOrderDraft;
  }): Promise<WebInboxEntry>;
  rejectWebOrder(input: {
    id: string;
    revision: number;
    reason: string;
  }): Promise<void>;
  confirmWebOrder(input: {
    id: string;
    revision: number;
    expectedTotalMinor: number;
  }): Promise<{ created: boolean; order: OrderDto }>;
}

// Safe for both the renderer and Electron main. Comparing the complete string
// also rejects URL-parser normalization tricks (userinfo, :443, dot segments).
export function getMerchantShareUrl(
  site: Pick<WebSiteStatus, "slug" | "url"> & { state: string },
): string | null {
  if (
    site.state !== "ACTIVE" ||
    typeof site.slug !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(site.slug)
  )
    return null;
  const canonical = `https://${site.slug}.deltanubeweb.com`;
  return site.url === canonical || site.url === canonical + "/"
    ? canonical
    : null;
}
