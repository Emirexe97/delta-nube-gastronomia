/**
 * Layout of the ordering page. Cover and product styles live in @gastronomy/ui so
 * the merchant sees the same composition in the POS, the private link and here.
 */
export const storefrontLayoutCss = `
:root {
  color-scheme: light; --ink:#222520; --muted:#5b6159; --paper:#faf9f5; --card:#fffefa;
  --line:#dadbd2; --accent: #9c4329; --accent-dark: #71301e; --accent-foreground: #ffffff;
  --sage:#384b3d; --display: Georgia, "Times New Roman", serif;
  --mono: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font: 100%/1.45 system-ui, -apple-system, sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink)}
input,select,textarea,button{font:inherit;color:inherit}
button,select{cursor:pointer} button:disabled{cursor:not-allowed}
:where(a,input,select,textarea,button):focus-visible{outline:3px solid #15659b;outline-offset:3px}
[hidden],.hidden{display:none!important}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)}
.wrap{width:min(100%,1240px);margin-inline:auto;padding-inline:clamp(16px,3.5vw,48px)}
.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(272px,306px);align-items:start;gap:clamp(24px,4vw,60px);padding-block:clamp(24px,3vw,44px) 96px}
main,.aside,.section-head>*{min-width:0}
.aside{position:sticky;top:18px}
.order-controls{background:#f1f1ea;border-bottom:1px solid var(--line)}
.topline,.channel{display:flex;align-items:center}
.channel{gap:14px;padding-block:6px}
.channel label{font-size:.83rem;font-weight:600}
.channel select,.catalog-nav{min-width:0;max-width:100%;min-height:44px;padding:6px 12px;background:var(--card);border:1px solid #b9bdae;border-radius:9px;font-size:.875rem;font-weight:650}
#deliveryHint{margin:0;padding-bottom:8px}
.subtle,.fee-note,.confirmation-note{color:var(--muted);font-size:.83rem}
.catalog-jump,.category,#cartTitle{scroll-margin-top:20px}
.section-head{display:grid;grid-template-columns:minmax(155px,1fr) minmax(180px,1fr) auto;align-items:center;gap:15px 0;margin-bottom:27px}
.section-head>div:first-child{grid-area:1/1/2/2;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.section-head h2{font:normal clamp(2.4rem,4.2vw,3.65rem)/1 var(--display);margin:0;letter-spacing:-.055em}
#itemCount{font:500 .71rem/1.2 var(--mono);color:var(--muted)}
.catalog-tools{display:contents}
.catalog-search,.catalog-search-clear{grid-area:1/2/2/4}
.catalog-search{display:block;position:relative;align-self:center}
.catalog-search::before,.catalog-search::after{content:"";position:absolute;pointer-events:none;z-index:1}
.catalog-search::before{width:12px;height:12px;border:1.8px solid #545b50;border-radius:50%;left:14px;top:calc(50% - 8px)}
.catalog-search::after{width:7px;height:2px;background:#545b50;transform:rotate(45deg);left:24px;top:calc(50% + 5px)}
#catalogSearch{display:block;width:100%;min-height:46px;border:1px solid #c5c8bc;border-radius:12px;background:#fffefa;padding:9px 62px 9px 38px;font-size:1rem}
#catalogSearch::placeholder{color:#61685d}
#catalogSearch::-webkit-search-cancel-button{display:none}
.catalog-search-clear{z-index:1;justify-self:end;margin-right:5px;border:0;background:transparent;min-height:42px;padding:0 8px;font-size:.8rem;font-weight:650;text-decoration:underline}
.category-filters{grid-area:2/1/3/4;display:flex;align-items:center;gap:7px;min-width:0;overflow-x:auto;scroll-padding:4px;scrollbar-width:thin;padding:4px 2px 5px}
.catalog-tools:has(.catalog-nav:not([hidden])) .category-filters{grid-column-end:3}
.category-filters:empty{display:none}
.category-filter{border:1px solid #c4c8ba;border-radius:999px;min-height:44px;max-width:min(18rem,75vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none;padding:7px 16px;background:transparent;font-size:.875rem;font-weight:570}
.category-filter[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.category-filter:focus-visible{outline-offset:-3px;outline-color:#227eb8}
.catalog-nav{grid-area:2/3/3/4;margin-left:8px;max-width:165px}
.catalog-no-results,.skeleton{padding:20px;border:1px dashed #b8bdae;border-radius:12px;color:var(--muted)}
.category{margin:0 0 30px}
.category>h3{display:flex;align-items:center;gap:12px;color:var(--ink);font:650 1.12rem/1.35 system-ui,sans-serif;letter-spacing:-.025em;margin:0 0 12px;overflow-wrap:anywhere}
.category>h3::after{content:"";height:1px;flex:1;min-width:20px;background:var(--line)}
.menu-grid{container:storefront-products / inline-size;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cartbox{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--ink);border-radius:4px 4px 16px 16px;padding:clamp(18px,2vw,26px)}
.cartbox>h2{font:normal 2rem/1.05 var(--display);letter-spacing:-.045em;margin:2px 0 6px}
.cartbox>.subtle{font:500 .68rem/1.6 var(--mono);margin:0 0 20px}
.return-menu{display:block;width:fit-content;padding:5px 0 8px;color:var(--muted);font-size:.78rem;font-weight:600;text-underline-offset:3px}
.cart-empty{padding:24px 0;margin:0;color:var(--muted);border-block:1px dashed #c6caba;font-size:.9rem}
.cart-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border-bottom:1px dashed var(--line);padding:12px 0}
.cart-title{font-weight:650;overflow-wrap:anywhere}.cart-price{font-size:.82rem;color:var(--muted)}
.quantity{display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.quantity button{width:40px;height:42px;background:transparent;border:1px solid var(--line);border-radius:10px;font-size:1.05rem}
.total{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:17px 0 6px;font-weight:660}.total span:last-child{font-variant-numeric:tabular-nums}
.fee-note,.confirmation-note{margin:5px 0 12px;font-size:.78rem;line-height:1.5}
.checkout{border-top:1px solid var(--line);margin-top:18px;padding-top:18px}
.checkout h3,.notice h2{font:650 1rem/1.3 system-ui,sans-serif;margin:0 0 10px}
.field{margin:10px 0}.field label{display:block;font-size:.85rem;font-weight:630;margin-bottom:5px}
.field input,.field textarea{width:100%;border:1px solid #babfb2;background:white;border-radius:8px;padding:10px 12px;font-size:1rem}
.field textarea{min-height:72px;resize:vertical}
.add,.primary{min-height:44px;border:0;border-radius:9px;background:var(--accent);color: var(--accent-foreground);font-weight:650;padding:10px 16px}
.primary{width:100%}.primary:disabled{background:#e3e5de;color:#555a50}
.checkout:has(.status:empty) .status{margin:0}
.cartbox:has(.cart-empty) .checkout>:is(h3,.checkout-grid,.subtle,.primary){display:none}
.cartbox:has(.cart-empty) .checkout:not(:has(.success:not(.hidden),.status:not(:empty))){display:none}
.notice{padding:15px 18px;background:#fff4de;border:1px solid #d9bc83;border-radius:10px;margin:14px 0}.notice p{margin:4px 0}.notice ul{padding-left:1.3em}.notice button{margin-top:6px}
.status,.success{font-size:.9rem}.success{padding:12px;background:#e7f1e9;border:1px solid #bdd6bc;border-radius:10px}.success a{color:inherit;font-weight:650}
.cart-jump{display:none}
@media(hover:hover){.category-filter:not([aria-pressed="true"]):hover,.quantity button:not(:disabled):hover{background:#ecede5;border-color:#98a08e}.primary:not(:disabled):hover{filter:brightness(.92)}}
@media(max-width:940px){.layout{grid-template-columns:1fr;gap:24px}.aside{position:static}.cartbox{max-width:640px;margin-inline:auto}
  .cart-jump:not([hidden]){position:fixed;z-index:9;bottom:max(12px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);width:min(calc(100% - 24px),460px);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 20px;min-height:50px;background:var(--ink);color:white;border:1px solid #ffffff38;border-radius:14px;box-shadow:0 6px 22px #15191430;text-decoration:none;font-size:.95rem;font-weight:650}.cart-jump__total{font-variant-numeric:tabular-nums}
  .cartbox .checkout-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.checkout-grid .wide{grid-column:1/-1}
  body:has(.cart-jump:not([hidden])) .wrap{scroll-padding-bottom:76px}}
@media(max-width:600px){.wrap{padding-inline:16px}.layout{padding-block:22px 84px}.section-head{grid-template-columns:minmax(0,1fr) auto;gap:12px 0;margin-bottom:20px}
  .section-head>div:first-child{grid-area:1/1/2/3;justify-content:space-between}.catalog-search,.catalog-search-clear{grid-area:2/1/3/3}
  .category-filters{grid-area:3/1/4/3}.catalog-tools:has(.catalog-nav:not([hidden])) .category-filters{grid-column-end:3}.catalog-nav{grid-area:4/1/5/3;margin-left:0;justify-self:start}
  .menu-grid{grid-template-columns:1fr;gap:9px}.category{margin-bottom:24px}.channel{width:100%;justify-content:space-between}.cartbox .checkout-grid{display:block}}
@media(prefers-reduced-motion:no-preference){.category-filter,.primary{transition:background-color .15s,color .15s}}
`;
