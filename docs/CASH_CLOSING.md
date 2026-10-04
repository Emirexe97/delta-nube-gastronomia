# Cierre y conciliación de caja

El cierre separa estos conceptos que no deben mezclarse:

- **Diferencia de arqueo:** efectivo contado menos efectivo esperado. Si no es
  cero, exige un motivo para auditoría.
- **Efectivo esperado y contado del informe:** totales físicos menos el cambio
  final que queda en caja. El fondo se muestra aparte y no se suma a estos importes.
- **Efectivo a retirar:** total físico contado menos cambio final (igual al contado neto).
- **Variación del cambio:** cambio final menos cambio inicial. Puede ser positiva
  o negativa y no representa por sí misma un faltante o sobrante.

El total físico esperado se compone del cambio inicial, ventas en efectivo e ingresos,
menos gastos, retiros y devoluciones. Para el informe se resta el cambio final.
Los cobros por otros medios se muestran como
información de conciliación, pero no alteran el cajón.

## Flujo operativo

1. Revisar el desglose del efectivo esperado.
2. Ingresar el **Total contado en caja**, incluyendo el cambio que se dejará.
3. Indicar el cambio final que queda para la próxima apertura.
4. Explicar cualquier diferencia de arqueo.
5. Si hay pedidos pendientes, usar el cierre forzado con motivo y PIN autorizado.
6. Revisar el resumen final y confirmar definitivamente.

El cambio final nunca puede ser negativo ni superar el total físico contado. Cada
cierre conserva los totales físicos para conciliación y compatibilidad histórica;
la presentación resta el mismo fondo a esperado y contado, sin cambiar la diferencia.
En cierres antiguos sin fondo final guardado se usa el fondo inicial. Cada cierre registra la diferencia, el fondo final, lo retirado y la
variación del fondo en SQLite, auditoría y eventos.

## Validación — 2026-10-04

- `pnpm --filter @gastronomy/domain test`: 24 pruebas aprobadas, incluyendo fondo
  igual/distinto del inicial, cero, faltante/sobrante y fallback histórico.
- `pnpm typecheck` y `pnpm build`: 7 paquetes aprobados.
- `pnpm exec playwright test`: 79 recorridos aprobados. La regresión verifica
  total físico esperado 6.000 y contado 5.900, cambio final 1.500, informe esperado
  4.500 y contado 4.400, y diferencia -100, en revisión, historial y preview impreso.
- Sin migraciones ni alteración de datos reales; impresión probada cancelando
  la vista previa, sin usar una impresora física.
