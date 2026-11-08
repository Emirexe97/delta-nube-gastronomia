# Modo Mozo: teléfonos, caja y comandero

## Preparar una caja

1. **Cuenta de negocio:** con los servicios actualizados y conectados, al activar la caja o volver a validar una licencia V2 vigente el equipo recibe acceso automáticamente. No hace falta registrar una tienda, cargar WhatsApp ni copiar claves. Los pasos técnicos siguientes son para soporte o instalaciones manuales.
2. El servicio de pedidos necesita su origen HTTPS público. Para el despliegue multi-comercio se usa el host de pedidos, no el subdominio de la carta de un cliente. Para una configuración manual del servicio se usa `WAITER_PUBLIC_BASE_URL`. El token de recepción debe estar asignado a esta instalación (`receiveInstallationId`).
   Las instalaciones anteriores pueden conservar su conector de pedidos web: aprovisionamiento del comercio o `GASTRONOMY_WEB_ORDERS_URL`, `GASTRONOMY_WEB_ORDERS_STORE_ID` y `GASTRONOMY_WEB_ORDERS_TOKEN` en el proceso de caja. No poner estas credenciales en la página, el QR ni el teléfono. No hace falta publicar la carta para enviar una comanda. El POS no recibe conexiones entrantes ni requiere abrir puertos en el router.
   Si el conector privado y el acceso móvil tienen orígenes distintos (por ejemplo, el piloto local), configurar además `GASTRONOMY_WAITER_PUBLIC_URL` con el origen HTTPS accesible desde el teléfono. Sólo modifica el destino del QR; las credenciales de caja continúan enviándose al conector. No se acepta un destino enviado por una respuesta remota. Una URL `127.0.0.1` en el QR nunca llega a la PC desde un teléfono.
3. **Opcional, sólo para imprimir:** instalar el comandero en el sistema operativo de la caja. En **Configuración → Impresión → Comanda de cocina**, seleccionar **Impresión directa**, elegir el dispositivo por nombre, hacer una **prueba física** y guardar. Revisar ancho, copias y qué impresora entrega el papel. La cuenta del cliente se configura aparte.
4. Activar Salón, crear un usuario activo **Mozo** con PIN propio, abrir un turno y, desde **Configuración → Modo Mozo**, elegir a la persona y generar su QR. Para revocar, usar **Accesos activos → Revocar**.

## Servicio durante el turno

- El mozo escanea el QR en la caja e ingresa su PIN en el navegador del teléfono. Puede cambiar de Wi-Fi a datos móviles. **El QR de vinculación es de un uso y vence a los dos minutos; una vez vinculado, el acceso dura hasta cerrar esa caja**, sin cortes a los quince minutos ni a las ocho horas. Caja puede revocarlo antes. El registro del pedido requiere turno vigente y conexión tanto del teléfono como de la caja al servicio. Abrir una caja nueva no reactiva accesos ni QR del turno anterior.
- Elegir la mesa, armar la tanda y tocar **Enviar pedido**. El teléfono admite productos del menú de Salón con cantidad y observación; los combos que requieren selección, las mitades y los modificadores estructurados se cargan desde el escritorio. El mozo no puede cobrar ni cambiar precios desde el teléfono. La caja valida el pedido con sus datos locales. Un pedido existente sólo admite agregados del mozo asignado y mientras corresponda a la misma mesa/pedido.
- **Sin comandero:** la tanda aceptada se registra en su mesa, sin crear trabajos de impresión. No hace falta reenviarla. Configurar una impresora después no imprime automáticamente las tandas anteriores.
- **Con comandero:** platos y bebidas de esa tanda salen juntos por el comandero de cocina. Una segunda tanda imprime sólo sus nuevas cantidades, aunque sean del mismo producto. La cuenta no se imprime con la comanda. En escritorio, **completa**, **agregados** y **reimpresión** son acciones distintas; no son sectores de cocina. No hay reparto por categoría, barra o estación en esta versión.
- Tras perder conexión no volver a cargar el pedido. Conservar el borrador y consultar el estado de la misma tanda. Si la caja no la recibió, reintentar esa tanda, no una nueva. Si fue aceptada pero falló el comandero, comprobar el papel y recuperar **la impresión** desde el pedido en la caja.
- Si la PC se corta justo después de entregar el trabajo al sistema operativo, no se puede saber con certeza si salió papel. No se reimprime automáticamente al reiniciar. Consultar en cocina antes del reintento manual. Una respuesta exitosa del controlador tampoco confirma papel disponible.

