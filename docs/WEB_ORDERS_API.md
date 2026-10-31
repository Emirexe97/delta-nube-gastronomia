# API de pedidos web (v1)

Guía para integrar un checkout web con el servicio común de pedidos. La web crea una solicitud pendiente, recibe un enlace de WhatsApp precompletado y el cliente decide si lo abre. **No hay envío automático de mensajes ni aceptación/venta**.

> Alcance actual: API backend-to-backend y cliente reutilizable. No incluye bandeja en POS, polling/bandeja de aplicación, conector automático, pago, aceptación/rechazo ni despliegue/configuración productiva.

## Requisitos y puesta en marcha

- Node.js **>=22.13** (usa `node:sqlite`); pnpm del workspace.
- El servicio tiene base SQLite durable propia en modo WAL. No comparte ni modifica la base de licencias ni la del POS.
- `WEB_ORDERS_DB_PATH` y `WEB_ORDERS_CONFIG_FILE` son **rutas absolutas**. `PORT` predeterminado `8098`; `HOST` predeterminado `127.0.0.1`.
- La configuración JSON contiene tokens en forma de hashes SHA-256 hexadecimales de 64 caracteres. Los valores a continuación son marcadores no válidos: reemplazarlos por hashes calculados para tokens aleatorios.

```json
{
  "stores": [
    {
      "id": "local-01",
      "whatsappNumber": "5491123456789",
      "receiveTokenHash": "<sha256-hex-del-token-de-recepcion>",
      "sites": [
        {
          "id": "sitio-principal",
          "submitTokenHash": "<sha256-hex-del-token-de-envio>"
        }
      ]
    }
  ]
}
```

Generar un token aleatorio de 32 bytes y su hash (guardar el token original únicamente en el backend que lo usará y el hash en el archivo protegido):

```sh
node -e "const c=require('node:crypto');const t=c.randomBytes(32).toString('base64url');console.log('token='+t);console.log('sha256='+c.createHash('sha256').update(t).digest('hex'))"
```

Ejemplo de variables en PowerShell; adaptar rutas y secretos fuera del repositorio:

Crear primero el directorio de datos con permisos mínimos para la cuenta del servicio. Generar dos tokens distintos (envío y recepción), sin reutilizarlos entre comercios ni con el sistema de licencias. La configuración permite varios sitios por comercio; se aplica al arrancar/reiniciar el servicio.

```powershell
$env:WEB_ORDERS_DB_PATH = 'C:\ProgramData\DeltaNube\web-orders.sqlite'
$env:WEB_ORDERS_CONFIG_FILE = 'C:\ProgramData\DeltaNube\web-orders.json'
$env:HOST = '127.0.0.1'
$env:PORT = '8098'
pnpm --filter @gastronomy/orders-service start
```

Comandos focalizados disponibles (no implican que se hayan ejecutado al escribir esta guía):

```sh
pnpm --filter @gastronomy/web-orders build
pnpm --filter @gastronomy/orders-service build
pnpm --filter @gastronomy/web-orders typecheck
pnpm --filter @gastronomy/orders-service typecheck
pnpm --filter @gastronomy/web-orders test
pnpm --filter @gastronomy/orders-service test
```

## Seguridad y límites del navegador

- **Nunca** incluir tokens en JavaScript público, HTML, almacenamiento del navegador ni llamadas directas desde browser. `WebOrdersClient` está diseñado para backend del sitio o proceso principal POS, no para browser.
- El sitio estático necesita un backend/proxy propio same-origin: validar sesión/checkout, CAPTCHA o control equivalente, límites de frecuencia y allowlist server-side que asocie la tienda permitida. Ese backend guarda y usa su token submit. No confiar en un `storeId` enviado por el usuario.
- `Origin` presente se rechaza con **403** y no se emiten cabeceras CORS; no es una API browser-facing. En proxy, limitar tráfico y tamaño; el servicio limita cuerpos a 64 KiB, requests/timeouts y frecuencia en memoria. `X-Forwarded-For` no se usa como IP confiable por defecto; no habilitar confianza implícita en ese encabezado.
- La identidad de tienda (y sitio para submit) se deriva del bearer autenticado, nunca del JSON. El token de submit está limitado a un sitio; el de receive está limitado a listar/acuse de toda su tienda. Son credenciales separadas.
- Los pedidos contienen PII (nombre, teléfono, dirección y notas). Restringir permisos del sistema operativo sobre configuración y DB/WAL, limitar acceso operativo, definir retención/borrado y proteger backups. Usar TLS externo si se expone fuera de loopback.
- SQLite está pensado para una sola instancia y almacenamiento local fiable; no colocar DB/WAL en filesystem de red ni arrancar varias réplicas contra el mismo archivo.

