# Pedidos flexibles y contabilidad consistente

Fecha: 2026-10-02. Estado: **correcciones implementadas y reauditoría aprobada**.

El pedido conserva su identidad, productos, precios cotizados, stock y horario al cambiar entre retiro y envío. Los cambios posteriores al cobro deben registrar diferencias y contramovimientos, nunca reescribir pagos históricos.

## Recorrido esperado

1. Elegir retiro o envío y empezar por cliente **o por productos**.
2. Autoguardar el borrador; completar identidad y dirección antes de confirmar.
3. Confirmar una sola vez para reservar stock. Imprimir no cobra ni entrega.
4. Cobrar en negocio, cargar deuda a cuenta corriente o cobrar efectivo en puerta según la operación elegida.
5. Cambiar modalidad con vista previa: conservar los precios existentes, recalcular sólo envío, cobrar saldo adicional o devolver el exceso autorizado.
6. Entregar con saldo cubierto y repartidor activo cuando corresponde.

## Correcciones de la auditoría

| ID    | Severidad  | Causa / criterio de cierre                                                                                                                                                                    | Estado     |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| OF-01 | Crítica    | Cancelación por cambio genérico de estado evitaba PIN, devolución y reposición de stock. Sólo debe ejecutarse `cancelOrder`.                                                                  | Verificado |
| OF-02 | Alta       | Seña completa dejaba saldo cero impago y bloqueaba confirmar/entregar. Saldo cubierto por seña no genera un segundo ingreso en caja.                                                          | Verificado |
| OF-03 | Alta       | Reasignar repartidor después de pagarle dejaba pedido y liquidación con distintas identidades. Revertir primero una liquidación rendida; mover una pendiente de forma consistente.            | Verificado |
| OF-04 | Alta       | Cualquier ledger bloqueaba devoluciones. Revertir explícitamente una liquidación rendida y recalcular la pendiente según el importe neto y el servicio prestado, con auditoría.               | Verificado |
| OF-05 | Alta, demo | Efectivo cobrado por repartidor ingresaba a caja antes de la rendición. Debe coincidir con SQLite.                                                                                            | Verificado |
| OF-06 | Funcional  | Identidad obligatoria al crear impedía productos primero. Exigir datos completos al confirmar, no al abrir un borrador.                                                                       | Verificado |
| OF-07 | Funcional  | Tipo inmutable impedía retiro↔envío. Permitir cambios no terminales con ajuste financiero explícito.                                                                                          | Verificado |
| OF-08 | Alta, demo | Una transición podía reabrir pedidos terminales y la reasignación no sincronizaba el ledger pendiente. Se aplican las mismas reglas que SQLite.                                               | Verificado |
| OF-09 | Alta       | La liquidación normal no vinculaba el movimiento al pedido; su reversión fallaba aunque el pago inmediato funcionaba. Se enlazan movimiento, pedido y contramovimiento.                       | Verificado |
| OF-10 | Alta       | La devolución parcial eliminaba la obligación residual y podía reducir el envío ya ganado. Conservar y recalcular el saldo firmado del repartidor.                                            | Verificado |
| OF-11 | Alta       | Un cambio de modalidad podía ocultar una seña superior al nuevo importe. Rechazarlo y exigir ajuste externo previo.                                                                           | Verificado |
| OF-12 | Alta       | La bandera de cobro en puerta admitía medios no efectivos o mezclaba custodios entre cuotas. Validar efectivo, driver y custodio original antes de cobrar.                                    | Verificado |
| OF-13 | Alta, demo | Los modificadores, descuentos o señas podían cambiar un pedido cobrado por API aunque la UI estuviera bloqueada. La guarda de edición normal también protege pagos e historial terminal.      | Verificado |
| OF-14 | Funcional  | Carga rápida de salón abría inmediatamente el editor completo y reseteaba los pasos, dejando inaccesible la carga inline. Continuar con artículos; editor completo mediante acción explícita. | Verificado |
| OF-15 | Funcional  | Alta de mesa desde plano persistía altura 7 y luego fallaba contra mínimo 8. Alinear validación SQLite/demo y límites del editor con el tamaño predeterminado válido.                         | Verificado |
| OF-16 | Paridad    | La edición normal del envío actualizaba tarifa guardada en SQLite pero no en demo. Conservar el flujo histórico en ambos; una conversión de canal sólo modifica la cotización del pedido.     | Verificado |
| QA-01 | Cobertura  | `desktop-flow` tenía selectores antiguos y dependencia entre casos. Aislar fixtures y cubrir las nuevas variantes.                                                                            | Verificado |

## Invariantes financieras

