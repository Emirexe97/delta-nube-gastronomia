import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { comboComponentsHtml } from "./combo-ticket.ts";

test("combo ticket prints immutable choices and extras, safely escaped, without double-charging details", () => {
  assert.equal(comboComponentsHtml(), "");
  const html = comboComponentsHtml([
    {
      slotId: "main",
      slotName: "Principal <h1>",
      productId: "p",
      nameSnapshot: 'Burger & "doble"',
      quantity: 2,
      modifiers: [
        {
          modifierId: "x",
          nameSnapshot: "Queso <script>",
          unitPriceMinorSnapshot: 500,
        },
      ],
    },
  ]);
  assert.match(html, /2× Burger &amp; &quot;doble&quot;/);
  assert.match(html, /Principal &lt;h1&gt;/);
  assert.match(html, /\+ Queso &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|\$|500/);
});
