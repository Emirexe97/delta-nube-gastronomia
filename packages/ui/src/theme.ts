/** Shared, offline-first visual foundation for the desktop and waiter apps. */
export const sharedThemeCss = `
:root {
  --dn-color-background: #f5f7fa;
  --dn-color-surface: #ffffff;
  --dn-color-surface-2: #f8fafc;
  --dn-color-text: #0f172a;
  --dn-color-text-body: #334155;
  --dn-color-text-muted: #64748b;
  --dn-color-border: #e2e8f0;
  --dn-color-primary: #c2410c;
  --dn-color-primary-hover: #9a3412;
  --dn-color-primary-soft: #fff7ed;
  --dn-font-sans: Inter, "Segoe UI", ui-sans-serif, system-ui, sans-serif;
  --dn-radius-control: 10px;
  --dn-radius-card: 16px;
  --dn-shadow-card: 0 1px 3px rgb(15 23 42 / 3%);
  color: var(--dn-color-text);
  background: var(--dn-color-background);
  font-family: var(--dn-font-sans);
  font-variant-numeric: tabular-nums;
}
:where(.dn-button) { border-radius: var(--dn-radius-control); transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease; }
:where(.dn-button):focus-visible, :where(.dn-input):focus-visible { outline: 2px solid var(--dn-color-primary); outline-offset: 2px; }
:where(.dn-input) { border-radius: var(--dn-radius-control); }
:where(.dn-card) { border-radius: var(--dn-radius-card); box-shadow: var(--dn-shadow-card); }
:where(.dn-badge) { border-radius: 999px; }
@media (pointer: coarse) {
  .dn-help-trigger, .dn-button { min-width: 44px; min-height: 44px; }
  .dn-field[data-has-help="true"] .dn-field-caption { min-height: 44px; display: flex; align-items: center; padding-right: 48px; }
  .dn-field-help { width: 44px; height: 44px; }
}
@media (prefers-reduced-motion: reduce) { :where(.dn-button) { transition: none; } }
`;
