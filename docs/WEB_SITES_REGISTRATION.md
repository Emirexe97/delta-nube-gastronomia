# Alta automática de la web de pedidos

Cada **comercio** tiene una carta y un POS receptor. En el alta de licencia se eligen el subdominio y el WhatsApp. Cuando el equipo recibe la aprobación del negocio, registra la tienda sin crear un proyecto aparte, copiar tokens ni dar de alta DNS por cliente. Abrir sesión o crear otro empleado **no** crea otra tienda.

## Lo que ve el comercio

La [portada pública, la carta de ejemplo y la ayuda](GASTRONOMIA_PORTADA.md) no son un formulario de registro. El alta del comercio se hace en el POS.

1. En **Configuración → Licencia**, escribir el nombre del negocio. «Crear mi página de pedidos» viene marcado: el POS propone un subdominio (por ejemplo, `bonis`), el responsable puede cambiarlo y completa el WhatsApp con código de país. Si todavía no quiere web, desmarca la opción. Con una instalación ya aprobada mediante el registro seguro, puede iniciar el alta más adelante en **Configuración → Página web**.
2. Una vez aprobada la instalación, con conexión se asigna la dirección. Si el nombre está ocupado, elegir otro. Reintentar el mismo alta no crea una segunda tienda. Un POS con licencia antigua por código necesita vincular su identidad segura a la licencia existente: no se transfiere una web sólo porque coincidan los nombres.
3. **Productos → Mostrar en la web** publica los artículos elegidos y sus precios de retiro y delivery. Sin productos publicados la carta queda vacía. El cliente envía una solicitud; el local puede editarla en **Pedidos → Pedidos web** antes de confirmar. La web no cobra ni confirma en nombre del local.
4. Con la web activa, desde **Página web** se puede **Abrir carta** en el navegador, **Copiar enlace** o **Descargar QR** como PNG para imprimir o compartir.

| Quién | Qué puede cambiar |
|---|---|
| Responsable con permiso de configuración | Nombre visible, descripción breve y color del diseño estándar. No se admite HTML/CSS/JS del comercio. |
| Dueño/desarrollador de Delta Nube | Asignar un diseño propio versionado al comercio sin interrumpir catálogo ni pedidos. En este modo el comercio no puede sobrescribir el diseño. |

## Preparación de infraestructura (una vez por plataforma)

Esta guía no activa servicios. **Probar primero en una zona de pruebas y con una licencia piloto.**

- **Dominio y TLS:** inventariar subdominios existentes, en particular `gastronomia` (licencias), y conservar sus registros y rutas exactos. Configurar el comodín `*.deltanubeweb.com` hacia el proxy de tiendas, con certificado que cubra el comodín y renovación probada. Si se usa Let's Encrypt, [DNS-01 admite certificados comodín](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge); la clave del proveedor DNS no debe ir en el POS.
- **Pedidos:** compilar `pnpm --filter @gastronomy/orders-service... build`. El [Compose de pedidos](../docker/web-sites/compose.yml) usa los artefactos compilados, volumen SQLite persistente y puerto privado. Configurar `WEB_SITE_BASE_DOMAIN=deltanubeweb.com`, `WEB_SITE_SECRET_PATH` (archivo externo legible por el servicio) y `WEB_SITE_RESERVED_SLUGS` (otros nombres existentes o que no se deban vender, separados por comas). No hace falta inventar un comercio en un JSON; si ya existen comercios manuales, conservar su base y su `WEB_ORDERS_CONFIG_FILE`. No arrancar una base nueva encima de un piloto existente.
- **Licencias:** compilar `pnpm --filter @gastronomy/licensing-service... build`. Incorporar el [override optativo](../docker/licensing/web-sites.override.yml) **además de** la configuración y el panel existentes. Montar el mismo secreto aleatorio de al menos 32 bytes en ambos servicios (`WEB_SITE_PROVISION_SECRET_FILE`). No usar la contraseña del dueño, el token administrativo ni la clave de firma de licencias. No copiar secretos a Git, al navegador, al instalador ni a esta guía.
- **Proxy:** el [ejemplo Caddy](../docker/web-sites/Caddyfile.example) separa `pedidos.deltanubeweb.com` (API privada por credenciales) de las páginas de clientes. Preservar el Host original; no confiar en `X-Forwarded-Host`. Mantener privadas la base y la herramienta de diseño. Excluir del comodín todos los servicios existentes con rutas explícitas. Si Caddy corre en un contenedor, usar la red privada/alias del servicio en lugar del loopback del ejemplo. Validar la configuración completa antes de recargar el proxy.
- **POS:** referencia global de API `https://pedidos.deltanubeweb.com`; para un piloto se puede reemplazar con `GASTRONOMY_WEB_PROVISION_URL`. El cliente de pedidos público nunca recibe el token del POS. No mezclar un alta automática con las variables manuales `GASTRONOMY_WEB_ORDERS_*`: [procedimiento del piloto manual](WEB_COMMERCE_POS.md).

## Diseño exclusivo (operador)

Con acceso privado al servicio, identificar el comercio en `tenant_sites` por su **slug** y comprobar su `store_id` (no adivinarlo). En el contenedor, con su volumen montado:

```sh
node /app/apps/orders-service/dist/tenant-registry.js /data/orders.sqlite <store_id> CUSTOM midnight-market-v1
node /app/apps/orders-service/dist/tenant-registry.js /data/orders.sqlite <store_id> STANDARD
```

El primer comando activa una plantilla incluida; el segundo devuelve la edición básica al comercio. Para **crear un diseño nuevo**, agregar una plantilla del desarrollador, probar el checkout y distribuir el servicio web; no se edita el POS de cada cliente. Ver [plantillas](TENANT_STOREFRONT_TEMPLATES.md).

## Comprobación antes de habilitar altas reales

1. Respaldar ambas bases de manera consistente (incluido el WAL si corresponde) y verificar que se pueden restaurar. Probar que los hosts preexistentes siguen funcionando independientemente del comodín.
2. Elegir un nombre libre en un equipo de prueba. Antes de la aprobación la URL no sirve ninguna carta; después muestra **sólo esa** carta. Verificar el certificado desde un navegador externo, incluso para un subdominio recién elegido.
3. Publicar un producto desde el POS, cambiar el precio y probar un pedido. Verificar edición y confirmación única en la bandeja. Repetir con un segundo comercio: no debe poder acceder al catálogo privado, modificar el diseño ni recibir los pedidos del primero.
4. Reiniciar POS y servicios, probar reconexión, nombre ocupado, cambio STANDARD/CUSTOM y recuperación de las credenciales del equipo. Una reinstalación o cambio de equipo **no** reasigna automáticamente una tienda existente.
5. Para pausar nuevas altas, dejar de emitir tickets en licencias; los ya emitidos caducan en cinco minutos. No borrar el volumen de pedidos ni la tabla de comercios. El ticket autoriza el **alta**, no es una suscripción de hosting: la suspensión posterior de una licencia no despublica automáticamente la página. Planificar cualquier baja del servicio de pedidos por separado.