## Crear solicitud: `POST /v1/web-orders`

Autenticación: `Authorization: Bearer <token-submit-del-sitio>`. Requiere `Content-Type: application/json` y `Idempotency-Key` de 16–128 caracteres `[A-Za-z0-9_-]`.

```json
{
  "schemaVersion": 1,
  "currency": "ARS",
  "customer": { "name": "Ana Pérez", "phone": "+54 9 11 2345-6789" },
  "fulfillment": { "type": "DELIVERY", "address": "Av. Corrientes 1234, CABA" },
  "items": [
    {
      "productRef": "pizza.muzza",
      "name": "Pizza muzzarella",
      "quantity": 2,
      "unitPriceMinor": 1250000,
      "options": [{ "group": "Tamaño", "name": "Grande" }],
      "notes": "Una sin aceitunas"
    }
  ],
  "deliveryFeeMinor": 150000,
  "paymentMethod": "TRANSFER",
  "notes": "Tocar timbre 4B",
  "requestedFor": "2026-10-30T20:30:00.000Z"
}
```

Importes son enteros en centavos de ARS (`1250000` = ARS 12.500,00). `productRef` y precios provienen del checkout y son una **cotización no autoritativa**: el POS/negocio debe mapear referencias al catálogo y confirmar disponibilidad, precio y total. Las opciones son snapshots informativos; no se autointerpretan como modificadores, mitad/mitad o combos. No se adjuntan comprobantes ni se verifica pago.

Campos requeridos: `schemaVersion: 1`, `currency: "ARS"`, `customer {name, phone}`, `fulfillment {type}`, `items` no vacío, `deliveryFeeMinor`, `paymentMethod`. Fulfillment es `DELIVERY` (requiere `address`) o `TAKEAWAY` (no admite `address`; envío debe ser cero). Pago: `CASH`, `TRANSFER` u `OTHER`. Opcionales: `options`, notas por ítem, `notes`, `requestedFor` ISO UTC con milisegundos. El schema rechaza propiedades desconocidas; límites de campos y cantidades se validan en el cliente/servicio.

Límites v1: 50 ítems, cantidad entera 1..100 por ítem, 20 opciones informativas por ítem. Importes y total cotizado entre 0 y 1.000.000.000.000 centavos, sin decimales ni valores fuera de rango. Referencias de producto estables de hasta 128 caracteres (`A-Za-z0-9_.:-`, inicio alfanumérico); no deben ser el nombre visible. Nombre del cliente/producto hasta 120 caracteres, teléfono con 8..15 dígitos, dirección hasta 500 caracteres, notas de ítem hasta 500 y notas generales hasta 1000. Textos opcionales vacíos se omiten, no se envían como `null`.

Ejemplo usando cliente compartido desde backend Node:

```ts
import { WebOrdersClient } from "@gastronomy/web-orders";
const api = new WebOrdersClient(
  process.env.WEB_ORDERS_URL!,
  process.env.WEB_ORDERS_SUBMIT_TOKEN!,
);
const result = await api.submit(submission, checkoutIntent.idempotencyKey);
// Persistir result.order y mostrar result.whatsappUrl como acción explícita del cliente.
```

Primero se guarda la solicitud durablemente; después se devuelve `whatsappUrl` para que la interfaz lo abra con confirmación/acción explícita. El sistema siempre la registra como `PENDING_CONFIRMATION` y `paymentStatus: UNVERIFIED`.

