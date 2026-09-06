# Arquitectura

## Decisión

La aplicación se implementa como monorepo pnpm compatible con Delta Nube POS:

```text
apps/
  gastronomy-web/      React/Vite, sólo UI
  desktop-shell/       Electron main + preload
packages/
  contracts/           DTO serializables e interfaces
  domain/              reglas gastronómicas puras
  application/         casos de uso y coordinación
  database/            SQLite, migraciones y repositorios
  ui/                  tokens y primitivas visuales Delta Nube
docs/
```

## Límites de dependencia

```text
UI -> application/contracts
application -> domain/contracts
database -> domain/contracts
desktop-shell -> application/database/contracts
domain -> nada específico de plataforma
```

`domain` no puede importar React, Electron, SQLite ni APIs web. El renderer no
puede importar módulos Node. Todo acceso al sistema operativo pasa por el bridge
tipado de preload.

## Escrituras críticas

Los casos de uso `payOrder`, `cancelOrder`, `openCashSession`,
`closeCashSession`, `registerCashMovement` y `settleDriver` se ejecutan en una
única transacción SQLite. La auditoría y el evento local se insertan dentro de la
misma transacción.

La impresión ocurre después del commit:

```text
guardar pedido -> registrar print_job -> commit -> imprimir -> marcar resultado
```

## Dinero y tiempo

- Dinero: entero en centavos (`amount_minor`).
- Fechas: UTC ISO para eventos; `business_date` explícito `YYYY-MM-DD`.
- La fecha comercial se fija al abrir caja y no cambia al cruzar medianoche.
- IDs técnicos: UUID; números visibles: secuencias locales separadas.

## Consistencia de pedidos

`Order` y `Sale`/cobro no son equivalentes. Una orden tiene estado operativo y
estado de pago independientes. Cobrar registra pagos y movimiento de caja, pero
no elimina la orden. Toda línea guarda snapshots de producto, precio,
modificadores y mitades.

## Configuración modular

Los flags deshabilitan affordances y rutas, nunca borran datos. Los repositorios
continúan pudiendo leer entidades históricas aunque el módulo esté oculto.

## Integración futura

La aplicación standalone compone adapters locales en `desktop-shell`. En Delta
Nube POS, esa composition root se reemplazará por adapters que deleguen en sus
servicios de catálogo, usuarios, turnos, pagos, impresión, stock y sync.

