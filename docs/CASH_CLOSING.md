# Cierre y conciliación de caja

El cierre separa tres conceptos que no deben mezclarse:

- **Diferencia de arqueo:** efectivo contado menos efectivo esperado. Si no es
  cero, exige un motivo para auditoría.
- **Efectivo a retirar:** efectivo contado menos cambio final.
- **Variación del cambio:** cambio final menos cambio inicial. Puede ser positiva
  o negativa y no representa por sí misma un faltante o sobrante.

El efectivo esperado se compone del cambio inicial, ventas en efectivo e ingresos,
menos gastos, retiros y devoluciones. Los cobros por otros medios se muestran como
información de conciliación, pero no alteran el cajón.

## Flujo operativo

1. Revisar el desglose del efectivo esperado.
2. Ingresar el efectivo contado.
3. Indicar el cambio final que queda para la próxima apertura.
4. Explicar cualquier diferencia de arqueo.
5. Si hay pedidos pendientes, usar el cierre forzado con motivo y PIN autorizado.
6. Revisar el resumen final y confirmar definitivamente.

El cambio final nunca puede ser negativo ni superar el efectivo contado. Cada
cierre registra el contado, la diferencia, el fondo final, lo retirado y la
variación del fondo en SQLite, auditoría y eventos.
