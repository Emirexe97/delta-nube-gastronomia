# Licencias manuales: operación y límites del MVP

Implementado el permiso firmado y su control en Electron, con autoridad separada en el VPS. **DNS/HTTPS, piloto público positivo y respaldo cifrado fuera del VPS con simulacro de recuperación aprobados el 2026-10-13. Todavía no habilitado para venta:** faltan custodia portátil/segunda copia, monitoreo y validación del instalador comercial. Los DMG de prueba 0.1.21 generados antes del MVP no incluyen el licenciamiento.

## Regla de acceso acordada

| Situación                                                             | Comportamiento                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Período abonado vigente                                               | Opera incluso sin internet. La verificación demorada no acorta el período.                              |
| Siete días desde la última verificación                               | Aviso y reintento; no es un vencimiento.                                                                |
| Vencimiento del pago                                                  | Tres días adicionales de gracia, todavía operativos.                                                    |
| Final de gracia                                                       | Bloquea nuevas operaciones; permite consulta, informes, exportación, backup, restauración y renovación. |
| Código sin activar, firma inválida o configuración ausente en paquete | Modo consulta/recuperación, sin operaciones nuevas.                                                     |
| Retroceso de reloj mayor a cinco minutos                              | Bloqueo operativo hasta corregir fecha/hora; verificar online no elimina ese ajuste pendiente.          |

Las fechas de la API son instantes UTC ISO **exclusivos**. `paidThrough` inicia la gracia; `graceUntil = paidThrough + 3 × 24 horas` inicia el bloqueo. La UI muestra el último instante incluido en hora local. Ejemplo: si quedan veinte días abonados, siete días sin conexión no los cancelan.

## Arquitectura y seguridad

- `packages/licensing`: esquema y firmas Ed25519, producto e instalación vinculados, revisión, vencimientos y lista explícita de métodos permitidos al vencer.
- `apps/licensing-service`: HTTP Node y SQLite propia; alta y renovación manual autenticadas, fecha absoluta e idempotencia, códigos aleatorios guardados como hash. No conecta PSP ni DB del POS.
- `apps/desktop-shell/src/licensing.ts`: valida con clave pública, conserva permiso offline, reloj efectivo monotónico y persistencia serializada/atómica fuera del backup del POS.
- `main.ts`: comprueba permiso antes de ejecutar cada operación IPC. Un método nuevo no admitido expresamente queda bloqueado al vencer. No depende del banner del renderer.
- Configuración → Licencia permite activar/verificar y consultar vigencia. La UI conserva navegación; algunos controles de escritura siguen visibles pero el backend rechaza su ejecución.
- Paquetes Electron requieren configuración HTTPS válida; desarrollo/demo tienen estado DEVELOPMENT. No hay variable de entorno para omitir el control en paquetes.

El cliente no incluye clave privada ni credencial administrativa. Las respuestas online tienen timeout, límite de tamaño y rechazo de redirecciones/revisiones antiguas. Esto dificulta manipulación, **no vuelve inviolable un equipo controlado por su dueño**. Una renovación/suspensión no conocida todavía por un cliente offline sólo puede conocerse al reconectar. No hay revocación instantánea offline.

## Despliegue privado verificado — 2026-10-13

| Recurso              | Valor                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| VPS                  | `145.223.121.144`, usuario SSH `deploy`                                  |
| Raíz exclusiva       | `/home/deploy/gastronomy-licensing`                                      |
| Compose / contenedor | `gastronomy_licensing` / `gastronomy_licensing-api-1`                    |
| Red                  | `gastronomy_licensing_private`, interna, alias `gastronomy-license-api`  |
| Datos / secretos     | `licensing-data/` y `licensing-secrets/`, sólo de este servicio          |
| Endpoint interno     | Puerto 8097, **sin puertos publicados**                                  |
| Dominio HTTPS        | `gastronomia.deltanubeweb.com`, sin tilde                                |
| Runtime              | Node 22.23.3, imagen fijada por digest, usuario no-root, FS sólo lectura |
| Presupuesto          | 128 MiB, 0,25 CPU; observación puntual 13,36 MiB, no prueba de carga     |

