import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3-multiple-ciphers";
import type { PriceBookRoundingIncrementMinor, PriceChannel } from "@gastronomy/contracts";
import { calculateBookPrice } from "@gastronomy/domain";

const channels = ["SALON", "TAKEAWAY", "DELIVERY"] as const;
const labels = { SALON: "Salón", TAKEAWAY: "Retiro", DELIVERY: "Delivery" };

/** Compatibility for pre-book callers only. Called inside the product transaction. */
export function reconcileLegacyPrices(
  db: InstanceType<typeof Database>,
  productId: string,
  prices: Array<{ priceListCode: PriceChannel; amountMinor: number }>,
) {
  const books = db
    .prepare(
      `SELECT a.channel, b.id, b.is_base, b.adjustment_bps, b.rounding_increment_minor
    FROM price_book_assignments a JOIN price_books b ON b.id=a.book_id`,
    )
    .all() as Array<{
    channel: PriceChannel;
    id: string;
    is_base: number;
    adjustment_bps: number;
    rounding_increment_minor?: number;
  }>;
  const values = new Map(prices.map((p) => [p.priceListCode, p.amountMinor]));
  const prior = db
    .prepare(
      "SELECT amount_minor FROM product_price_book_bases WHERE product_id=?",
    )
    .get(productId) as { amount_minor: number };
  const baseChannel = channels.find(
    (channel) =>
      values.has(channel) && books.find((b) => b.channel === channel)?.is_base,
  );
  const base = baseChannel ? values.get(baseChannel)! : prior.amount_minor;
  calculateBookPrice(base, 0);
  db.prepare(
    "UPDATE product_price_book_bases SET amount_minor=? WHERE product_id=?",
  ).run(base, productId);
  const setOwn =
    db.prepare(`INSERT INTO product_price_book_overrides(product_id,book_id,amount_minor)
    VALUES(?,?,?) ON CONFLICT(product_id,book_id) DO UPDATE SET amount_minor=excluded.amount_minor`);
  for (const id of new Set(books.map((b) => b.id))) {
    const members = channels.filter(
      (channel) =>
        books.some((b) => b.channel === channel && b.id === id) &&
        values.has(channel),
    );
    if (!members.length) continue;
    const source = books.find((b) => b.id === id)!;
    const anchor = source.is_base ? base : values.get(members[0]!)!;
    const amounts = [...new Set(members.map((ch) => values.get(ch)!))];
    for (const amount of amounts) {
      calculateBookPrice(amount, 0);
      const group = members.filter((ch) => values.get(ch) === amount);
      let target = source.id;
      if (amount !== anchor) {
        // A legacy client cannot request two different prices in one explicitly shared list.
        // On untouched/migrated setups only, split the group, cloning the old rule and
        // exceptions so the other products' effective prices and inheritance do not change.
        if (
          db
            .prepare(
              "SELECT 1 FROM audit_log WHERE action='PRICE_BOOKS_ASSIGNED' LIMIT 1",
            )
            .get()
        )
          throw new Error(
            "Los modos comparten una lista. Editá el precio desde la ficha de listas.",
          );
        target = randomUUID();
        const stem = group.map((ch) => labels[ch]).join(" / ");
        let name = stem;
        for (
          let i = 2;
          db
            .prepare("SELECT 1 FROM price_books WHERE name=? COLLATE NOCASE")
            .get(name);
          i++
        )
          name = stem + " (" + i + ")";
        db.prepare(
          `INSERT INTO price_books(id,name,adjustment_bps,is_base,sort_order,rounding_increment_minor)
          VALUES (?,?,?,0,(SELECT COALESCE(MAX(sort_order),0)+1 FROM price_books),?)`,
        ).run(target, name, source.adjustment_bps, source.rounding_increment_minor ?? 1);
        db.prepare(
          `INSERT INTO product_price_book_overrides(product_id,book_id,amount_minor)
          SELECT product_id,?,amount_minor FROM product_price_book_overrides WHERE book_id=?`,
        ).run(target, source.id);
        for (const ch of group)
          db.prepare(
            "UPDATE price_book_assignments SET book_id=? WHERE channel=?",
          ).run(target, ch);
      }
      if (target === source.id && source.is_base) continue;
      const fixed = db
        .prepare(
          "SELECT amount_minor FROM product_price_book_overrides WHERE product_id=? AND book_id=?",
        )
        .get(productId, target) as { amount_minor: number } | undefined;
      if (fixed?.amount_minor === amount) continue; // Do not erase an intentional fixed price on an unrelated edit.
      let calculated: number | undefined;
      try {
        calculated = calculateBookPrice(base, source.adjustment_bps, undefined,
          Number(source.rounding_increment_minor ?? 1) as PriceBookRoundingIncrementMinor);
      } catch {
        /* This fixed legacy price can be valid even if inheritance would overflow. */
      }
      if (calculated === amount)
        db.prepare(
          "DELETE FROM product_price_book_overrides WHERE product_id=? AND book_id=?",
        ).run(productId, target);
      else setOwn.run(productId, target, amount);
    }
  }
  const effective = db
    .prepare(
      `SELECT b.adjustment_bps, b.rounding_increment_minor, o.amount_minor FROM price_books b
    LEFT JOIN product_price_book_overrides o ON o.book_id=b.id AND o.product_id=?`,
    )
    .all(productId) as Array<{
    adjustment_bps: number;
    rounding_increment_minor?: number;
    amount_minor: number | null;
  }>;
  for (const b of effective)
    calculateBookPrice(base, b.adjustment_bps, b.amount_minor ?? undefined,
      Number(b.rounding_increment_minor ?? 1) as PriceBookRoundingIncrementMinor);
}
