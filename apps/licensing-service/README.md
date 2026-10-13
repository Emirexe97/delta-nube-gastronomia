# Servicio manual de licencias

API independiente para emitir permisos Ed25519 de Delta Nube Gastronomía. No integra PSP, datos del POS ni dependencias nativas. Requiere Node.js >=22.13 (usa `node:sqlite`).

## Configuración y ejecución

Construir desde la raíz del monorepo con `pnpm install`, `pnpm --filter @gastronomy/licensing build` y `pnpm --filter @gastronomy/licensing-service build`; ejecutar `pnpm --filter @gastronomy/licensing-service start`.

Definir `DB_PATH` como ruta absoluta; `ADMIN_TOKEN_FILE` como ruta a un archivo con secreto de al menos 32 bytes; `LEASE_PRIVATE_KEY_FILE` como ruta a una clave privada Ed25519 PEM; opcionalmente `HOST` y `PORT` (predeterminados `0.0.0.0` y `8097`). Los secretos se leen desde archivos solo en el entrypoint, no se imprimen ni se devuelven. Proteger esos archivos y limitar la red al administrador.

## Operación manual

Usar `Authorization: Bearer <secreto>` para endpoints `/admin/*`. Para operaciones manuales, usar el CLI: lee el secreto desde el archivo indicado y nunca lo acepta como argumento ni lo imprime. `LICENSE_API_URL` permite configurar otra URL.

```text
node apps/licensing-service/dist/admin-cli.js create /run/secrets/admin-token "Comercio Ejemplo" 2027-01-01T00:00:00.000Z
node apps/licensing-service/dist/admin-cli.js list /run/secrets/admin-token
```

La respuesta entrega `activationCode` una sola vez; distribuirlo por canal seguro. El hash SHA-256 queda en SQLite. `POST /v1/activate` recibe `{ "code", "installationId" }`; el primer uso liga ese código a una instalación y repetirlo para la misma instalación es seguro. Otra instalación recibe conflicto. `POST /v1/verify` recibe `{ "token", "installationId" }` y devuelve un permiso actualizado si hubo renovación.

Renovar con fecha absoluta exclusiva (no se acumula sobre la fecha previa ni puede acortar una vigencia existente), motivo y clave de idempotencia única:

```text
node apps/licensing-service/dist/admin-cli.js renew /run/secrets/admin-token LICENCIA_ID 2027-02-01T00:00:00.000Z "Pago manual recibido" pago-2027-01-001
```

Repetir igual idempotencyKey + licencia + fecha no extiende otra vez. Una reutilización con distinta licencia/fecha se rechaza. `GET /admin/licenses` lista hasta 1000 licencias, comercio, instalación, fecha, revisión y estado; `GET /health` comprueba disponibilidad. El límite fijo de payload es 16 KiB y hay rate-limit por IP que incluye autenticaciones inválidas.

No se exponen endpoints de suspensión ni eliminación en este MVP. Mantener backups de SQLite y claves fuera del contenedor; rotar y respaldar la clave con un procedimiento coordinado con clientes antes de sustituirla.

Las imágenes Docker fijan Node 22 mediante digest (runtime validado: 22.23.3). No incorporan dependencias de build al runtime: sólo el `dist` del servicio y la librería en la ruta ESM de resolución. Corren como `node`, con `/data` persistente y secretos montados de sólo lectura. El healthcheck usa `fetch` del propio Node. El despliegue VPS usa `docker/licensing/Dockerfile.runtime` con artefactos ya compilados y validados; no recompila el POS en el servidor.

Consultar `docs/LICENSING.md` para estado del despliegue, operación por SSH, DNS/HTTPS, backups y criterios pendientes de distribución.