Health interno HTTP200, listado administrativo vacío y protocolo/servicio 11/11 dentro de la imagen real. Los contenedores POS y staging siguen saludables; no se modificaron sus bases, APIs ni secretos. Posteriormente se añadió únicamente el nuevo host al edge Caddy y se conectó ese edge a la red privada de licencias, con respaldo y recarga validada, sin reiniciar los servicios. Las claves se generaron en el VPS y nunca se imprimieron; sólo la pública está en el cliente. La red Docker `internal` impide usar una publicación loopback como acceso; administrar mediante `docker exec` por SSH.

### Alta y renovación del operador

Dentro de una sesión SSH autenticada, ejecutar desde la raíz aislada. Los ejemplos no contienen secretos; el CLI los lee desde un archivo montado:

```sh
cd /home/deploy/gastronomy-licensing
docker compose -p gastronomy_licensing -f docker/licensing/compose.yml exec -T api node apps/licensing-service/dist/admin-cli.js list /run/credentials/admin-token
docker compose -p gastronomy_licensing -f docker/licensing/compose.yml exec -T api node apps/licensing-service/dist/admin-cli.js create /run/credentials/admin-token "Negocio de ejemplo" 2027-01-01T00:00:00.000Z
docker compose -p gastronomy_licensing -f docker/licensing/compose.yml exec -T api node apps/licensing-service/dist/admin-cli.js renew /run/credentials/admin-token LICENCIA_ID 2027-02-01T00:00:00.000Z "Pago manual recibido" pago-2027-01-001
```

El alta devuelve un código una sola vez: entregarlo al negocio por canal privado; no copiar a tickets, memoria, logs ni Git. Primera activación vincula una instalación; repetir allí es seguro, otra instalación recibe conflicto. Renovar usa la nueva fecha absoluta y una clave de idempotencia por pago: repetir exactamente la misma solicitud no duplica extensión. No puede acortarse el período existente.

## DNS y HTTPS habilitados — 2026-10-13

