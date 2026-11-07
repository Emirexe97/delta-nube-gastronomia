# Piloto VPS: cuenta y Mozo — 2026-11-06

## Estado

**Servicios publicados por HTTPS y saludables. Cuenta activada en la PC; dos envíos reales desde el teléfono por datos móviles y dos comandas simuladas verificados. El segundo envío se recuperó después de un corte, pasó por aprobación en caja y generó sólo el agregado, sin duplicados. Papel físico pendiente.**

El usuario autorizó el piloto aislado y pidió nombres profesionales sin «piloto». Confirmó publicar `licencias.gastronomia.deltanubeweb.com` y `mozos.gastronomia.deltanubeweb.com`: se crearon únicamente esos dos registros A a `145.223.121.144`, TTL 300. Los nombres anteriores con prefijo piloto no se publicaron.

Se cambiaron sólo los orígenes de los dos servicios nuevos y el JSON privado del lanzador, conservando cuenta, claves y bases. Caddy se validó y recargó gradualmente después de comparar configuración activa y candidata, agregar sólo esos hosts y conectar el proxy a la red interna nueva. Su inode, ID, PID, hora de inicio y contador de reinicios permanecieron iguales.

Certificados públicos verificados sin omitir TLS, vencimiento 2027-02-04. Ambos `/health` devuelven 200; Mozo `/waiter` devuelve 200, título **Comandas**; solicitudes terminal sin credenciales devuelven 401. `/admin/licenses`, `/manage`, `/v1/web-catalog` y `/v1/web-orders` devuelven 404 en ambos hosts. Validación desde VPS y esta PC.

Se integró y probó `scripts/hosted-pilot-manual.mjs`: bootstrap fuera del repositorio, perfil nuevo, impresión simulada instalada antes de cargar la app, sin automatizar controles. Pruebas del bootstrap: 5/5; cuenta/perfil/relay/sync: 28/28; config: 4/4; preflight: 7/7; typecheck y build: 11/11.

Instancia abierta: `C:\Users\Emir\AppData\Local\Temp\gastronomy-local-pilot-hosted-aVsXlC`. El usuario dejó visible la ventana nueva y se completó por UI la activación real contra el HTTPS nuevo: **Activa / PILOTO FICTICIO VPS - NO PRODUCCION**. Se limpió el campo contraseña tras ingresar. El perfil Wi-Fi anterior permanece intacto.

Preparación local comprobada por UI y lectura SQLite:
- Caja #1 abierta con $0 y observación de prueba; nombre visible `PRUEBA MÓVIL — datos ficticios`.
- Usuario ficticio `Mozo piloto`, rol Mozo, número 2, PIN de prueba <PIN privado de prueba>.
- Productos locales `Producto piloto uno` y `Producto piloto dos`, $99 por canal, activos, sin control de stock y ocultos en web. No se configuró ni publicó una tienda.
- **Mesa 8**, ya incluida en la base inicial. No confundir con la mesa 88 del perfil Wi-Fi anterior.
- Cocina `SYSTEM_DIRECT`, dispositivo explícito `PILOTO-SIMULADA`, una copia. `Imprimir prueba` produjo exactamente una captura en `simulated-printer.jsonl`, con `silent=true`; nunca se llamó a la impresora física.
- Configuración guardada, licencia con token persistido y verificación posterior; SQLite `quick_check=ok`.
- Baseline antes del teléfono: 0 pedidos, 0 tandas, 0 pendientes, 0 trabajos de pedido; una captura es sólo la prueba de impresora, no una comanda de venta.
- QR presencial generado para el mozo; un desafío local. Vence en 2 minutos, por lo que el usuario puede generar otro al iniciar. Se indicó apagar Wi-Fi, usar datos móviles y enviar una unidad del primer producto a mesa 8.

El primer intento mostró «El QR es temporal; volvé a escanearlo desde la caja». Ese mensaje corresponde a una invitación ausente, no prueba por sí solo que haya vencido: el fragmento del QR se limpia al cargar y recargar o abrir el enlace general deja la página sin el desafío. Se regeneró el QR y se indicó cerrar la pestaña anterior y abrirlo directamente.

El usuario confirmó después **mesas y productos visibles usando datos móviles**. SQLite registra una sesión no revocada de `Mozo piloto` creada el 2026-11-06 a las 16:16:42 (Argentina), vigente por 15 minutos. Al verificarla todavía había 0 pedidos, 0 tandas, 0 pendientes y 0 trabajos de pedido; la única captura seguía siendo la prueba de impresora. Se pidió enviar una unidad de `Producto piloto uno` a mesa 8, una sola vez.

