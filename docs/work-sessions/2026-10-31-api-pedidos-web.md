# 2026-10-31 — API común de pedidos web

## Autor / sesión

- Emir / Codex. Publicación autorizada mediante pedido de commit y push.
- Repositorio: Emirexe97/delta-nube-gastronomia, rama main.

## Objetivo y cambios

Preparar el ingreso común de pedidos de distintas webs sin modificar la caja ni aceptar ventas automáticamente.

- `packages/web-orders`: contrato, validación y cliente backend reutilizable.
- `apps/orders-service`: HTTP y SQLite durable independiente; envío idempotente, listado por cursor y acuse técnico.
- Aislamiento por comercio/sitio y credenciales separadas de envío/recepción. Sin tokens públicos en el navegador.
- WhatsApp se devuelve como enlace; no se envían mensajes automáticamente.
- README, lockfile y guía `docs/WEB_ORDERS_API.md` acompañan la implementación.

## Verificaciones

- `pnpm --filter @gastronomy/web-orders test`: 6/6.
- `pnpm --filter @gastronomy/orders-service test`: 11/11, incluyendo HTTP real y persistencia sobre DB temporal.
- `pnpm typecheck` y `pnpm build`: 11/11 paquetes; última ejecución reutiliza caché del mismo código validado.
- No se incluyen secretos, bases reales, dependencias instaladas ni builds en Git.

## Riesgos y pendientes

- Requiere Node >=22.13; el runtime actual avisa que node:sqlite es experimental.
- No incluye conector/bandeja del POS, aceptación, pagos ni despliegue. Precios recibidos son cotizaciones no verificadas.
- Rollback independiente: revertir esta unidad completa, incluidos sus importers del lockfile y documentación.
- No se modifica versión, no se generan instaladores ni se configura producción.
