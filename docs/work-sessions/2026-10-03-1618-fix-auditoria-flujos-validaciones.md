# 2026-10-03 — Correcciones acotadas de la auditoría de flujos

## Objetivo

Resolver los hallazgos de la auditoría autorizados por el usuario, recuperar el modal de productos de carga rápida y publicar las correcciones sin cambios ajenos, versión nueva ni instalador.

## Archivos y cambios

- `apps/gastronomy-web/src/pages/tables-page.tsx`, `components/order-editor.tsx`: confirmar mesa y mozo abre el editor con el pedido recién creado mientras se refresca bootstrap; precargas monetarias exactas y texto de guardado simplificado.
- `apps/gastronomy-web/src/lib.ts`, `lib.test.ts`: precarga con coma decimal sin redondeos, conservando enteros sin decimales; fechas locales y regresiones.
- `apps/gastronomy-web/src/pages/cash-page.tsx`, `customers-page.tsx`, `finance-page.tsx`: corregir precargas de cambio final, cobro de cuenta y costo manual; rechazar costo inválido en vez de guardarlo como cero; quitar explicación técnica de debounce. CSV Finanzas usa pesos explícitos, neutraliza fórmulas y no exporta datos de un período todavía sin cargar.
- `apps/gastronomy-web/src/pages/orders-page.tsx`: rechazar envío inválido, demora infinita/fraccionaria/no positiva y fechas inválidas; confirmar antes de descartar cambios con Escape, Cerrar o Cancelar; compactar ayuda permanente de productos.
- `apps/gastronomy-web/src/pages/audit-page.tsx`: errores visibles con reintento, búsqueda en servidor antes del límite, páginas de 100 eventos y opciones estables de acciones sensibles.
- `apps/gastronomy-web/src/pages/reports-page.tsx`: fechas iniciales locales y exportación del período visible; bloquear rangos vacíos/invertidos.
- `apps/gastronomy-web/src/pages/settings-page.tsx`: compactar ayuda de caja y aviso técnico de corte, conservando limitaciones y avisos operativos importantes.
- `packages/contracts/src/index.ts`, `packages/application/src/index.ts`, `apps/desktop-shell/src/preload.ts`: contratos de filtro de exportación y búsqueda/paginación de auditoría; lista compartida de acciones existentes, sin ampliar la política de auditoría.
- `packages/database/src/sqlite-repository.ts`, `sqlite-repository.test.ts`: validar la ficha fusionada antes de modificar registros; clonar direcciones al simular para preservar el snapshot previo; CSV filtrado por día comercial con moneda clara; búsqueda literal Unicode y paginación SQL con orden estable.
- `apps/gastronomy-web/src/demo/demo-api.ts`, `demo-api.test.ts`: paridad de límites de fusión y búsqueda/paginación; rechazo sin mutación por direcciones duplicadas. La exportación demo sigue siendo una simulación explícita.
- `packages/domain/src/csv.ts`, `csv.test.ts`, `index.ts`: serialización CSV compartida con escape y neutralización de fórmulas en texto no confiable.
- `apps/desktop-shell/src/main.ts`: respetar Mostrar fecha en cuenta de cliente; conservar fecha operativa de cocina; pasar filtros a exportación.
- `tests/e2e/audit-fixes.spec.ts`: seis regresiones de importes/costos, CSV, fecha de ticket, protección del formulario y errores/paginación de auditoría.
- `tests/e2e/desktop-flow.spec.ts`, `quick-entry-navigation.spec.ts`, `table-removal.spec.ts`: expectativas del modal restaurado, atajos, autorización de precios y eliminación/recreación de mesa vacía sin estado latente; aceptar explícitamente el nuevo cierre protegido cuando corresponde.
- `docs/qa/ORDER_FLOW_E2E_AUDIT.md`: actualizar solamente OF-14 y documentar que el pedido del usuario reemplaza el criterio inline del 2 de octubre.
- Este handoff registra alcance, verificaciones y rollback.

## Verificaciones

- `pnpm test`: **292 pruebas aprobadas** (142 web, 126 database, 21 domain, 3 desktop); 7 tareas exitosas.
- `pnpm typecheck`: **7 paquetes aprobados**.
- `pnpm build`: **7 paquetes aprobados**; sólo advertencia existente de tamaño de chunk Vite, sin cambiar bundling por estar fuera de alcance.
- `pnpm --filter @gastronomy/desktop-shell rebuild:native`: correcto, después de los tests Node y antes de Electron.
- `pnpm exec playwright test`: **78/78 aprobadas**, última corrida completa después de todos los cambios de fuente (2,3 minutos).
- `git diff --check`: sin errores.
- Perfiles y bases de pruebas temporales; exportaciones CSV en rutas temporales. Impresión validada mediante previews cancelados o mocks, sin impresión física.

## Riesgos y pendientes

- Sin migraciones, cambios de versión ni regeneración de instalador.
- No se alteraron datos reales ni se incluyeron bases locales, dependencias, renderer, builds o secretos en Git.
- Se mantienen advertencias de caja cerrada, impresión pendiente, rendiciones, devoluciones, doble impresión y costos desconocidos; no se eliminaron protecciones operativas.
- Impresora física, fallos de disco, cierres abruptos y concurrencia externa quedan fuera de esta validación; aprobar la suite no garantiza ausencia de todo error posible.

## Continuidad y rollback

- Base: `91171f1` (`origin/main`, sin divergencia al preparar la publicación).
- Destino: `https://github.com/Emirexe97/delta-nube-gastronomia.git`, rama `main`.
- Unidad: correcciones de los hallazgos auditados, con sus pruebas y documentación. No usar el script de sincronización de POS Tienda: apunta a otro repositorio y otro paquete.
- Rollback: revertir el commit de esta unidad, preservando el historial y los datos. No revertir la auditoría de pedidos flexibles del commit base ni otros commits ajenos; no requiere migración inversa.