La vinculación por red móvil está comprobada; no afirmar todavía recepción de pedidos, impresión incremental ni repetición del corte. Tampoco se probó un comandero térmico real.

## Acceso hasta cerrar caja · actualización posterior

El usuario esperó varios minutos y recibió el vencimiento de la sesión anterior; pidió que el acceso termine al cerrar la caja. Se implementó esa política para las **nuevas vinculaciones**:

- QR presencial de un uso y dos minutos, sin cambios. La sesión vinculada muestra **Hasta el cierre de caja**; no vence a los quince minutos ni a las ocho horas. Revocación manual disponible. Esto no prueba permanencia física: revocar cuando el mozo se retire.
- Migración 47 agrega `expires_on_cash_close`; cada operación comprueba el identificador de la caja abierta. Cerrar revoca sesiones y desafíos en la misma transacción. Una caja nueva no los reactiva. Las sesiones temporales anteriores no se prolongan.
- Reiniciar la PC conserva accesos de la misma caja abierta; restaurar un backup revoca explícitamente. El relay sigue en RAM: reiniciarlo exige vincular de nuevo. El worker permanece activo durante la caja abierta y notifica su identificador al relay, sin el límite anterior de 18 minutos.
- Pruebas: SQLite 10/10 (turno simulado de 13 horas, cierre, reapertura, reinicio y reintentos), worker 4/4, relay/página 16/16, circuito HTTP con SQLite y pérdida de respuesta 1/1. Typecheck y build 11/11; revisión independiente sin bypass de caja cerrada. No equivale a probar papel físico.
- Despliegue selectivo a las 19:57 UTC: sólo `waiter-page.js` y `waiter-relay.js` del servicio nuevo, con respaldo previo y rollback. Preflight de aislamiento aprobado; límites sin cambios. Se reinició únicamente `gastronomy_account_waiter_pilot-waiter-1`; saludable. **Los otros 14 contenedores conservaron ID, PID, inicio, reinicios y salud**, incluidas ambas autoridades de licencias, POS, staging y proxy. No cambios de DNS, Caddy ni catálogo.
- HTTPS público: ambos health 200; página Mozo 200 con nuevo texto; terminal sin credenciales 401. Evidencia/rollback: `/home/deploy/gastronomy-account-waiter-pilot/operations/waiter-cash-close-20261106T195705Z/`.
- Se reinició sólo la ventana nueva usando el mismo bootstrap y perfil `hosted-aVsXlC`, sin reprovisionar ni reactivar licencia. Backup consistente `pre-cash-close-policy.sqlite`, integridad OK. Migración instalada, caja #1 intacta, sesión antigua revocada; 0 pedidos/tandas/pendientes/trabajos, y la única captura sigue siendo la prueba de impresora. Licencia activa y política nueva verificadas por UI. Perfil Wi-Fi anterior intacto.

Pendiente: vincular nuevamente el teléfono y completar la primera tanda real por datos móviles, la tanda incremental y el corte de conexión. No afirmar esas pruebas hasta observar los recibos locales.

## Aislamiento y límites efectivos

### Primera confirmación móvil y simplificación de interfaz

El usuario confirmó una nueva vinculación y el texto «Hasta el cierre de caja». Reportó «Tanda pendiente» y pidió interfaces simples, sin datos técnicos. La lectura local mostró un envío anterior de mesa 8, una unidad de `Producto piloto uno`, enviado a las 19:38:48 UTC y recibido a las 20:16:20 UTC (2252 segundos). La revisión de caja era correcta: antes de aprobar había cero pedidos y cero comandas.

El usuario lo aprobó a las 20:18:55 UTC. Se verificaron **un pedido, un recibo, un trabajo PRINTED y una comanda simulada** con ese único producto. El archivo tiene dos capturas contando la prueba inicial de impresora. No hubo duplicados.