DNS A `gastronomia` → `145.223.121.144` confirmado en resolvers1.1.1.1/8.8.8.8 y desde VPS (TTL14400). Se aplicó el bloque de `docker/licensing/Caddyfile.snippet` al Caddyfile existente, preservando todas las rutas anteriores. `caddy validate` antes de publicar y después de escribir; `caddy reload`, no reinicio. [Procedimiento oficial de Caddy](https://caddyserver.com/docs/command-line).

| Comprobación pública con TLS confiable                     | Resultado                                           |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `https://gastronomia.deltanubeweb.com/health`              | 200, `{"status":"ok"}` desde VPS y Windows          |
| GET `/admin` y `/admin/licenses`                           | 404                                                 |
| POST `/admin/licenses/test-license/renew`                  | 404                                                 |
| POST `/v1/activate` y `/v1/verify` con credencial inválida | 401, rechazo esperado                               |
| POS y staging antes/después                                | 302 en sus URLs habituales; contenedores saludables |

Backups y recibo del cambio en `/home/deploy/gastronomy-licensing/operations/https-20261013T231109Z/`: `Caddyfile.before`, `Caddyfile.candidate` y `receipt.json`, sin claves de licencia. Caddyfile activo `/opt/pos/delta-nube-pos/docker/Caddyfile`, bloque delimitado `BEGIN/END gastronomy-licensing isolated service`. Se preservó el inode del archivo porque es un bind mount individual. Un primer intento de transferir candidate con DockerCP fue rechazado por rootFS sólo lectura antes de cualquier cambio; se transfirió por stdin a `/tmp` tmpfs para validar.

En la primera comprobación pública no se crearon licencias. Tras aprobar el usuario avanzar, se ejecutó un **piloto positivo con Electron verdaderamente empaquetado y UI contra esta URL real**, sin cambiar el bundle de configuración ni deshabilitar TLS. Se creó exactamente una licencia etiquetada `PILOTO TECNICO — NO CLIENTE`, ligada a un perfil POS desechable (no un negocio instalado ni un cobro): activación en gracia, firma con la clave pública real, otro equipo rechazado, vencimiento real, ingreso bloqueado sin mutación, renovación manual idempotente y nuevo ingreso permitido. El perfil/fixture temporal se eliminó; la licencia técnica y su renovación quedan como evidencia en la autoridad (ID `jbgL9sLMbCERSd_GobsftA`). No borrarla ni acortar su vigencia mediante SQL.

Comando opt-in: `node scripts/licensing/public-pilot.mjs --run-public-pilot`. No ejecutarlo en una suite regular: **cada ejecución crea otra licencia técnica**. No se registran códigos, tokens ni credenciales; recibo sanitizado local `.licensing-local/public-pilot-receipt.json` (23:23:56UTC / 20:23:56 Argentina). No es NSIS, instalador comercial ni smoke físico Mac.

### Reinicio y recreación del edge

La conexión runtime se conservaba al reiniciar, pero no al recrear el edge desde el compose anterior. **El usuario autorizó añadir únicamente esa red al despliegue POS**, y se declaró `services.caddy.networks.gastronomy_licensing_private` y `networks.gastronomy_licensing_private` externa en `/opt/pos/delta-nube-pos/docker-compose.central.yml`. Se conservaron default, deltanube_edge y alias prod-caddy; comparación profunda del compose resuelto demostró sólo esas dos adiciones, sin leer env_files ni interpolar credenciales. No se reinició ni recreó el POS.

Backup/recibo: `/home/deploy/gastronomy-licensing/operations/edge-network-20261013T232712Z/`. Fragmento equivalente versionable `docker/licensing/edge-network.override.yml`. **El próximo despliegue del proyecto POS debe conservar estas declaraciones en su fuente**; este chat no hace commit/push al repositorio de ese otro proyecto. No se afirma haber probado una recreación real del edge, porque no se reinició producción.

Si un despliegue externo elimina la declaración/conexión, verificar nombre/red y reaplicar únicamente lo faltante:

```sh
docker network connect gastronomy_licensing_private delta-nube-pos-caddy-1
```

Ese comando sólo corresponde si falta la conexión (Docker rechaza una conexión duplicada). Comprobar HTTPS health200, admin404 y POS/staging saludables después. No publicar8097 ni conectar el servicio de licencias a redes de bases del POS como reemplazo. Monitorear estas comprobaciones antes de una distribución comercial.

Rollback acotado: comparar configuración actual con el candidate respaldado antes de sobrescribir; restaurar `Caddyfile.before` sobre el mismo inode y recargar Caddy. Desconectar únicamente su conexión a `gastronomy_licensing_private` si la creó esta operación. No revertir cambios concurrentes ni detener POS/staging.

No exponer8097 ni abrir administración pública como atajo. El rate-limit usa IP del socket (no confía en X-Forwarded-For): detrás de un único proxy comparte cupo30/min por ruta; validar capacidad antes de escalar clientes. Falta monitoreo operacional externo.

## Respaldo y recuperación de la autoridad

**Primer respaldo cifrado fuera del VPS y simulacro aprobados.** Usuario eligió carpeta privada de esta PC: `C:\Users\Emir\AppData\Local\DeltaNube\LicensingBackups`. Archivo `authority-20261013T232615Z.dnbak`, 41190bytes, con receipt de SHA256 de texto original y cifrado. Directorio limitado al usuario actual y SYSTEM; no guarda un tar, clave privada ni token sin cifrar en Windows. Se transmite por SSH a RAM, se cifra con Windows DPAPI CurrentUser y se publica de forma atómica sin sobrescribir. [DPAPI oficial de Microsoft](https://learn.microsoft.com/en-us/dotnet/standard/security/how-to-use-data-protection).

`scripts/licensing/authority-backup.ps1 Backup` pausa sólo api de licencias bajo lock, toma SQLite+WAL/SHM y claves coherentes, y garantiza reinicio/health en cleanup. **Durante esa breve ventana las activaciones/verificaciones online pueden fallar; clientes ya activados conservan tiempo abonado offline.** No se detiene POS/staging. Límites: archivo64MiB, operaciones120s, salida de validator y stderr64KiB; stderr nunca se imprime.

```powershell
pwsh -NoProfile -File scripts/licensing/authority-backup.ps1 Backup
pwsh -NoProfile -File scripts/licensing/authority-backup.ps1 ValidateRestore -Archive "$env:LOCALAPPDATA\DeltaNube\LicensingBackups\authority-20261013T232615Z.dnbak"
pwsh -NoProfile -File scripts/licensing/authority-backup.test.ps1
```

ValidateRestore descifra en RAM y envía el archivo al VPS por stdin SSH: **contenedor aislado sin red, sin montar datos productivos, sólo tmpfs**. Admite únicamente miembros tar de autoridad conocidos (sin symlinks/traversal/extensiones), comprueba integridad SQLite, pareja privada/pública y API de alta/activación/verificación/renovación en la copia. Resultado: `production_changed:false`, una licencia y una renovación recuperadas; clave pública recuperada coincide con cliente (SHA256 `b62b2bdcc111f217abb41758e60489009c284a67de2e078c30122dccbde9ed67`). No se realizó restauración sobre autoridad activa. Los fixtures temporales se eliminan al terminar.

**Limitación de custodia:** DPAPI CurrentUser depende de este usuario/perfil de Windows. La copia permite recuperar el VPS desde esta cuenta, pero no se considera recuperación garantizada si se pierde también la PC/perfil. Falta copia portátil cifrada con custodio independiente y una segunda ubicación. No borrar/resetear el perfil esperando que la copia siga abriendo en otra PC. No es un backup programado ni monitoreado.

Un backup del POS no contiene licencias ni permite recuperar la autoridad. Deben conservarse juntos SQLite, clave privada, clave pública y credencial administrativa protegida. Cambiar la clave privada rompe la confianza de los clientes actuales; no regenerarla como recuperación. El operador Windows no tiene modo de restauración en vivo: requiere un procedimiento de mantenimiento aprobado.

Procedimiento para una futura restauración en vivo (no ejecutado; requiere aprobación y verificación de rutas):

1. Confirmar rutas absolutas bajo `/home/deploy/gastronomy-licensing`; definir destino protegido fuera de los datos activos y fuera de Git. No incluir archivos de POS/staging.
2. Detener **sólo `api` del compose `gastronomy_licensing`**, nunca `down` global ni volúmenes. El permiso offline abonado de clientes ya activados se conserva durante la ventana.
3. Copiar todo `licensing-data/` (incluidos WAL/SHM si existen) y `licensing-secrets/` con permisos restrictivos; cifrar y enviar fuera del VPS. No copiar sólo SQLite mientras está escribiendo.
4. Iniciar únicamente ese servicio y confirmar health200. Verificar respaldo cifrado, integridad y acceso con credenciales del custodio.
5. Ensayar en directorio/red/container aislados: recuperar misma clave y copia DB, comprobar integridad y vínculo/renovación sin tocar autoridad activa ni DB del POS.

## Criterios antes de distribución comercial

- [x] DNS + HTTPS público y administración inaccesible públicamente.
- [x] Piloto positivo de activación/renovación pública y red del proxy declarada en despliegue actual.
- [x] Primer respaldo cifrado fuera del VPS y recuperación ensayada en aislamiento.
- [ ] Segunda copia/custodia portátil independiente y monitoreo definidos; conservar declaración de red al actualizar fuente POS.
- [ ] Nueva versión/instalador con esta implementación, actualización compatible y prueba en equipo limpio.
- [ ] En Mac: smoke físico, persistencia, impresión, firma Developer ID y notarización para distribución confiable.
- [ ] Flujo de soporte para reinstalación/cambio de equipo y condiciones comerciales aprobadas.

Fuera de este MVP: cobro automático, webhooks PSP, panel web administrativo, endpoint de suspensión, transferencia autoservicio de instalación y rotación coordinada de claves. Una licencia por instalación; no modificar directamente SQL para simular pagos.
