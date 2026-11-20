# Pedidos y comandas en hora pico

**Escenario local, 20/11/2026.** Electron, SQLite en un perfil descartable, 400 pedidos activos de retiro y delivery, con tres renglones cada uno. No se usaron datos de caja reales.

| Al limpiar una búsqueda que devolvía un solo pedido | Antes | Después |
| --- | ---: | ---: |
| Filas de pedidos montadas al volver al inicio de la lista | 400 | 15 |
| Elementos dentro de la tabla | 8010 | 312 |
| Mediana de entrada a actualización y cálculo de layout | 157,6 ms | 5,4 ms |
| Misma mediana con CPU del renderer ralentizada ×4 | 1163 ms | 40 ms |

Mediana de cinco repeticiones tras una de calentamiento, mismo tamaño de ventana. La cantidad montada varía con la altura disponible y la fila enfocada. La medición termina al actualizarse la tabla y leer su geometría; **no** mide tiempo hasta el píxel en pantalla, hardware físico de gama baja ni latencia mecánica de la impresora.

## Prueba de regresión

Desde la raíz, con las dependencias instaladas:

```sh
pnpm build
pnpm exec playwright test tests/e2e/peak-orders.spec.ts
```

- **Lista:** 400 pedidos navegables con Inicio, Fin y flechas, aunque sólo se montan las filas próximas a la vista. Un cambio de estado en otra terminal simulado por el mismo aviso que usa el POS altera el orden. Se comprueba la identidad del pedido enfocado, cuál abre Enter, adónde vuelve Escape y que el buscador no pierde el foco al filtrar.
- **Comanda:** se simula únicamente el destino de impresión y la respuesta del controlador. El primer intento falla; se cierra y reabre el pedido y se reintenta desde la interfaz. SQLite debe registrar el mismo trabajo y contenido, dos intentos, un solo éxito y un único descuento de stock. El flujo no debe recargar todo el POS.
- **Límite:** un controlador que imprime físicamente pero devuelve error no permite demostrar entrega de papel exactamente una vez. La prueba verifica la cola y el resultado informado por el controlador.