Cambios de UX publicados en el piloto:
- Pendientes en **Salón → Mozos**, ya no en Pedidos; los aceptados siguen dentro de su mesa. Pestañas con permisos y navegación de teclado. Notificación de escritorio y guía actualizadas.
- «Esperando aprobación de caja», «El pedido no llegó» y «Comprobá si llegó» reemplazan estados técnicos. No se muestran UUID, códigos internos ni errores crudos en esos estados móviles. El aviso aparece antes del menú; no hay tarjetas vacías de impresión ni avisos redundantes de conexión.
- Corregido el botón inferior: antes decía consultar pero quedaba deshabilitado por existir un pendiente. Ahora **Ver estado del pedido** está habilitado sin permitir crear un segundo envío. Se conservan las guardas de antigüedad, consulta antes de reintento e identificador estable.
- Pruebas service 20/20, circuito HTTP/SQLite 1/1, bandeja/navegación 4/4, typecheck/build 11/11. Verificación visual móvil a 390 px con datos ficticios y del escritorio real; E2E de navegador ajustado, no ejecutado en esta pasada.
- Actualizado sólo `waiter-page.js` del servicio nuevo a las 20:26 UTC, con preflight y respaldo en `/home/deploy/gastronomy-account-waiter-pilot/operations/waiter-ui-20261106T202615Z/`. Los otros 14 contenedores siguen iguales y saludables. Ambos health públicos 200; la página pública sirve los textos nuevos.
- Reabierto el mismo perfil local: ventana 5244658, proceso lanzador de la sesión 82061. Backup `pre-simple-waiter-ui.sqlite`; integridad OK. Después del reinicio siguen un pedido, un trabajo PRINTED, cero pendientes y dos capturas. Salón → Mozos queda visible y vacío; mesa 8 conserva $99. No se reinició el perfil Wi-Fi anterior.

Para continuar en el teléfono hace falta un QR nuevo por el reinicio del servicio. No volver a cargar el producto ya confirmado. Falta la segunda tanda incremental por datos móviles y el corte controlado; aún no se probó papel físico.

### Prueba incremental con corte de datos móviles · completada

Con Wi-Fi apagado, el usuario agregó sólo una unidad de `Producto piloto dos` a la mesa 8, cortó los datos antes de enviar y retomó el mismo envío después. El pedido conservó la hora inicial: enviado 20:36:06 UTC y recibido 20:38:07 UTC, **121,702 segundos de demora**. Quedó una sola revisión de caja. Antes de aprobar seguían un pedido y una comanda; no se agregó ni imprimió anticipadamente.

El usuario aprobó desde **Salón → Mozos** a las 20:40:21 UTC. La segunda captura dice **AGREGADO · 1 × PRODUCTO PILOTO DOS**, sin repetir el producto uno. Después tocó Ver estado y Actualizar y confirmó «Comanda enviada a la impresora». Lectura posterior 20:41:53 UTC:

- Un pedido #1, mesa 8, total $198; una unidad de cada producto.
- Dos recibos y dos trabajos PRINTED; cero pendientes.
- Tres capturas en el archivo: prueba inicial de impresora + dos comandas de pedido. Todas por PILOTO-SIMULADA, sin papel.
- Ningún pedido, producto ni comanda duplicados por la recuperación o las consultas.

Esta prueba cubre el corte antes del envío, recuperación con aprobación y consultas posteriores. No prueba salida física de papel ni un corte exactamente después de entregar al spooler; ese último caso sigue requiriendo comprobación manual de cocina antes de reimprimir.

El usuario detectó que el resultado de **Ver estado del pedido** quedaba fuera de pantalla. Se agregó enfoque y desplazamiento al aviso visible al consultar, enviar o reintentar; muestra **Consultando…** y bloquea consultas simultáneas. Las actualizaciones automáticas no desplazan la pantalla y se respeta movimiento reducido. Verificado visualmente a 390 px con veinte productos, desde el final de la página. Pruebas service 23/23 y typecheck/build 11/11.

Mejora publicada a las 20:45 UTC, sólo `waiter-page.js` del servicio Mozo aislado. Respaldo/rollback en `/home/deploy/gastronomy-account-waiter-pilot/operations/waiter-focus-20261106T204531Z/`. Preflight aprobado; los otros 14 contenedores conservaron sus procesos y salud. Página pública 200 con la mejora y ambos health 200. No se reinició la PC ni se alteraron pedidos; para cargar la página nueva en el teléfono se requiere un QR nuevo por el reinicio del relay.

- Raíz VPS: `/home/deploy/gastronomy-account-waiter-pilot` (700); configs privadas 600.
- Proyecto `gastronomy_account_waiter_pilot`; servicios `license` y `waiter`; red interna propia `gastronomy_account_waiter_pilot_private`.
- Licencia: 512 MiB RAM, 0.5 CPU, 64 procesos; Mozo: 128 MiB, 0.25 CPU, 64 procesos. Swap igual a RAM. Sin puertos publicados.
- Usuario 1000:1000, raíz de sólo lectura, `cap_drop ALL`, `no-new-privileges`, tmpfs 8 MiB, logs limitados a dos archivos de 5 MiB.
- Runtime Node 22.23.3 ya existente por digest inmutable; no se instalaron paquetes ni se descargaron imágenes en el VPS. Se montaron compilados propios separados de las aplicaciones existentes.
- Una cuenta ficticia y una licencia de 30 días, con claves nuevas. Ninguna licencia existente se migró o modificó. No catálogo ni impresoras físicas.