## Cortes de Internet y tandas demoradas

El circuito de teléfonos requiere Internet en la caja y en el móvil. **La caja sigue pudiendo operar localmente** (cargar pedidos, cobrar y usar la impresora local), sin esperar al servicio de mozos, siempre que su licencia local permita operar. Una impresora de red necesita que su red local funcione; eso es independiente de la salida a Internet.

- El móvil guarda la hora del **primer** toque en Enviar junto con el identificador y las líneas. Estima esa hora desde el reloj de caja recibido al consultar el estado y el tiempo transcurrido local; no usa directamente la fecha absoluta del teléfono, que puede estar adelantada. Sin referencia válida se exige revisión. Los reintentos no renuevan esa hora ni inventan otra tanda.
- Si la tanda llega **más de 60 segundos** después, se guarda en SQLite como `PENDING_REVIEW`. Una hora ausente, inválida o futura también exige revisión. **No se crea ni modifica el pedido, no se descuenta stock y no se genera una comanda** en esa recepción.
- En **Salón → Mozos**, un cajero, encargado o administrador con permiso de crear pedidos revisa mesa, mozo, horarios y artículos. Debe consultar si ya se resolvió manualmente antes de **Aprobar pedido** o **Descartar pedido**. Los pedidos aceptados aparecen en su mesa; esta pestaña reúne los que requieren aprobación. Ya no se revisan desde Pedidos.
- El teléfono muestra **Esperando aprobación de caja** cuando hace falta esa revisión. **Ver estado** consulta el pedido sin reenviarlo. Si caja confirma que no llegó, se ofrece **Volver a intentar**; conserva internamente el mismo envío, sin pedir al mozo copiar códigos ni volver a agregar productos.
- La confirmación es local: no depende de recuperar Internet. Revalida turno original abierto, mesa, mozo activo, productos y stock. Sólo encola impresión si en ese momento hay un comandero configurado en modo directo. Si la mesa o el turno cambiaron, la operación se rechaza y la tanda permanece para revisión; no se aplica a un pedido diferente.
- Confirmar dos veces, consultar estado o reenviar una tanda ya recibida no genera otro pedido ni otra comanda. Un recibo de aceptación anterior prevalece sobre la antigüedad: perder la respuesta no transforma una venta ya aceptada en otra pendiente.
- Los pendientes sobreviven al reinicio de la PC. Los accesos nuevos también se conservan si sigue abierta la misma caja; las sesiones temporales antiguas se revocan al iniciar. Restaurar un backup o reiniciar el servicio intermediario requiere un QR nuevo. Tras vincularse, el mismo mozo puede consultar el estado guardado. No se reenvían tandas de otro turno. El teléfono conserva los pendientes por comercio, caja y mozo.
- Si una tanda de un turno anterior nunca llegó a caja, el móvil permite cerrar únicamente su seguimiento local tras consultar estado con éxito (`NOT_FOUND`) y confirmar que se verificó con caja. No cancela pedidos recibidos ni borra el borrador del turno actual; un error de red nunca habilita esa acción.
- Cuando se corta Internet antes de que la caja reciba la solicitud, no se promete entrega automática: se conserva el envío incierto en el teléfono y se consulta su estado al recuperar conexión. Si el servicio temporal perdió la solicitud, se reintenta manualmente el mismo identificador y hora original. Vencido el acceso, primero hay que renovar el QR.

### Validación de cortes

Probar con una tanda ficticia y una sola impresora: recepción inmediata; pérdida de respuesta después de aceptar; tanda con más de 60 s; confirmación repetida; rechazo y reintento; cambio de turno; carga local mientras falla el transporte. En el caso demorado debe haber **cero cambios de pedido/comanda antes de confirmar**, y, después, un solo trabajo si hay comandero configurado o ninguno si no lo hay. Las pruebas automáticas simulan el controlador; la salida física de papel se valida aparte.

