# 2026-11-20 — Sincronización operativa y piloto Windows

## Objetivo

Publicar los cambios locales de Gastronomía para continuar desarrollo desde GitHub, sin cambiar la versión 0.1.37, generar instaladores ni desplegar servicios.

## Archivos y cambios

- **POS y Comandas:** importación CSV y búsqueda paginada; recorridos de pedido, salón, mostrador, delivery y caja; cachés focalizadas para evitar recargas completas y consultas de historial bajo demanda.
- **Tutorial:** primeros pasos y progreso local por cuenta, usuario y versión de guía; detalles en [la sesión de implementación](2026-11-15-tutorial-primeros-pasos.md).
- **Tienda web:** diseño, banner, fotos de productos, vista previa móvil y sincronización del catálogo por revisión. Contratos compartidos en `packages/contracts`; renderizado y pruebas en `apps/orders-service`.
- **Piloto de actualizaciones Windows:** commit separado `c0d308e` con validación Ed25519, confirmación nativa y guardas de caja cerrada. La configuración de distribución no se cambió. El updater de Mac sigue deshabilitado.

## Verificaciones

- `corepack pnpm exec turbo run typecheck build --force --output-logs=errors-only`: 22/22 tareas aprobadas, sin caché.
- `corepack pnpm --filter @gastronomy/web test`: 437 aprobadas; `corepack pnpm --filter @gastronomy/orders-service test`: 75 aprobadas.
- `corepack pnpm --filter @gastronomy/desktop-shell test`: 186 aprobadas, 1 omitida, después del build.
- SQLite en Electron como Node (`ELECTRON_RUN_AS_NODE=1`, desde `packages/database`: `electron.exe --import tsx --test src/**/*.test.ts`): 343 aprobadas, sin fallos.
- `corepack pnpm exec playwright test tests/e2e/user-tutorial.spec.ts tests/e2e/catalog-import.spec.ts tests/e2e/automatic-updates.spec.ts tests/e2e/web-site-banner.spec.ts tests/e2e/peak-salon.spec.ts --reporter=list`: 15 aprobadas.

## Riesgos y pendientes

- El piloto de Windows no queda activo por este push. No se validó un instalador de producción ni se publicó un feed. Mac se sigue distribuyendo manualmente.
- Quedan fuera copias del workspace, adjuntos, temporales de QA y una nota operativa histórica de Comandas que no pertenece al cambio de código.

## Continuidad y rollback

- Base `d6d6d60`; destino `origin/main` de Gastronomía. El piloto de Windows puede revertirse separadamente de los cambios del POS.
- Las migraciones SQLite 51–54 agregan progreso de tutorial, revisión de catálogo e índices. No bajar manualmente el esquema ni restaurar una base de producción como sustituto de revertir código; evaluar compatibilidad y copia recuperable antes de un rollback instalado.