## Medición real

Prueba sintética de diez cuentas en contenedor desechable `--network none`, limitado a 512 MiB y media CPU:

| Métrica | Resultado |
|---|---:|
| RSS inicial / pico | 58 / 200.7 MiB |
| Activación única | 604.3 ms, HTTP 200 |
| Cuatro simultáneas | 2372.7 ms, todas HTTP 200 |
| Cinco simultáneas | cuatro HTTP 200 y una HTTP 429 |
| Salida / OOM | 0 / false |

El límite de cuatro KDF concurrentes evita admitir trabajo ilimitado. La medición no garantiza impacto cero ni reemplaza observar una prueba real. En reposo Docker informó aproximadamente 13.4 MiB para licencia y 14.4 MiB para Mozo (métrica distinta de RSS). RAM disponible del host posterior: 5234 MiB.

## Persistencia y controles

- Reiniciado **solamente** el contenedor de licencia piloto: permanecen una licencia y una cuenta. SQLite `integrity_check=ok`.
- Backup consistente previo al reinicio contiene esa licencia y cuenta y pasó integridad; copia privada descargada a esta PC fuera del repositorio.
- Credencial temporal de aprovisionamiento eliminada tras crear la cuenta. Claves y contraseña no aparecen en este documento, Compose ni consola.
- Los 13 contenedores previos conservan ID, PID y `StartedAt`; todos sus healthchecks siguen saludables. MinIO, sin healthcheck, sigue corriendo.
- Caddyfile conserva íntegro el contenido anterior y añade sólo el bloque de los dos hosts nuevos. No reinicios ni actualizaciones del POS, su base, worker, caché, licencias o relay anterior. Tras publicar HTTPS se repitió la comparación de los 13 procesos previos y seguían sin cambios y saludables.
- Preflight: 7 casos offline; launcher config: 4; hosting wrapper/persistencia: 4. Typecheck y build: 11/11. Pruebas loopback requirieron ejecución fuera del sandbox de red.

## Continuación segura

1. No volver a aprovisionar: la cuenta y los dos contenedores ya existen.
2. DNS, certificados y rutas ya publicados y verificados: no volver a agregarlos ni repetir `apply-gastronomy-edge.py` (es deliberadamente de una sola aplicación).
3. La conexión adicional del proxy a `gastronomy_account_waiter_pilot_private` persiste al reiniciar el contenedor, pero debe reponerse si un operador lo **recrea**. No se modificó el Compose del POS para evitar cambios en su despliegue.
4. Continuar con el perfil **hosted-aVsXlC ya activado**, sin regenerar su identidad de equipo. No detener ni reutilizar el perfil Wi-Fi anterior. La cuenta ya se probó por UI; resta teléfono con datos y comandas simuladas incrementales. Corte superior a 60 s requiere caja.
5. El relay Mozo es deliberadamente temporal y en memoria: PIN, sesiones y solicitudes no se guardan en disco remoto. La persistencia autoritativa del pedido y su deduplicación son locales en caja; el teléfono conserva la tanda incierta. Un reinicio del relay requiere vincular nuevamente y no equivale a perder un pedido ya confirmado en caja. No presentarlo como cola durable en el VPS.

## Evidencia privada (fuera del repo)

- PC: `<configuración privada fuera del repositorio>` — credenciales del piloto; **no compartir ni versionar**.
- Misma carpeta: `authority-backups`, `profile-linux.json`, paquete privado.
- VPS, dentro de la raíz nueva: `baseline-containers.txt`, `current-containers.txt`, `profile-linux.json`, `baseline-caddy.sha256`, `edge-before.caddy`, `edge-candidate.caddy`, `edge-runtime-before.json`, `verify-edge-candidate.py`, `edge-candidate.verified`.

Nota Caddy: adaptar por `/dev/stdin` cambia automáticamente un elemento `file_server.hide`; los grupos automáticos también se renumeran y los hosts nuevos agregan metadatos TLS/log. La comparación verifica el resto exactamente normalizando sólo esas diferencias conocidas. La aplicación final validó y recargó desde `/etc/caddy/Caddyfile`, con rollback protegido frente a cambios concurrentes. Evidencias adicionales: `edge-active.sha256`, `edge-runtime-after.json`, `apply-gastronomy-edge.py`.
