# Cliente dentro del pedido y cobro progresivo — segunda etapa

Fecha: 2026-11-15. Estado: implementada y validada localmente, sin publicación.

## Alcance y uso

Esta etapa continúa las prioridades 3–4: menos ida y vuelta al completar datos y
menos campos visibles en el cobro común. No modifica contratos financieros,
base de datos, versión, instaladores ni publicación. Preserva la etapa 1 y el
tutorial que ya estaban en el árbol de trabajo.

- En retiro/envío sin pagos, **Cliente y envío** abre el formulario en la columna
  izquierda del mismo pedido. El detalle de productos permanece visible.
- **Guardar datos** vuelve al catálogo sin cambiar el pedido, sus líneas ni la
  búsqueda. **Volver a productos** confirma el descarte si hay cambios sin guardar.
- Mientras se editan datos, las acciones del pedido y F6/F7/F8 no se ejecutan.
  Durante el guardado se bloquea el cierre; un error conserva el formulario.
- Los pedidos ya cobrados conservan el flujo de cambio autorizado con PIN,
  motivo y devolución de diferencias. No se simplifica esa operación sensible.
- El cobro inicia con efectivo —o el primer medio activo— y saldo completo.
  Elegir otro medio asigna el saldo a ese medio, sin cobrar automáticamente.
- **Pago mixto** muestra la grilla de medios y conserva los importes existentes.
  No se colapsa accidentalmente una división. La acción explícita de cargar todo
  a cuenta corriente sí reemplaza la asignación completa.
- Transferencia conserva su referencia opcional. Vuelto, cliente obligatorio
  para cuenta corriente, cobro por repartidor y liquidación de envío mantienen
  las validaciones anteriores.

La creación inicial del pedido conserva el formulario conocido y la opción
**Cargar productos primero**; esta entrega elimina la salida del editor para
completar/cambiar datos, no sustituye todos los puntos de creación del sistema.

## Diseño y protecciones

| Unidad | Archivos | Protección |
| --- | --- | --- |
| Formulario compartido | `components/order-details-form.tsx`, `pages/orders-page.tsx` | Una sola implementación para modal e inline; validaciones, horarios, snapshots, PIN y reembolsos conservados |
| Integración inline | `components/order-editor.tsx` | Mismo orderId; búsqueda y catálogo montados pero ocultos; detalle bloqueado mientras se editan datos; guardas de cierre dirty/pending |
| Cobro progresivo | `components/payment-modal.tsx` | Mismos cálculos y API; bloqueo síncrono contra doble envío; importes inválidos/medios inactivos no se envían |
| Teclado | `packages/ui/src/index.tsx` | Modal excluye `:disabled`, incluyendo controles deshabilitados por un fieldset, del recorrido Tab |

Los formularios se extrajeron de los archivos grandes, no se duplicaron. Cada
mutación de datos captura el ID al enviar; su resultado no se aplica a otro
pedido si cambian las props. No hay auto-retry financiero ni promesa de
idempotencia persistente ante una respuesta IPC perdida.

## Verificación

- `pnpm --filter @gastronomy/web test`: 392/392, 50 archivos.
- `pnpm typecheck`: 11/11 paquetes.
- `pnpm build`: 11/11 paquetes, sin reconstruir SQLite nativo.
- **50 escenarios E2E distintos aprobados**, en pasadas focalizadas:
  - 7 nuevos: 6/6 en la pasada corregida y el séptimo de guardado pendiente
    aprobado en recheck; rechecks adicionales de foco real y monto negativo.
  - 11/11 cliente/cuenta corriente/receptor de cobro de la pasada ampliada.
  - 9/9 modalidad, permisos, diferencias, reembolsos y rendiciones.
  - 3/3 compras/combos/repetición después de actualizar fixtures históricos.
  - 15/15 flujo principal, navegación preservada y carga directa de etapa 1.
  - 5/5 orientación operativa de cobro y caja/repartidor.
  Se usan perfiles/base temporales y Electron oculto; ningún dato real ni
  impresora física. No se ejecutó toda la suite E2E del repositorio.
- Capturas inspeccionadas: panel inline 1366×768 y cobro por un medio; sin
  solapamiento de campos, detalle del pedido visible y acciones identificables.
- `git diff --check`: sin errores de whitespace.
- Evidencia local: `docs/qa/evidence/operational-speed-20261115-stage2/` (ignorada
  por Git). Los logs se conservan, incluidos intentos fallidos si los hubiera.

### Comandos y recibos

| Comando Playwright (`pnpm exec playwright test ...`) | Resultado / log |
| --- | --- |
| `tests/e2e/operational-speed-stage2.spec.ts` | 6/6 en `e2e-new-rerun.log`; séptimo caso y foco 2/2 en `e2e-inline-pending.log`; pagos reforzados 2/2 en `e2e-payment-recheck.log` |
| `tests/e2e/order-flexibility.spec.ts tests/e2e/customer-selector-layout.spec.ts tests/e2e/customer-account-orders.spec.ts tests/e2e/delivery-explicit-collector.spec.ts tests/e2e/operational-improvements.spec.ts` | `e2e-regression.log`: 11 aprobados, 3 fallos de fixtures, 9 no ejecutados por max-failures; todos revalidados abajo |
| `tests/e2e/order-flexibility.spec.ts` | 9/9, `e2e-flexibility.log` |
| `tests/e2e/operational-improvements.spec.ts` | 3/3, `e2e-legacy-recheck.log` |
| `tests/e2e/desktop-flow.spec.ts tests/e2e/quick-product-add.spec.ts tests/e2e/preserved-entry-navigation.spec.ts` | 15/15, `e2e-core.log` |
| `tests/e2e/order-operational-guidance.spec.ts` | 5/5, `e2e-guidance.log` |

`e2e-new.log` retiene el primer intento con supuestos incorrectos de pruebas;
no se eliminó esa evidencia. Los tests se ajustaron a la UI real, confirmaciones
nativas y moneda en pesos, manteniendo expectativas financieras exactas.
En los fixtures históricos se corrigieron selectores de ayudas, la ruta actual
de Combos y el precio base de `priceBook`: copiar el DTO viejo junto a `prices`
nuevos retenía el precio anterior. No se redujo el total esperado del pedido
repetido ni se alteró el código de precios para hacer pasar esa prueba.

El caso de guardado pendiente retiene el IPC antes del commit, comprueba que
Escape no cierra y libera la respuesta; se conservan los IDs de productos. La
prueba de Tab confirma foco antes y después, excluyendo controles deshabilitados
por el fieldset, no sólo que exista algún elemento enfocado.

No se atribuye una mejora de milisegundos a esta etapa sin medir operadores y
flujos completos: el resultado esperado es menos navegación y menos campos
innecesarios, manteniendo validación explícita antes de confirmar.

## Rollback por unidad

1. Inline: retirar integración del editor y volver a invocar `onEditDraft` para
   pedidos sin pagos. El formulario extraído puede seguir siendo modal; no hay
   datos que migrar. Mantener los hunks de carga directa/caché de la etapa 1.
2. Cobro: quitar selección simple/expansión y mostrar siempre la grilla existente,
   conservando cálculos y API. La extracción a archivo propio es independiente.
3. Foco: el filtro `:disabled` es una corrección independiente y conviene
   conservarlo aunque se retire el panel inline.

No revertir archivos completos que contengan cambios del tutorial o etapa 1.

## Fuera de esta etapa

Mejoras del móvil de Comandas, duplicación/importación de catálogo y medición de
percentiles con un operador real. Publicación e instaladores requieren solicitud
explícita.
