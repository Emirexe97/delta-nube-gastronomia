# Auditoría E2E — pagos, catálogo e impresión

Fecha: 2026-08-31

## Alcance corregido

1. Autocompletado por nombre en la carga rápida de Salón.
2. Devolución o anulación de una línea de pago.
3. Operaciones masivas de productos y precios.
4. Perfiles de impresión basados en Delta Nube POS.

## Decisiones de seguridad

- La devolución revierte **todo el saldo de una línea de pago**. No se elimina
  el pago original y no se permite una segunda devolución.
- Se exige una caja abierta, motivo y PIN con `payments.refund`.
- Un envío que ya generó una rendición se bloquea: primero deberá existir una
  anulación explícita de la rendición para no desbalancear al repartidor.
- La operación masiva admite hasta 500 productos y corre en una sola
  transacción. Un precio negativo revierte el lote completo.
- Los modos gráficos de impresión son `SYSTEM_DIALOG` y `SYSTEM_DIRECT`. El
  corte físico queda a cargo del driver de Windows; el perfil conserva su
  intención para un futuro adapter RAW.

## Evidencia automatizada

- Dominio: 9/9.
- Repositorio SQLite: 32/32, incluyendo devolución, lote transaccional y
  snapshot de destino/cantidad de copias.
- Web/demo: 12/12, incluyendo devolución, lote y prueba de impresora simulada.
- Electron E2E: 6/6.
  - Autocompletado inicial alfabético.
  - Navegación con flecha abajo.
  - Selección con `Tab` y clic.
  - Devolución autorizada desde el pedido.
  - Aumento masivo de precios.
  - Persistencia de perfil 58 mm y dos copias.
- `pnpm typecheck`: 7/7 paquetes.
- `pnpm build`: 7/7 paquetes.

## Riesgos externos restantes

- Probar impresión directa, márgenes y corte con el modelo térmico definitivo.
- Definir la anulación contable de rendiciones antes de permitir devolver un
  delivery ya rendido.
- Firma e icono comerciales del instalador.
