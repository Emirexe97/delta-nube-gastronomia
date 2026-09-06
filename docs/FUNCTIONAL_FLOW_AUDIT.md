# Auditoría integral de flujos funcionales

Fecha de revisión: 2026-08-31  
Estado: correcciones críticas implementadas y verificadas.

## Resumen ejecutivo

La auditoría confirmó que el modelo anterior permitía crear directamente pedidos operativos vacíos, imprimirlos y alcanzar estados incompatibles sin validar tipo, productos o pago. Las reglas estaban repartidas entre React y métodos independientes.

La corrección introduce tres principios:

1. **Borrador y operación son etapas distintas.** Un pedido nace como borrador, no afecta stock ni ventas y puede descartarse físicamente.
2. **Las invariantes se ejecutan en dominio y repositorio.** La UI orienta, pero una llamada directa tampoco puede evadirlas.
3. **Cobrar y finalizar es una sola transacción.** `completeOrder` registra el pago y luego entrega/cierra; cualquier error revierte toda la operación.

## Hallazgos y correcciones

| ID    | Riesgo anterior                                            | Severidad | Corrección                                                                                                         |
| ----- | ---------------------------------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------ |
| FF-01 | Pedido vacío creado como `IN_PREPARATION`                  |      Alta | Nuevo `lifecycle_status`: `DRAFT` / `CONFIRMED`.                                                                   |
| FF-02 | Entrega, cobro o impresión de pedidos vacíos               |   Crítica | Guardas centrales `guardOrderAction`, `assertOrderAction` y validación persistente.                                |
| FF-03 | Para retirar impago podía marcarse entregado               |   Crítica | `DELIVERED` exige pago; la UI abre **Cobrar y entregar**.                                                          |
| FF-04 | Cierre de mesa y cobro eran operaciones separadas          |   Crítica | **Cobrar y cerrar mesa** usa una transacción única.                                                                |
| FF-05 | Efectivo cobrado por repartidor podía confundirse con caja |   Crítica | `collected_by_driver`; el pedido queda pagado y la rendición pendiente sin sumar efectivo a caja hasta liquidarla. |
| FF-06 | Rendición podía no reflejar movimiento de caja             |      Alta | Liquidar genera ingreso/gasto de caja dentro de la misma transacción.                                              |
| FF-07 | Última línea podía eliminarse de un pedido confirmado      |      Alta | Se bloquea; debe cancelarse el pedido confirmado o descartarse si todavía es borrador.                             |
| FF-08 | Pedido pagado podía editarse y alterar el saldo histórico  |   Crítica | Edición normal bloqueada desde el primer pago.                                                                     |
| FF-09 | Stock se descontaba durante una carga abandonada           |      Alta | El stock se reserva al confirmar; descartar borrador no lo modifica.                                               |
| FF-10 | Reducción de mesas podía poner en riesgo mesas abiertas    |      Alta | Ajuste 1…N desactiva sólo mesas libres; las ocupadas se preservan y nunca se borran.                               |
| FF-11 | Acciones de auditoría y estados técnicos llegaban a UI     |     Media | Traducciones centrales; enums internos permanecen estables.                                                        |
| FF-12 | El violeta no se alineaba con el contexto gastronómico     |      Baja | Paleta principal naranja, con ámbar para alertas y verde para éxito.                                               |

## Reglas del pedido

### Borrador

- Puede estar vacío y editarse libremente.
- No puede cobrarse, entregarse ni imprimirse.
- No reserva stock, no aparece como venta y puede descartarse.
- Confirmar exige productos válidos, total positivo y los datos mínimos del canal.

### Confirmado

- Conserva siempre al menos una línea.
- Puede imprimirse; imprimir cuenta no cobra ni cierra mesa.
- No puede editarse después de registrar pagos.
- No puede cancelarse con pagos: primero deben devolverse las líneas activas mediante el flujo explícito y auditado.
- `DELIVERED` exige `PAID` para todos los canales normales.

### Envío

