# Caja: cobro, historial e informe del turno

## Resultado local

Medianas en Windows con Ryzen 9 7900, Electron 39.8.10 y SQLite en archivos temporales. Se ejecutaron ambas implementaciones sobre copias de la **misma base sintética**. No se midió el tiempo de pintar la pantalla ni se usaron datos de un comercio.

| Flujo | Escenario | Antes | Después |
|---|---|---:|---:|
| Registrar un cobro exacto | 160 ventas cobradas, 161 movimientos del turno y 20.000 movimientos anteriores | 200,39 ms | 1,49 ms |
| Abrir el historial | 25 cierres, 5.000 movimientos; antes se traía todo, ahora se muestran 20 resúmenes por página | 1.475,31 ms | 0,66 ms |
| Obtener el informe | Mismo turno y volumen que el cobro; 160 ventas cobradas y un pedido confirmado pendiente | 484,14 ms | 6,14 ms |

El historial pasó de **1.271.909 a 4.552 bytes de JSON** para la carga inicial. El informe pasó de **2.255 a 12 sentencias preparadas**, con igualdad completa del resultado. Cada operación tuvo un calentamiento; se midieron 11 cobros (con rollback para repetir exactamente el pago) y cinco lecturas de historial/informe por versión. No son objetivos garantizados en una PC de caja.

## Qué preserva cada cambio

- **Cobro.** La migración 53 indexa los movimientos que apuntan a una operación anterior y el orden de los cierres. No cambia ningún importe guardado. Un cobro exacto sin pago inmediato al repartidor no necesita calcular el saldo previo; cuando hay vuelto o pago al repartidor, el saldo se obtiene antes de registrar los ingresos, como antes.
- **Historial.** La pantalla pide una página de cierres, con ventas netas del turno. Los importes respetan devoluciones, vuelto por otro medio y exclusión de pedidos cancelados. El detalle se pide al abrir un cierre. Se conserva el método de historial anterior para consumidores existentes.
- **Informe.** Se leen los pedidos y sus líneas en lotes dentro de una transacción de lectura. Se reutilizan los movimientos, la atribución de pagos al turno y las categorías históricas; no se reemplazan con el catálogo vigente. Una prueba con 1.005 pedidos evita volver a consultar cada pedido por separado.

## Reproducir

Desde la raíz del proyecto, con las dependencias instaladas y SQLite compilado para la ABI de Electron:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  & '.\apps\desktop-shell\node_modules\electron\dist\electron.exe' scripts/benchmark-cash-workflows.cjs | Out-Host
} finally { Remove-Item Env:\ELECTRON_RUN_AS_NODE }
```

Por defecto se mide la versión actual. Para comparar, definir previamente `GASTRONOMY_CASH_BASELINE` con la ruta a una copia CommonJS **de confianza**, compilada antes del cambio y con export `SqliteGastronomyRepository`. El script genera y elimina sus propias bases; no necesita acceso a la caja instalada.

Las pruebas de `packages/database/src/cash-flow-parity.test.ts` verifican el vuelto por otro medio, devoluciones parcial y total, reversión de un ingreso, pedido anulado y arqueo. Incluyen un pedido con reintegro parcial que completa el saldo en el turno siguiente: cada cierre debe contener solo su importe. Con la variable de referencia también se comparan informes filtrados completos, identificadores y vínculos de reversión de la misma base antes y después de migrarla. La navegación entre páginas, apertura del informe y cierre se prueban en `tests/e2e/cash-session-report.spec.ts`.
