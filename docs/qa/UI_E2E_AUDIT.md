# Auditoría visual y funcional E2E

Fecha: 2026-09-01  
Referencia: `DiegoPerez-3/delta-nube-pos` en `e669d4079592b8aa66a76483ceca371167b1930b`.

## Resumen

Se corrigió el defecto de mayor impacto que ocultaba la cabecera y la búsqueda del
editor de pedidos en ventanas bajas. También se restauró la tipografía Inter exacta
del POS de referencia, se alinearon los controles compartidos y se ampliaron los
flujos de mantenimiento de salón y catálogo.

## Hallazgos y correcciones

| ID    | Severidad | Hallazgo                                                                          | Causa                                                                                                               | Corrección / evidencia                                                                                                                                                                                                                                                           |
| ----- | --------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-01 | Alta      | El modal de pedido quedaba recortado debajo de la cabecera; no se veía su inicio. | `.panel-enter` aplica `transform`, creando un bloque de referencia para el descendiente `position: fixed`.          | `Modal` se monta en `document.body` mediante portal, ocupa el viewport y usa cabecera fija/cuerpo desplazable. E2E a 1366×680 comprueba overlay 0,0,1366,680 y diálogo completamente visible.                                                                                    |
| UI-02 | Media     | Tipografía y métricas diferían del POS.                                           | Se declaraba Inter sin empaquetar la fuente y Windows usaba Segoe UI.                                               | Se incluyó `inter-latin-variable.woff2` exacta y se alinearon altura 40 px, texto 13 px, paleta Slate/naranja y estados de foco/deshabilitado.                                                                                                                                   |
| UI-03 | Media     | El modal no confinaba/restauraba foco de forma consistente.                       | El componente inline no administraba ciclo de foco ni bloqueo de scroll.                                            | Focus trap, Escape, restauración, `aria-modal`, etiquetas ARIA y bloqueo del body. El callback de cierre se guarda en ref para no reiniciar el ciclo en cada render del formulario.                                                                                              |
| FN-01 | Media     | Una mesa nueva no permitía elegir responsable.                                    | `createOrder` siempre utilizaba el usuario operativo predeterminado.                                                | Selector explícito de usuario activo con rol Mozo/Supervisor/Administrador, validación en SQLite y persistencia en pedido/mesa. Cubierto por integración y E2E.                                                                                                                  |
| FN-02 | Media     | No había edición visual de producto/precios ni historial.                         | Solo existía alta de catálogo.                                                                                      | Edición autorizada con motivo/PIN, tres listas, categoría/código/estado e historial reciente desde auditoría. Cubierto por integración y E2E.                                                                                                                                    |
| FN-03 | Media     | Las tarjetas exigían demasiados clics para la carga repetitiva.                   | Salón no tenía una vía secuencial por teclado ni números cortos de personal.                                        | Panel Mesa → Número/Nombre de mozo con `Tab` → Productos con `Enter`, creación idempotente, personal sincronizado y código/ID/nombre/precio dinámicos.                                                                                                                           |
| FN-04 | Alta      | El precio de una línea de mesa no podía ajustarse durante la carga.               | La carga rápida mostraba el precio de salón como solo lectura.                                                      | Precio editable con confirmación por PIN y permiso `orders.override_price`; el ajuste queda en el snapshot y auditoría de la línea, sin cambiar catálogo. “Volver sin modificar” restaura el precio de lista y conserva la carga. E2E cubre retorno, PIN erróneo y autorización. |
| FN-05 | Media     | Clientes aparecía vacío sin búsqueda y ocultaba información útil.                 | La pantalla descartaba el resultado cuando el término diferido estaba vacío, aunque el repositorio admitía listar.  | Directorio alfabético inicial, búsqueda por nombre/teléfono/dirección/referencia, edición completa, direcciones principal/alternativas, notas, métricas e historial resumido. E2E comprueba la vista sin filtro.                                                                 |
| FN-06 | Alta      | Después de crear un borrador de envío no se podía volver a los datos del cliente. | El editor de productos no exponía la edición de metadatos del borrador y el costo de envío solo vivía en el pedido. | Acción “Volver a datos del cliente y envío”; permite corregir cliente, dirección, repartidor, hora, notas y costo sin perder líneas. Cada dirección conserva su valor habitual y cualquier cambio desde el pedido se guarda atómicamente en la dirección seleccionada.           |

## Evidencia automatizada

- `pnpm --filter @gastronomy/database test`: 39/39 integraciones SQLite.
- `pnpm --filter @gastronomy/web test`: 19/19 pruebas web/demo.
- `pnpm test:e2e`: 7/7 viajes Electron.
- El primer viaje E2E ejecuta el editor de pedido a 1366×680 y verifica que la
  búsqueda sea visible.
- Los viajes nuevos verifican asignación de mozo, edición auditada de precios y
  carga rápida bidireccional por código/nombre, precio manual autorizado y
  directorio de clientes sin filtro.

## Riesgos fuera del entorno automatizable

- Impresora térmica física, cajón y comportamiento específico del driver.
- Firma comercial e icono definitivo del instalador.
- Integración final con sesión/roles del POS anfitrión; no corresponde agregar
  login independiente en el módulo local.
