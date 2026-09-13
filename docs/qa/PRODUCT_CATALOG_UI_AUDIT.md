# Auditoría UI Productos/Catálogo (solo lectura)

## Archivos/componentes exactos
- `apps/gastronomy-web/src/pages/catalog-page.tsx`: página `/catalogo`; tabla de productos (líneas ~260-370), tabs categorías/modificadores y acciones. `ProductModal` líneas ~1308-1725; `StockModal` ~1776-1908; el click sobre Stock abre ajuste (`setStockProduct`, ~332), Editar abre ProductModal (~350).
- `packages/contracts/src/index.ts`: `ProductDto` (~113-124) solo tiene `stockMinor`; `UpdateProductInput` (~649-666) no incluye stock ni foto; API `createProduct` (~852-861) acepta `stockMinor`, `updateProduct`, `adjustStock` (~869-875) acepta existencia absoluta + motivo/PIN.
- `packages/application/src/index.ts`: fachada create/update/adjust (~671-768), sin campos de foto/umbrales.
- `apps/desktop-shell/src/preload.ts`: bridge expone createProduct/updateProduct/adjustStock (~45-49); `apps/desktop-shell/src/main.ts` registra handlers (~379-383).
- `packages/database/src/migrations.ts`: products tabla (~103-115) solo `stock_minor` (no objetivo/mínimo/crítico/foto); repo create/update/adjust en `packages/database/src/sqlite-repository.ts` (~4025+, 4096+, 4316+).

## Estado vs pedido
- Alta: permite Stock inicial opcional con hasta 3 decimales, persistido como milésimas. Edición NO permite cambiar stock en ProductModal; se usa modal separado de “Ajustar stock”.
- No existen campos stock objetivo, mínimo ni crítico en DTO, contratos, DB o UI.
- No existe foto/selector de archivo, ni pipeline de conversión WebP, ni campo de imagen en producto.
- Ajuste de inventario sí está accesible desde Productos: botón textual stock en tabla abre `StockModal`, exige nueva existencia, motivo y PIN; no ofrece historial dedicado allí (solo historial PRODUCT_UPDATED en edición).

## Convenciones visuales/a11y observadas
- Tailwind, `Card`, `Modal`, `Field`, `Input`, `Select`, `Button`, `Badge`; tablas con clase `dn-table`; paleta slate/brand y modales `max-w-3xl`.
- Labels se centralizan via `Field`; errores `role=alert`, estados async “Guardando…”, foco automático en primer campo; controles de tabla tienen aria-label y botones focus-ring.
- Navegación Enter/Shift+Enter global en `apps/gastronomy-web/src/hooks/use-enter-navigation.ts`; inputs file están explícitamente excluidos, por lo que un uploader deberá manejar Tab/Enter sin romper el hook.
- Tabla tiene `min-w-[640px]` + overflow horizontal; mantener compactación con grilla responsive sm.

## Tests relacionados
- `tests/e2e/form-keyboard-navigation.spec.ts` valida alta/edición y Enter/Shift+Enter.
- `tests/e2e/visual-harmony.spec.ts` valida geometría/armonía de ProductModal.
- `tests/e2e/desktop-flow.spec.ts` (~280+) valida edición/precios/autorización e historial.
- `tests/e2e/quick-entry-navigation.spec.ts` y `tests/e2e/desktop-flow.spec.ts` cubren uso de productos en operación; `packages/database/src/sqlite-repository.test.ts` (~373 create, ~1060 adjust, ~1944 update) cubre persistencia/stock.
- No hay tests de fotos/WebP, umbrales objetivo/mínimo/crítico, ni flujo de ajuste desde tabla a nivel E2E específico.

## Propuesta UI compacta (para implementación posterior)
1. En ProductModal, agregar sección “Inventario” en grilla `sm:grid-cols-4`: Stock actual, Objetivo, Mínimo, Crítico (unidades decimales; helper “hasta 3 decimales”). En edición, stock actual puede ser readonly + botón “Ajustar” o editable como ajuste transaccional; no mezclar update de datos con ajuste auditado.
2. Agregar sección “Foto” compacta: `<input type=file accept="image/*">`, preview 64–80px, quitar/reemplazar, texto “Se convierte a WebP automáticamente”. El renderer puede enviar Blob/ArrayBuffer/base64 al bridge; conversión debe ser programa (preferentemente backend/Node con sharp o canvas controlado) y guardar ruta/bytes WebP. Validar tamaño/tipo, alt/nombre accesible.
3. En fila de tabla mostrar stock actual y estado calculado (Crítico/Mínimo/OK) con `Badge`; dejar acción textual existente “Ajustar stock” y botón editar. Evitar icon-only.
4. Ajuste modal: mostrar actual + objetivo/mínimo/crítico, permitir nueva existencia, motivo/PIN; tras éxito invalidar/refrescar bootstrap para que la tabla no quede obsoleta.
5. Contratos/DB deben añadir `stock_target_minor`, `stock_min_minor`, `stock_critical_minor`, `image_webp`/`image_path` (decidir bytes vs archivo según tamaño), y ProductDto. Update sólo metadatos/umbrales; adjustStock sólo existencia.

## Recomendación de archivos a tocar
`apps/gastronomy-web/src/pages/catalog-page.tsx`, `packages/contracts/src/index.ts`, `packages/application/src/index.ts`, `apps/desktop-shell/src/preload.ts`, `apps/desktop-shell/src/main.ts`, `packages/database/src/migrations.ts`, `packages/database/src/sqlite-repository.ts`, tests E2E de catálogo + `packages/database/src/sqlite-repository.test.ts`; añadir módulo de conversión WebP en shell/application según elección de persistencia.