| HTTP  | Significado                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `201` | Nueva solicitud creada; respuesta `{ "order": ..., "whatsappUrl": "https://wa.me/..." }`.                                                                          |
| `200` | Reintento con misma clave y mismo body canónico; devuelve la solicitud existente y enlace.                                                                         |
| `409` | Misma clave dentro del mismo sitio, pero body distinto (`idempotency_conflict`).                                                                                   |
| `400` | JSON/schema/clave inválida; `401` token ausente, inválido o rol incorrecto; `403` Origin presente; `413` body >64 KiB; `415` media type no JSON; `429` rate limit. |

La clave se conserva en reintentos del mismo checkout/intención, incluso tras timeout o cierre de la página. No crear una nueva clave por cada retry; clave nueva sólo para una nueva intención de compra. La unicidad está scoped por tienda+sitio.

## Bandeja/reconciliación: `GET /v1/web-orders?after=<cursor>&limit=<n>`

Autenticación: `Authorization: Bearer <token-receive-de-la-tienda>`. `after` predeterminado `0`; `limit` predeterminado `50`, rango `1..100`. Respuesta `{ "orders": [...], "nextCursor": 123, "hasMore": false }`; orden ascendente, scoped a la tienda del token. Listar no consume ni drena pedidos y repetir el cursor es seguro. Cursor `0` permite recuperación completa.

El cliente `WebOrdersClient.list(after, limit)` valida la secuencia/cursor; el consumidor debe persistir pedidos **y cursor en una sola transacción local antes de avanzar/confirmar recepción**. Ante fallo antes del commit, repetir página; evitar saltos adelantando cursor sin pedidos persistidos.

Los registros incluyen `id`, `reference`, `storeId`, `siteId`, `sequence`, timestamps, `status`, `paymentStatus`, `quotedTotalMinor` y `submission`. El status/pago no se modifican por listar.

## Acuse de recepción: `POST /v1/web-orders/:id/received`

Autenticación: token receive. `:id` es UUID. No requiere body. Ejemplo cliente: `await api.acknowledgeReceived(order.id)`.

Devuelve `200 { "order": ... }` y fija `receivedAt` una sola vez (acuse idempotente), o `404` si el pedido no existe en la tienda autenticada. **Sólo confirma recepción técnica**: no acepta ni rechaza el pedido, no cobra/verifica pago, no mueve stock/caja ni cambia `PENDING_CONFIRMATION`/`UNVERIFIED`. Listar tampoco requiere acuse para que el pedido siga disponible.

## Salud

`GET /health` devuelve `200 { "ok": true }`. No requiere bearer; comprobar sólo disponibilidad HTTP, no sustituye una verificación operativa de DB/configuración.

## Operación, limitaciones y reversión

- El servicio mantiene solicitudes en su SQLite aunque el POS esté offline o apagado; mientras la PC/servicio que aloja la DB esté cerrada, no hay acceso remoto a esa bandeja. No hay polling ni bandeja POS/aplicación implementados en este alcance.
- Antes de producción: configurar proxy/TLS y firewall, allowlist/validación/CAPTCHA/rate limits del backend web, permisos mínimos, secretos protegidos, monitoreo y backups consistentes incluyendo DB y WAL (usar mecanismo SQLite consistente, no copiar sólo el archivo activo), y política de retención de PII. Probar restauración antes de depender de backups.
- `WEB_ORDERS_RATE_LIMIT` permite 10..10000 solicitudes por minuto (predeterminado 120): presupuesto independiente por sitio emisor o receptor de comercio; tráfico no autenticado por IP de conexión. Las solicitudes limitadas devuelven `429` con `Retry-After: 60`. Detrás de un proxy, aplicar también límites de abuso por cliente en ese proxy. Los límites en memoria se reinician con el proceso.
- `close()` de `createOrdersServer` es asíncrono: esperar `await service.close()` para drenar HTTP y cerrar SQLite. SIGTERM/SIGINT usa ese cierre, con plazo máximo de 15 segundos para conexiones persistentes.
- **No desplegado ni validado en producción.** No afirmar disponibilidad productiva hasta completar configuración y prueba extremo a extremo.
- Reversión de esta función debe retirar los archivos/packages del servicio y cliente web-orders y sus entradas de workspace/lockfile asociados a esta feature, además de esta guía; no tocar POS ni licencias. Conservar/exportar la DB antes de retirar si contiene solicitudes que deban retenerse.
