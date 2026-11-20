# Comandas y alta rápida de catálogo — tercera etapa

Fecha: 2026-11-15. Estado: implementada y validada localmente, sin publicación.

## Alcance y uso

Continúa las prioridades 5–6 de rapidez operativa. No cambia base de datos,
contratos, permisos, reglas de cobro, versión ni distribución.

### Comandas móvil

- **+** agrega una unidad entera directamente, también para pizzas que admiten
  mitades. No abre un diálogo para el caso común.
- **Nota** personaliza una unidad pendiente existente, sin sumarla de nuevo.
  Si aún no hay unidades, permite agregar una con nota.
- **Mitad y mitad** abre explícitamente la selección de otra pizza y su nota.
  Sólo aparece con la función habilitada y otra pizza elegible disponible.
- El menú muestra inicialmente hasta **100 productos**; **Mostrar más** amplía
  en bloques de 100. La búsqueda sigue recorriendo **todo** el catálogo y todas
  las categorías, aunque los resultados aún no estén dibujados.
- El índice y filtro se reutilizan al cambiar cantidades. Un menú recibido
  nuevamente invalida el índice; contenido idéntico conserva nodos del catálogo.
- Los envíos pendientes bloquean agregado, notas y mitades. No se modifica el
  protocolo de borrador local, recibos, reintentos ni identificación de tandas.

### Catálogo de escritorio

- En la ficha de un producto base simple, **Duplicar producto** abre un alta
  revisable: nombre con «(copia)», categoría, precios y excepciones por lista,
  imagen y niveles de inventario. No guarda hasta confirmar.
- El nuevo producto tiene código vacío y existencia **cero**, o sin control si
  así estaba el original. No se copian IDs, recetas, costos, historial ni combos.
  El producto nuevo queda activo, como cualquier alta normal.
- La duplicación no se ofrece para variantes, combos o bases con variantes.
- **Guardar y crear otro** guarda el alta y prepara un formulario vacío en la
  misma categoría, con foco en Nombre. El control de stock vuelve a la política
  de esa categoría; precios, imagen, código y cantidades no se arrastran.
- Las altas modificadas confirman descarte. Mientras se guarda se bloquean los
  campos y el cierre; ante error el borrador permanece. La intención «cerrar» o
  «crear otro» se captura en cada envío para no conservar una acción fallida.

## Evidencia y límites

La prueba del menú de 1.001 productos mostró **1.000 filas** de la categoría en
el build anterior (RED) y **100 inicialmente** con esta entrega. La búsqueda
encuentra el producto 999 y un café de otra categoría, conserva notas y responde
a cambios del menú. Esto prueba menor trabajo inicial de DOM, **no** una mejora
medida de latencia, P50/P95 o rendimiento de teléfonos físicos.

Los E2E de interfaz móvil usan Chromium táctil y RPC simulados explícitos; las
regresiones de emparejamiento/circuito cubren además la integración existente.
Los E2E de catálogo usan Electron y perfiles temporales aislados. Los errores
IPC se inyectan antes de persistir; no se promete idempotencia persistente para
un alta cuya respuesta se pierda después del commit.

La importación masiva sigue pendiente de diseño: formato, claves de identidad,
actualización frente a alta, previsualización, validación por filas y stock.
No se publicó Comandas: para ver los cambios en teléfonos de producción será
necesario un despliegue autorizado posterior.

## Validación

Evidencia local (ignorada por Git):
`docs/qa/evidence/operational-speed-20261115-stage3/`.

- `e2e-mobile-red.log`: baseline de 1.000 filas frente a límite esperado de 100.
- `e2e-mobile-final.log`: **10/10** focalizados. Incluye tres nuevos: menú grande,
  pizza sin alternativa/función deshabilitada, y controles bloqueados por envío
  pendiente. Primera corrida (`e2e-mobile.log`): 9 aprobados y un fixture de recibo
  pendiente sin `requestId`; corregido en `e2e-mobile-recheck.log` (3/3).
- `e2e-mobile-regression.log`: **13/13**, incluye circuito Electron/QR,
  emparejamiento, PIN, reconexión, foco, cierre de caja, impresión y revocación.
