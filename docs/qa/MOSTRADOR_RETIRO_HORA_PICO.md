# Mostrador y retiro en hora pico

## Medición local — 20 de noviembre de 2026

Mediana de cinco operaciones después de una de calentamiento, desde el clic hasta que el editor muestra el resultado. Se usó Electron de escritorio con SQLite local, con el proceso de interfaz limitado a ¼ de CPU. El escenario comparativo empezó con 400 retiros (200 activos), 1.200 líneas y 3.000 productos. En esa medición el stock estaba desactivado para repetir en iguales condiciones la línea de base; la prueba funcional de abajo sí exige stock activo.

| Acción | Antes | Después |
| --- | ---: | ---: |
| Sólo cobrar | 299,3 ms | 143,0 ms |
| Retirar un prepago | 272,9 ms | 44,2 ms |
| Cobrar y entregar | 281,3 ms | 128,8 ms |
| Abrir el borrador | 320,4 ms | 70,8 ms |
| Confirmar sin imprimir | 285,8 ms | 35,0 ms |
| Agregar un artículo simple (control) | 50,7 ms | 49,2 ms |

En las mediciones de las cinco operaciones optimizadas desapareció la lectura completa del turno (unos 2.550 KiB al inicio). La simulación terminó con exactamente el mismo efectivo esperado, las mismas ventas y 212 pedidos entregados en ambas versiones. Estos tiempos no son un umbral garantizado para el equipo del comercio.

## Control funcional reproducible

Desde la raíz del proyecto, con SQLite compilado para el Electron de escritorio:

```sh
pnpm build
pnpm exec playwright test tests/e2e/peak-takeaway.spec.ts
```

La prueba abre un perfil temporal con 400 pedidos para retirar, 1.200 líneas y 3.000 productos. La caja tiene fondo inicial y el control de stock está activo. Los pedidos de prueba se crean, confirman y cobran con el repositorio real. Las acciones que se verifican se efectúan desde la pantalla de Pedidos y se contrastan con una lectura independiente de SQLite.

| Operación | Qué se comprueba |
| --- | --- |
| Retirar un prepago | Queda entregado, con los mismos pagos, ventas, efectivo y stock. No se invoca un cobro. |
| Abrir el siguiente pedido | Se abre el editor con foco en el buscador. Cargar el primer producto no reserva stock. |
| Confirmar sin imprimir | Baja una unidad; reenviar el mismo comando no vuelve a descontarla ni genera un trabajo de impresión. |
| Cobrar con efectivo y transferencia | Doble clic: un único comando. La venta neta coincide con el total del pedido. El efectivo esperado sube sólo por el efectivo recibido menos el vuelto. Retirarlo después no mueve caja. |
| Cobrar y entregar | La entrega y el pago quedan registrados una vez, aun si se repite la solicitud con la misma clave. El efectivo visible en Caja coincide con SQLite. |
| Perder la lectura posterior al cobro | El POS vuelve a leer los datos del turno; no reenvía la escritura ni cobra otra vez. |

La prueba cuenta los comandos reales entre el editor y Electron. En los casos normales no hay una recarga completa entre el clic y la actualización de la pantalla. Si una consulta falla, cambia el turno o las revisiones no coinciden, la lectura completa sigue disponible para recuperar el estado.
