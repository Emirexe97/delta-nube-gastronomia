# 2026-10-09 — Auditoría de usabilidad y recuperación segura

## Objetivo

Publicar el trabajo acumulado desde 4fa6747: legibilidad y claridad operativa,
protección de backups/restauración, recuperación financiera/documental segura,
correcciones de clientes/caja/historial/foco y preferencia de vista de Salón.

## Archivos y cambios

- apps/gastronomy-web: interfaz, filtros, vistas previas, demo y tests de paridad.
- apps/desktop-shell: IPC, ejecución E2E oculta y backups/restauración seguros.
- packages/application, contracts, database y domain: recuperación autorizada,
  idempotencia, historial inmutable y migraciones vigentes hasta37.
- packages/ui y tests/e2e: controles y regresiones funcionales/nativas.
- docs/qa/SYSTEM_USABILITY_AUDIT_PLAN.md: bitácora hasta§75 y límites por pasada.
- .gitignore y docs/qa/evidence: salidas pesadas locales; se versionan placeholders
  y resúmenes de regresión, no bases, perfiles, capturas, traces ni source backups.

## Verificaciones

- pnpm typecheck:7/7 antes de commit (caché, sin fuente modificada posteriormente).
- Última integral completa§73:325/325,71 archivos (308 visibles+17 ocultos).
- §74:12/12 focales+17/17 ocultos después de recordar vista; web265/26523archivos,
  typecheck/build7/7. Integral328 no ejecutada:328/72 es sólo inventario nuevo.
- DB212/212,dominio24/24,shell27/27 de§73; backend intacto después de esos checks.
- RED y fallos reales previos conservados localmente, no ocultados con retries.
- git diff --cached --check requerido antes de commit.

## Riesgos y pendientes

- 24/25 hallazgos originales cerrados; sólo US18 parcial pendiente.
- §75 define criterios delegados, no implementa anulación de compras.
- Próximo corte: anulación documental duplicado/ingreso inexistente, sin delta
  automático stock/caja; preservar originales, cierres, manuales y COGS vendidos.
- Devolución real de mercadería y pagos proveedor no son borrado de compra.
- Hardware y accesibilidad completa no certificados por estas pruebas.
- Versión0.1.19 conservada; publicación de código, no instalador/despliegue.

## Continuidad y rollback

Base4fa6747; destino origin/main en Emirexe97/delta-nube-gastronomia.
El lote integra cambios de varias pasadas acoplados en contratos/repo/demo/UI/tests;
no dividir por tipo de archivo ni revertir sólo un lado de una recuperación.
Rollback de código no elimina ledgers, recibos o datos de operaciones reales.
Usar backups antes de migraciones, sin reset global sobre trabajo posterior.

SQLite actual está construido para Electron39 (ABI140): no reconstruir para Node
antes de pruebas nativas. pnpm test:e2e reconstruye nativo; usar runner compatible.
El modo demo local es independiente de la base SQLite de la aplicación instalada.