- La seña es un importe recibido previamente que se descuenta del saldo; esta operación no simula un cobro en la caja actual.
- Cobrar a cuenta corriente registra venta y deuda, no efectivo. Cobrar esa deuda después no duplica la venta.
- Una devolución parcial no puede superar el pago neto disponible ni borrar cobros de deuda ya imputados.
- Revertir una liquidación exige PIN, motivo y confirmación de devolución física del dinero. El contramovimiento queda en la caja actual y el registro anterior no desaparece.
- Los pedidos entregados o cancelados conservan su historial y no se reabren mediante un cambio operativo normal.
- Retiro no conserva repartidor ni cargo de envío. Un pedido que estaba en reparto vuelve a listo cuando pasa a retiro.
- El cambio de canal no vuelve a descontar stock ni recalcula silenciosamente precios de productos.
- Una devolución de productos no quita al repartidor el envío de un servicio ya entregado. El saldo residual puede cambiar de «repartidor debe al negocio» a «negocio debe al repartidor»; la liquidación no desaparece mientras exista esa obligación.
- El cobro en puerta requiere envío, repartidor activo, efectivo y vuelto en efectivo. Las cuotas de un mismo pedido conservan el custodio del dinero; no se reclasifica dinero ya cobrado por el negocio como retenido por el repartidor.

## Límites deliberados y recuperación

- Un pedido entregado o cancelado no cambia de modalidad ni se reabre por una transición genérica. Las devoluciones autorizadas conservan el historial.
- La seña externa no se devuelve como si hubiese ingresado en la caja actual. Si supera el importe tras un cambio de modalidad, primero debe ajustarse y registrarse su devolución externa; el cambio rechazado no modifica pedido, stock ni caja.
- Una deuda de cuenta corriente ya cobrada no se borra mediante devolución del cargo: sólo se reduce la parte pendiente, preservando las imputaciones de cobros.
- Las liquidaciones históricas sin vínculo identificable al movimiento original se revierten sólo si la coincidencia es inequívoca. Un lote antiguo ambiguo se bloquea con error, en vez de anular un movimiento ajeno.
- Cambiar precios de productos requiere la acción de precio correspondiente. El cambio retiro↔envío conserva los precios cotizados y sólo ajusta el envío.
- La edición normal del costo de un envío conserva el aprendizaje de tarifa de la dirección guardada. Convertir retiro↔envío no cambia ese valor predeterminado; sólo modifica el pedido.

## Evidencia previa y pruebas

| Capa                                   | Ejecución                                                            | Resultado                                                     |
| -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| SQLite, finanzas, stock e historial    | `pnpm --filter @gastronomy/database test`                            | 121/121 aprobadas                                             |
| Demo, geometría y utilidades web       | `pnpm --filter @gastronomy/web test`                                 | 137/137 aprobadas                                             |
| Dominio y cierre de caja               | `pnpm --filter @gastronomy/domain test`                              | 20/20 aprobadas                                               |
| Formato de comandas programadas        | `node --test apps/desktop-shell/src/scheduled-order-ticket.test.cjs` | 3/3 aprobadas                                                 |
| Tipos de todos los paquetes            | `pnpm typecheck`                                                     | 7/7 paquetes aprobados                                        |
| Compilación de todos los paquetes      | `pnpm build`                                                         | 7/7 paquetes aprobados; aviso informativo de tamaño de bundle |
| Electron completo, perfiles temporales | `pnpm exec playwright test --output=test-results`                    | 77/77 aprobadas                                               |

La cobertura Electron incluye productos antes del cliente, cliente obligatorio al confirmar, cambio retiro↔envío sin perder horario ni stock, diferencia de cobro y devolución autorizada, seña 100 %, cuenta corriente desde Pedidos, liquidación y reversión de repartidor, informe de cierre/ticket, comanda programada a 58 mm y carga rápida por teclado. Se mantienen también los escenarios anteriores de permisos, impresión, compras, clientes, precios y plano.

La auditoría anterior reprodujo OF-01…OF-05 con perfiles Electron temporales y demo en memoria. También rechazó la hipótesis de que `cancelOrder` demo aceptara pagos: el bypass real era `updateOrderStatus(CANCELLED)`. La reauditoría de servicio/IPC detectó además que `completeOrder` seguía exigiendo un medio de pago para pedidos ya cubiertos; se corrigió la capa de aplicación, no sólo el repositorio.

Las pruebas de catálogo conservaron control de stock, niveles, imagen, autorización e historial. El supuesto reinicio del formulario no se reprodujo con la aplicación reconstruida y las comprobaciones de disponibilidad de controles; no se modificó `ProductModal`, que ya inicializa por ID lógico. Las pruebas de figuras conservan ancho y alto persistidos y verifican que el puntero alcance el control visible, evitando atribuir un arrastre fuera del viewport a un fallo de producto.

Resultado final: **358/358 pruebas aprobadas**, incluyendo la regresión Electron completa de 77 escenarios en una sola ejecución (2,2 minutos). La revisión independiente de las invariantes financieras no encontró errores pendientes en el alcance auditado. Se usaron perfiles temporales; no se modificaron datos reales, ni se hicieron commit, push, cambio de versión o instalador. La impresión se verificó mediante tickets, trabajos y vistas previas; no se certificó una impresora física.

## Frontera de rollback

Los hunks de esta unidad están en contratos, aplicación, reglas de pedido, repositorio/demo, formularios de Pedidos/Editor/Repartidores y sus pruebas. Deben conservarse los cambios previos de titularidad del envío, cierre de caja, comandas programadas y cuenta corriente. No revertir archivos completos que contengan cambios anteriores.