- Confirmar exige dirección e identificación suficiente del cliente.
- `OUT_FOR_DELIVERY` sólo es válido para envíos.
- Transferencia anticipada: queda `PAID`; al entregar se genera la deuda del costo de envío al repartidor.
- El cliente se puede buscar o crear dentro del alta de para retirar/envío; la búsqueda espera 1 segundo y permite flechas, `Tab`, `Enter` o clic.
- El repartidor no posee login, pantalla ni PIN propio: es una identidad operativa para asignación, ganancias y rendiciones visibles por caja.
- Efectivo en puerta: **Cobrar y entregar** deja `DELIVERED + PAID + rendición PENDING`.
- La acción **Cobrar y entregar** no permite mezclar efectivo en puerta con medios anticipados: el modelo de rendición exige elegir una de las dos modalidades.
- No se habilitó “entregar con pago pendiente”: la vía excepcional queda deliberadamente fuera hasta definir permiso y devolución/deuda.

## Matriz de transiciones

| Tipo                | Estado actual            | Acción              | Resultado                                | Condición                         |
| ------------------- | ------------------------ | ------------------- | ---------------------------------------- | --------------------------------- |
| Todos               | Borrador vacío           | Descartar           | Eliminado                                | Siempre permitido                 |
| Todos               | Borrador                 | Confirmar           | Confirmado / En preparación              | Al menos una línea y total válido |
| Salón               | Borrador                 | Confirmar           | Mesa abierta                             | Mesa válida                       |
| Envío               | Borrador                 | Confirmar           | En preparación                           | Cliente identificable + dirección |
| Todos               | Confirmado vacío         | Cualquier operación | Bloqueado                                | Invariante permanente             |
| Para retirar        | Impago                   | Entregar            | Abre cobro                               | No entrega directamente           |
| Para retirar        | Pagado                   | Entregar            | Entregado                                | Pedido confirmado y válido        |
| Envío transferido   | Pagado                   | Entregar            | Entregado + rendición pendiente          | Repartidor asignado               |
| Envío efectivo      | Impago                   | Cobrar y entregar   | Entregado + pagado + rendición pendiente | Operación atómica                 |
| Salón               | Mesa abierta impaga      | Cerrar mesa         | Cobrar y cerrar                          | Operación atómica                 |
| Salón               | Mesa abierta             | Imprimir cuenta     | Mesa continúa abierta                    | Tiene productos                   |
| Confirmado          | Sin pagos                | Cancelar            | Cancelado                                | Motivo + PIN                      |
| Confirmado          | Con pagos                | Cancelar            | Bloqueado                                | Requiere devolver los pagos       |
| Confirmado/terminal | Pago activo              | Devolver pago       | Impago o pago parcial + contramovimiento | Motivo, PIN y caja abierta        |
| Entregado/cancelado | Entregar/editar/cancelar | Bloqueado           | Sin cambios                              | Estado terminal                   |

## Administración de mesas

- `Configuración → Salón y mesas` permite generar 1…N, editar número, nombre y orden, y activar/desactivar.
- El ID interno es independiente del número visible.
- Los números se validan como únicos.
- Una mesa ocupada no puede desactivarse.
- Reducir la cantidad conserva mesas ocupadas y registros históricos; las libres fuera del rango sólo se desactivan.
- La carga rápida puede reactivar o crear una mesa inexistente.

## Atomicidad e idempotencia

- SQLite envuelve confirmación, reserva de stock, cobro, entrega/cierre y rendición en transacciones.
- Un segundo cobro falla porque el saldo ya es cero.
- Una segunda entrega falla por estado terminal.
- Una segunda rendición falla porque ya no está pendiente.
- La cola de reimpresión reutiliza el trabajo fallido existente.

## Cobertura verificada

- Borrador vacío descartable.
- Confirmación, impresión, cobro y entrega vacíos bloqueados.
- Para retirar impago no entregable directamente.
- Envío cobrado en puerta pagado con rendición pendiente.
- Cancelación con pagos bloqueada.
- Terminales no repetibles.
- Impresión de cuenta mantiene mesa abierta.
- Cobro y cierre de mesa atómico.
- Stock reservado al confirmar y restituido al cancelar.
- Rendición no duplicable.
- Reducción segura de mesas.

## Decisiones deliberadas

- Los códigos internos (`UNPAID`, `TAKEAWAY`, etc.) no se migran: la traducción pertenece a presentación, impresión y exportación.
- No se implementa login paralelo; la integración futura reutilizará la identidad del POS.
- No se permite entrega con deuda del cliente por defecto.
- La devolución total por línea de pago ya está implementada. Los envíos que
  generaron una rendición permanecen bloqueados hasta incorporar una anulación
  explícita del asiento del repartidor.
