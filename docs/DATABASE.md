# Base de datos local

## Motor

`better-sqlite3-multiple-ciphers` dentro de Electron main. El renderer no abre
archivos ni ejecuta SQL.

Pragmas de inicio:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

## Migraciones

Las migraciones viven en `packages/database/src/migrations.ts`, tienen versión
monótona y se registran en `schema_migrations`. Cada migración se aplica dentro
de una transacción antes de crear datos iniciales.

## Entidades implementadas

- `roles`, `permissions`, `role_permissions`, `users`
- `cash_sessions`, `cash_movements`
- `payment_methods`, `payments`, `payment_refunds`
- `categories`, `products`, `price_lists`, `product_prices`
- `modifier_groups`, `modifiers`, `product_modifiers`
- `customers`, `customer_addresses`
- `restaurant_tables`
- `orders`, `order_items`, `order_item_halves`, `order_item_modifiers`
- `delivery_ledger`
- `print_jobs`
- `audit_log`
- `domain_events`

## Invariantes

- Todo importe se guarda como entero en centavos.
- La fecha comercial se copia en la caja al abrirla.
- Un pedido abierto por mesa se protege con índice único parcial.
- Las líneas guardan nombre y precio snapshot.
- Cada dirección de cliente guarda su valor de envío habitual; el pedido
  conserva además su propio snapshot histórico del costo aplicado.
- Los modificadores guardan nombre, precio y alcance snapshot.
- El stock usa milésimas: una unidad completa descuenta `1000` y una mitad `500`.
- Descuentos, ajustes de stock y rendiciones exigen PIN con permiso y auditoría.
- Las líneas conservan también la categoría snapshot para informes históricos.
- Cobro, movimientos, auditoría y evento local comparten transacción.
- Cada devolución referencia el pago original, usa la caja abierta, inserta un
  movimiento `REFUND`, recalcula `paid_minor` y nunca borra el cobro histórico.
- Las operaciones masivas de catálogo validan todos los productos y aplican
  categoría, estado y precios dentro de una única transacción.
- Cancelar cambia estado; no elimina registros.
- La impresión se intenta después del commit.

## Backups

La aplicación utiliza `Database#backup()` y valida cada copia con
`integrity_check`. La restauración crea primero una copia de emergencia, cierra
la conexión, elimina WAL/SHM obsoletos y vuelve a abrir la base restaurada. Ver
`docs/BACKUP_RECOVERY.md`.