## Alcance y límites

**El QR prueba acceso al QR en ese momento, no ubicación continua.** Una sesión vinculada podría usarse desde fuera mientras esa caja siga abierta: revocar el dispositivo cuando el mozo se retire y cerrar la caja al terminar. No enviar fotos del QR por mensajería. El cierre revoca las sesiones y los QR pendientes en la misma transacción; cada operación vuelve a validar la caja local. Si no hay Internet, el intermediario puede tardar en mostrar la revocación, pero no puede aplicar pedidos a la caja cerrada.

Actualizar juntos escritorio y servicio para esta política: el escritorio informa la caja abierta con `X-POS-Cash-Session` y mantiene el conector activo durante el turno. Un escritorio anterior no informa el cierre al intermediario; la validación local sigue siendo obligatoria. El intermediario conserva sesiones sólo en memoria (con límite de capacidad), no promete conservarlas tras su reinicio.

**No es un modo de envío sin Internet.** Con el teléfono desconectado se puede conservar un borrador; si la caja o el servicio están sin conexión no se confirma el pedido. No borrar datos del navegador mientras haya tandas inciertas. El servicio intermediario usa memoria efímera, no es el registro de ventas; la recepción e impresión se registran en SQLite en la caja. Usar una sola instancia del intermediario para este circuito (sin balanceo entre memorias independientes).

## Prueba de aceptación en el local

Con dos teléfonos, uno en datos y otro en Wi-Fi: vincular; comprobar PIN incorrecto y QR reutilizado; enviar dos tandas a la misma mesa; cortar conexión después de tocar Enviar, recuperar y verificar un solo pedido y una comanda por tanda. Desconectar la impresora, revisar el aviso y recuperar desde caja. Probar revocación, cierre de caja y renovación antes de habilitarlo en servicio.

## Alta automática — operación y despliegue

La autoridad entrega un ticket de cinco minutos al equipo aprobado que demuestra posesión de su clave al activar o validar su licencia V2 vigente. El escritorio lo canjea en segundo plano por un acceso privado **sólo para mozos**. Los equipos que ya usan un conector válido lo conservan. Los códigos legacy V1 sin identidad de dispositivo no reciben credenciales nuevas: requieren vincular la caja por el flujo V2 existente.

- **Un servicio, no un despliegue por negocio.** Pedidos guarda el vínculo licencia–instalación y el hash del token. Repetir el alta no duplica el comercio, no crea carta ni habilita pedidos web. Si el negocio agrega una carta después, conserva su identidad. Otra instalación en conflicto no desplaza automáticamente a la caja anterior.
- **Internet y vigencia.** La caja conserva la credencial cifrada con el almacenamiento seguro del sistema; revalida como máximo una vez cada 12 horas tras una validación correcta. Ante un error transitorio, vuelve a intentarlo en las siguientes validaciones, sin bloquear la caja. Sin renovación el acceso automático caduca a las 48 horas. La caja deja de usarlo cuando su licencia deja de estar activa.
- **Configuración única del operador.** Actualizar primero Pedidos (base persistente con backup) y configurar su origen público HTTPS en `WAITER_PUBLIC_BASE_URL`. Licencias y Pedidos deben compartir un secreto exclusivo de servidor de al menos 32 bytes en `WAITER_PROVISION_SECRET_FILE`; nunca distribuirlo a las cajas. Como compatibilidad, ambos pueden usar su secreto de aprovisionamiento web existente. El secreto separado no habilita tiendas web.
- **Proxy y escritorio.** En el host de pedidos permitir la ruta exacta `POST /v1/waiter-connections` además del relay; no abrir rutas de administración. Luego actualizar Licencias y el escritorio. Para un entorno distinto, fijar `GASTRONOMY_WAITER_PROVISION_URL` al origen de Pedidos en la distribución (por defecto `https://pedidos.deltanubeweb.com`). No hace falta configurar cada cuenta.
- **Comprobación.** En una caja de prueba sin carta ni impresora, activar una cuenta, abrir caja y emitir un QR. Repetir con una cuenta ya activa mediante validación de licencia sin volver a ingresar credenciales. Confirmar que la tienda sigue sin publicar. Ante falta de acceso, comprobar versión, secreto compartido, proxy y HTTPS antes de tocar la cuenta.

