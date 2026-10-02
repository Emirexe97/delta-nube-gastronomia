# 2026-10-02 — Pedidos flexibles y conciliación de caja

## Objetivo y publicación

Publicar la unidad funcional auditada en `Emirexe97/delta-nube-gastronomia`, rama `main`, por pedido explícito del usuario: «commit y git push».

- Commit base: 2e36818f739605a06d18c7cc7715a7365f5e81d7
- Mensaje: `fix(pedidos): completar flujo flexible y conciliacion de caja`
- Sin cambio de versión ni generación de instalador.

## Cambios entregados

- Productos antes del cliente mediante borrador; validación completa al confirmar.
- Conversión retiro/envío no terminal; después del cobro requiere PIN, motivo y ajuste explícito del saldo o devolución.
- Cuenta corriente desde Pedidos y entrega con seña completa, sin duplicar cobros o ventas.
- Titularidad del envío configurable y congelada con el pago; liquidaciones y reversión de repartidores conciliadas con caja.
- Devoluciones parciales conservan obligaciones residuales y el envío ganado por un servicio ya entregado.
- Comandas programadas conservan fecha/hora y se destacan; opciones de informe de cierre desactivadas por defecto.
- Carga rápida inline restaurada y geometría de mesas coherente entre UI y backend.
- Migración 29: snapshot de titularidad del envío; los pagos históricos conservan titularidad del repartidor.

## Verificaciones

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @gastronomy/database test` | 121/121 |
| `pnpm --filter @gastronomy/web test` | 137/137 |
| `pnpm --filter @gastronomy/domain test` | 20/20 |
| `node --test apps/desktop-shell/src/scheduled-order-ticket.test.cjs` | 3/3 |
| `pnpm exec playwright test --output=test-results` | 77/77, ejecución completa |
| `pnpm build` | 7/7 paquetes |
| `pnpm typecheck` | 7/7 paquetes; repetido antes del commit |

Total: **358 pruebas aprobadas**. Se utilizaron perfiles temporales, sin modificar datos reales. ABI nativa restaurada a Electron. El índice excluye dependencias, builds, logs, bases locales y artefactos temporales.

## Riesgos y pendientes

- Pedidos terminales no se reabren mediante edición operativa.
- La seña externa superior al importe nuevo exige ajuste externo previo, no una devolución ficticia de caja.
- No se borran imputaciones recibidas de cuenta corriente ni se mezclan custodios de efectivo entre cuotas.
- Las liquidaciones antiguas ambiguas se bloquean; no se revierten movimientos ajenos.
- Impresión validada en tickets y vistas previas; falta comprobación con impresora física.
- Ejecutar migraciones normales y reconstruir desktop antes de entregar un instalador futuro.

## Continuidad y rollback

La matriz detallada y los límites están en `docs/qa/ORDER_FLOW_E2E_AUDIT.md`. La unidad integra contratos, dominio, aplicación, SQLite/demo e interfaz: no revertir archivos completos ni quitar solamente la migración dejando código que usa su columna. Los ajustes financieros conservan historial mediante contramovimientos.

## Archivos incluidos

- `README.md`
- `apps/desktop-shell/src/main.ts`
- `apps/desktop-shell/src/scheduled-order-ticket.cjs`
- `apps/desktop-shell/src/scheduled-order-ticket.d.cts`
- `apps/desktop-shell/src/scheduled-order-ticket.test.cjs`
- `apps/gastronomy-web/src/components/cash-session-report.tsx`
- `apps/gastronomy-web/src/components/order-editor.tsx`
- `apps/gastronomy-web/src/components/table-floor-plan.tsx`
- `apps/gastronomy-web/src/demo/demo-api.test.ts`
- `apps/gastronomy-web/src/demo/demo-api.ts`
- `apps/gastronomy-web/src/demo/demo-data.ts`
- `apps/gastronomy-web/src/pages/deliveries-page.tsx`
- `apps/gastronomy-web/src/pages/orders-page.tsx`
- `apps/gastronomy-web/src/pages/settings-page.tsx`
- `apps/gastronomy-web/src/pages/tables-page.tsx`
- `docs/FUNCTIONAL_FLOW_AUDIT.md`
- `docs/qa/ORDER_FLOW_E2E_AUDIT.md`
- `docs/work-sessions/2026-10-02-174137-fix-pedidos-completar-flujo-flexible-y-conciliacion-de-caja.md`
- `docs/work-sessions/TEMPLATE.md`
- `packages/application/src/index.ts`
- `packages/contracts/src/index.ts`
- `packages/database/src/migrations.ts`
- `packages/database/src/sqlite-repository.test.ts`
- `packages/database/src/sqlite-repository.ts`
- `packages/domain/src/cash-report.test.ts`
- `packages/domain/src/cash.ts`
- `packages/domain/src/delivery.ts`
- `packages/domain/src/domain.test.ts`
- `packages/domain/src/order-flow.test.ts`
- `packages/domain/src/order-rules.ts`
- `packages/domain/src/orders.ts`
- `tests/e2e/cash-session-report.spec.ts`
- `tests/e2e/customer-account-orders.spec.ts`
- `tests/e2e/desktop-flow.spec.ts`
- `tests/e2e/floor-plan-vector-editor.spec.ts`
- `tests/e2e/floor-plan-zoom.spec.ts`
- `tests/e2e/item-kitchen-notes.spec.ts`
- `tests/e2e/order-flexibility.spec.ts`
- `tests/e2e/scheduled-order-print.spec.ts`
- `tests/e2e/table-floor-plan.spec.ts`
- `tests/e2e/table-removal.spec.ts`
- `tests/e2e/visual-harmony.spec.ts`
