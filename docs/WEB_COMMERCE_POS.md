# Conector de comercio web en el POS

**Para nuevas altas**, usar el [registro automático de una web por comercio](WEB_SITES_REGISTRATION.md). La configuración manual que sigue es para instalaciones existentes o integraciones con una web externa.

El conector sincroniza el catálogo publicado desde el proceso principal del POS e importa pedidos del comercio web. No requiere ni admite credenciales en el renderer. La tienda Bonis es un ejemplo de configuración: host `bonis.deltanubeweb.com`, `storeId=bonis` y `siteId=bonis-web` (identificadores ilustrativos acordados para el despliegue, no credenciales). `GASTRONOMY_WEB_ORDERS_URL` debe apuntar a la base de la API Web Orders, no al storefront, salvo que el proxy inverso del dominio enrute explícitamente las rutas `/v1/web-orders` y `/v1/web-catalog` hacia esa API.

## Configuración de una instalación POS

**Secuencia para Bonis (antes de apuntar el dominio):**

1. En el POS de Bonis, abrir el panel de licencia y copiar «Identificador de instalación». Es un identificador, no la credencial.
2. En la configuración privada de la API, definir una tienda `bonis` con `receiveInstallationId` igual a ese ID, un `receiveTokenHash` exclusivo y un sitio `bonis-web` con su propio `submitTokenHash`. Ver el [formato y la generación de tokens](WEB_ORDERS_API.md). El secreto receptor más el ID identifican al POS; no se usa el nombre del equipo ni la IP del local.
3. Configurar únicamente ese POS como se muestra abajo. Configurar el backend de la carta con `WEB_STOREFRONT_STORE_ID=bonis`, `WEB_STOREFRONT_SITE_ID=bonis-web`, el token **de envío**, la URL de la API y `WEB_STOREFRONT_ORIGIN=https://bonis.deltanubeweb.com`. Ni el navegador ni el otro extremo reciben el secreto del POS.
4. Validar primero en pruebas: publicar un producto en **Productos → Mostrar en la web**, cambiar su precio de retiro/delivery y verificar la carta. Enviar una solicitud, editar cantidad o nota en **Pedidos → Pedidos web** y confirmar con caja abierta. Verificar un pedido sin cobro y una comanda. Una segunda instalación no autorizada no debe poder leer solicitudes ni publicar.

**Alcance del piloto:** productos simples y variantes vendibles con precio propio. Los productos nuevos no se publican por defecto; ocultarlos no los desactiva en salón. No se publica el precio de salón ni costos internos. Los combos que exigen elegir componentes no se ofrecen en la carta. En delivery el importe de envío se acuerda antes de confirmar. No hay cobro online ni envío automático de WhatsApp.

Configurar en el entorno del **proceso principal** del POS, con valores provisionados por el operador:

```powershell
$env:GASTRONOMY_WEB_ORDERS_URL = 'https://bonis.deltanubeweb.com'
$env:GASTRONOMY_WEB_ORDERS_STORE_ID = 'bonis'
$env:GASTRONOMY_WEB_ORDERS_TOKEN = '<token receive provisionado para esta tienda>'
```

Usar únicamente HTTPS en producción. El servidor vincula el token receive con su tienda y comprueba la identidad `storeId` esperada en cada publicación, incluso si el catálogo está vacío; una discrepancia rechaza la publicación. El token es secreto del POS: no copiarlo al frontend, renderer, logs, documentación, repositorio ni variables accesibles al navegador. No se incluyen contraseñas ni tokens reales en este archivo.

El token receive del POS debe ser distinto y tener alcance sólo a la tienda Bonis; nunca reutilizar un token de otra tienda. El token submit va únicamente en el backend privado del sitio que sirve `bonis.deltanubeweb.com`, con alcance a `siteId=bonis-web`; nunca instalarlo en el POS ni exponerlo en JavaScript del sitio.

El proceso principal agrega el `installationId` del POS (obtenido de `licensing.getStatus().installationId` después de inicializar licencias) como header `X-POS-Installation` en las llamadas autenticadas. En el servidor, asociar el token receive y ese installationId al terminal autorizado de la tienda Bonis. No configurar un ID inventado: debe provenir de la instalación licenciada. Al reemplazar el equipo, actualizar la asociación del terminal junto con la rotación de token; no habilitar ambos IDs a la vez.

## Alta, reemplazo y rotación

1. Emitir/provisionar un token receive limitado a `bonis` y cargarlo en la instalación nueva por un canal seguro de configuración del sistema operativo.
2. Confirmar URL HTTPS, `storeId` y credenciales antes de habilitar el tick del proceso principal. La aplicación no mantiene un timer propio; el main programa los ticks y debe aplicar sus gates de licencia, instalación y respaldo/restauración antes de invocar el conector.
3. Para reemplazar un equipo, detener/deshabilitar sincronización de la instalación anterior antes de habilitar la nueva. No usar dos instalaciones POS de la misma tienda simultáneamente: ambas consumirían el cursor de pedidos/acuse y publicarían catálogos en competencia.
4. Rotar emitiendo un token nuevo y limitado al mismo `storeId`, desplegarlo en la instalación autorizada y revocar el anterior. No pegar valores secretos en tickets ni chats.

## Pedidos y restauración de copias

El POS importa páginas acotadas y persiste cada pedido junto con su cursor antes de enviar el acuse remoto. Si falla la persistencia no hay acuse, por lo que la página puede repetirse. Si falla el acuse, la copia durable permite reintentar sin perder el pedido.

Después de restaurar una copia antigua, pueden existir en el servidor pedidos que ya tengan `receivedAt` pero falten en esa copia. No se deben tratar como pedidos nuevos ni incorporarlos silenciosamente: la capa de persistencia los registra como `REVIEW_RESTORE`, de sólo lectura, para reconciliación manual. La sincronización del resto continúa; reconciliar esos pedidos antes de procesarlos operativamente.

El acuse remoto sólo acredita recepción. Si la copia contiene solicitudes pendientes que el local pudo haber confirmado **después** de esa copia, revisar comandas y ventas de ese período antes de volver a confirmarlas. La carta del servidor es la última publicación confirmada mientras el POS esté sin conexión; las ventas locales no necesitan acceso a la web.

El conector no realiza cambios de licencia, backup, restore ni instalación; esos permisos deben verificarse en el proceso principal antes de llamar `run()`.