- `e2e-catalog.log`: **5/5 nuevos**. Copia revisable/stock cero, política de
  categoría al crear otro, dirty/discard, exclusiones y copia sin stock, error
  recuperable/doble envío/cierre bloqueado. Fixture de imagen corregido a WebP,
  que es el formato aceptado por la aplicación; no se cambió esa validación.
- `e2e-regression.log`: 20 aprobados, tres fallos y dos sin ejecutar. Los fallos
  provenían del mock antiguo de arranque de `catalog-search` y dos intentos de
  abrir pestañas inexistentes en creación en `stock-control-toggle`; la prueba
  de stock siguiente dependía del producto que no llegó a crearse.
  Revalidaciones: `e2e-search-verified.log` **1/1** y `e2e-stock-final.log` **4/4**.
  Son **25 escenarios distintos** de regresión desktop aprobados en conjunto.
  El teardown de stock ahora destruye las ventanas del perfil temporal para no
  esperar un diálogo de descarte si una aserción falla.
- `web-tests.log`: `pnpm --filter @gastronomy/web test`, 392/392.
- `orders-tests-final.log`: `pnpm --filter @gastronomy/orders-service test`, 54/54.
- `gates-final.log`: `pnpm typecheck` y `pnpm build`, 11/11 paquetes cada uno.
- Total: **53 E2E distintos**, 392 unitarias web y 54 pruebas de servicio.
  No es la suite E2E integral de todo el repositorio.

Comandos de E2E usados (sin `test:e2e` ni reconstrucción nativa):

```powershell
pnpm exec playwright test tests/e2e/waiter-quick-entry.spec.ts tests/e2e/waiter-mobile-half-and-half.spec.ts tests/e2e/waiter-mobile-search.spec.ts tests/e2e/waiter-simple-product-note.spec.ts tests/e2e/waiter-rendering-performance.spec.ts tests/e2e/waiter-table-number-and-pizza-search.spec.ts
pnpm exec playwright test tests/e2e/waiter-table-workflow.spec.ts tests/e2e/waiter-reconnect-session.spec.ts tests/e2e/waiter-pin-submit.spec.ts tests/e2e/waiter-enrollment.spec.ts tests/e2e/waiter-focus-recovery.spec.ts tests/e2e/waiter-mobile.spec.ts
pnpm exec playwright test tests/e2e/catalog-quick-entry.spec.ts
pnpm exec playwright test tests/e2e/catalog-product-tabs.spec.ts tests/e2e/catalog-variants-combos.spec.ts tests/e2e/catalog-search.spec.ts tests/e2e/stock-control-toggle.spec.ts tests/e2e/form-keyboard-navigation.spec.ts tests/e2e/operational-speed-stage2.spec.ts tests/e2e/quick-product-add.spec.ts --max-failures=3
pnpm exec playwright test tests/e2e/catalog-search.spec.ts
pnpm exec playwright test tests/e2e/stock-control-toggle.spec.ts --max-failures=1
git diff --check
```

Cada ejecución agrega `--output` bajo el directorio de evidencia indicado.
Capturas revisadas: acciones de pizza a 320 px (`mobile-final`), catálogo móvil
con borrador (`mobile-results`), copia de producto y formulario reiniciado
(`catalog-results`). El diseño de pizza usa una fila de acciones debajo del
nombre para evitar tres botones apilados en teléfonos pequeños.

## Unidades independientes y reversión

1. **Comandas**: cambios en `apps/orders-service/src/waiter-page.ts`, sus pruebas
   `test/waiter-page.test.mjs`, nueva `tests/e2e/waiter-quick-entry.spec.ts` y
   ajustes de entrada en las pruebas de búsqueda/mitades. Revertir la unidad de
   UI y sus expectativas conjuntamente; no requiere migración de datos.
2. **Catálogo**: cambios de esta etapa en
   `apps/gastronomy-web/src/pages/catalog-page.tsx` y nueva
   `tests/e2e/catalog-quick-entry.spec.ts`. Quitar los puntos de alta rápida no
   elimina productos ya creados ni debe revertir stock o precios persistidos.

No revertir las etapas 1–2 ni el tutorial concurrente. No se creó commit,
publicación, instalador ni cambio de versión.
