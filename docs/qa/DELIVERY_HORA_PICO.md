# Delivery en hora pico — 20 de noviembre de 2026

## Qué se midió

Electron de escritorio y SQLite local, con un perfil temporal: 400 envíos (200 todavía abiertos), 1.200 líneas, 3.000 productos y 8 repartidores. Se limitó el procesador del **renderer** a 4× usando CDP. La tabla compara la mediana de cinco operaciones después de una de calentamiento, desde el clic hasta el cierre del diálogo y el siguiente cálculo de layout.

| Operación | Antes | Después |
| --- | ---: | ---: |
| Asignar o cambiar repartidor | 324,0 ms | 97,5 ms |
| Entregar un pedido prepago | 289,4 ms | 60,5 ms |
| Cobrar contra entrega y entregar | 302,3 ms | 116,2 ms |
| Volver del filtro por repartidor a todos | 328,6 ms | 22,6 ms |

Antes, cada acción del pedido volvía a transferir el estado completo del POS (aprox. 2,6 MiB en este turno). Después, cada escritura sólo necesitó una lectura puntual de SQLite. Con 212 movimientos en el panel, las filas de datos montadas pasaron de 212 a 14, y los nodos del DOM de la tabla de 3.403 a 237. No es una medición de RAM total ni una garantía de tiempos en el equipo del comercio.

## Cómo comprobar que los resultados no cambian

Con el addon SQLite compilado para la versión de Electron del proyecto, ejecutar desde la raíz:

```sh
pnpm build
pnpm exec playwright test tests/e2e/peak-delivery.spec.ts
```

La prueba usa otro perfil temporal de 400 envíos y 3.000 productos; no toca la caja real. Reasigna una rendición pendiente creada al revertir un pago inmediato de flete, entrega un prepago y registra efectivo cobrado tanto por el negocio como por el repartidor. Reenvía el mismo comando de cobro y compara los pagos, la caja, las ventas y los movimientos con una lectura independiente del repositorio. También compara los totales del panel, incluidos movimientos fuera de pantalla.