## Publicación del servicio de personal · 4 de noviembre de 2026

Se instaló en el VPS el runtime de pedidos con una sola instancia, sin publicar puertos del contenedor ni habilitar altas/carta/administración a través del nuevo host. Caddy conserva el Host original. El dominio previsto es **pedidos.deltanubeweb.com**: sólo se enrutan `/waiter`, `/waiter/` y `/v1/waiter/*`. El servicio de licencias no se actualizó ni se configuró un comercio piloto. El alta automática de tiendas es una operación distinta.

- **Versión del servicio:** `waiter-20261104T220000Z-r2`. Directorio actual: `/home/deploy/gastronomy-web-sites/current`. Runtime: Compose base + `docker/web-sites/waiter-edge.override.yml`; red interna dedicada y volumen de datos persistente.
- **Verificado:** contenedor saludable; página de PIN 200 desde el proxy; cola sin credenciales 401; redirección HTTP 308 con el Host correcto. El POS, staging y health de licencias conservaron 302/302/200, respectivamente.
- **Pendiente al publicar:** el DNS público todavía respondía NXDOMAIN para `pedidos`. Crear sólo el registro A `pedidos → 145.223.121.144`. Luego comprobar HTTPS **sin** omitir la validación del certificado: `curl -fsS -o /dev/null -w '%{http_code}' https://pedidos.deltanubeweb.com/waiter` (esperado 200). No confundir el 308 o la prueba de red interna con TLS público validado.
- **Caja:** no se vinculó instalación alguna para esta prueba. Se probará primero con la computadora de desarrollo, sólo cuando el usuario diga «listo»; la instalación del local queda para después. Verificar conector asignado antes de emitir el QR. No copiar token/PIN en chats ni registros.

- **Respaldo y reversión:** recibo y configuraciones de referencia en `/home/deploy/gastronomy-web-sites/operations/edge-20261104T220246Z/`. Para retirar la publicación, quitar sólo el bloque de este host del Caddyfile vigente, validar y recargar; retirar sólo la conexión/declaración de la red dedicada si ya no se usa. No sobrescribir cambios posteriores de terceros con una copia antigua, ni eliminar el volumen de pedidos.

### Prueba posterior en Hostinger Business · 4 de noviembre de 2026

Se eligió probar el hosting administrado **sin modificar el VPS ni ejecutar el cambio de DNS sugerido arriba**. El sitio nuevo es `https://mediumaquamarine-walrus-783168.hostingersite.com`. Es una demo aislada: `/waiter` usa la pantalla y el relay reales pero no autoriza terminales, no emite invitaciones y no se vincula a una caja. No ingresar datos reales.

| Comprobación remota | Evidencia |
| --- | --- |
| Inicio HTTPS, Node v22.23.4, SQLite | hPanel: Express, app.js; primer ZIP completado 19:50:48 hora argentina. |
| Reinicio manual desde hPanel | En `/probe`, mismo marcador aleatorio y fecha; el identificador de proceso cambió de `321ce653…` a `eb4ae500…`. |
| Nuevo ZIP, sin incluir la base | Despliegue completado 19:52:31; `/probe` devolvió `release: r2` y proceso `1abe861f…`, conservando el mismo marcador `hosting-probe-b6ca9d8b-7e24-4da3-94ea-331b93ef59cf` y alta `2026-11-04T22:50:58.140Z`. SQLite quedó en una carpeta específica del ensayo en el home, fuera del directorio que se reemplaza al desplegar. |

Esto prueba persistencia frente a esos dos eventos; **no prueba un restore, recuperación del proveedor ni continuidad de licencias**. No se probaron PIN/pedidos reales o impresión. Siguientes pasos independientes: (1) habilitar una sola caja de laboratorio y probar dos tandas con pérdida de conexión; (2) si se decide migrar licencias, validar en una app separada con claves ficticias, verificar backups/restauración y compatibilidad de los clientes instalados antes de cualquier cambio de autoridad.
