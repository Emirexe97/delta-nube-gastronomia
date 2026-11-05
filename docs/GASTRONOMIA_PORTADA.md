# Portada pública y carta del comercio: dos destinos distintos

`gastronomia.deltanubeweb.com` presenta Delta Nube, una carta de demostración ficticia y ayuda operativa. No registra comercios ni acepta pedidos. El local solicita **su propia web** desde la PC ya autorizada; sus clientes van al subdominio del comercio, no a la portada.

| Dirección | Contenido |
|---|---|
| `/` | Portada con accesos a la carta de ejemplo y a la ayuda |
| `/carta-de-ejemplo/` | Carta ilustrativa, sin carrito, pagos, datos personales ni pedidos |
| `/ayuda/` | Cómo solicitar la web, publicar productos, revisar pedidos y compartir |

## Marca compartida con el programa

La barra lateral expandida usa el símbolo a la izquierda y la marca a la derecha. La barra contraída, la pestaña del navegador y los íconos de Windows y Mac usan sólo el símbolo. El POS no descarga la marca de Internet.

Los originales son `simbolo.png` y `marca.png` en `apps/gastronomy-portal/public/portal-assets/`. Después de reemplazarlos, ejecutar desde la raíz `node apps/desktop-shell/scripts/generate-brand-assets.mjs` para actualizar las copias del renderer y los tres recursos nativos (PNG, ICO e ICNS). Comprobar con `node --test apps/desktop-shell/scripts/brand-assets.test.mjs`. Esto no crea una versión ni un instalador.

## Desde el POS

1. Entrar a **Configuración → Página web**. Elegir el nombre de la web y el WhatsApp, y tocar **Solicitar página web**. En el primer registro también se puede pedir desde **Configuración → Licencia**. No hace falta emparejar con un código ni crear una cuenta aparte. El alta respeta la aprobación existente y la disponibilidad del nombre. [Alta y operación del servicio](WEB_SITES_REGISTRATION.md).
2. Cuando la página esté **Activa**, **Abrir carta** usa el navegador predeterminado; **Copiar enlace** copia sólo la dirección pública; **Descargar QR** abre «Guardar como» para elegir dónde guardar la imagen PNG. Si se cancela, no se escribe nada. Funciona con diseño estándar o exclusivo.
3. Imprimir el QR dejando su margen blanco intacto. Apunta a la URL del comercio (no a una captura del menú), por lo que cambiar productos o precios no requiere reimprimirlo. El POS genera la imagen sin enviar datos a un proveedor de QR.

## Probar la portada sin tocar ningún servidor

Desde la raíz del repositorio, por ejemplo con Python en Windows:

```powershell
py -m http.server 8080 --bind 127.0.0.1 --directory apps/gastronomy-portal/public
```

Abrir `http://127.0.0.1:8080/`. No requiere licencia, credenciales ni conexión a la base. Detener con Ctrl+C.

## Estado de producción — 4 de noviembre de 2026

La [portada](https://gastronomia.deltanubeweb.com/), la [carta de ejemplo](https://gastronomia.deltanubeweb.com/carta-de-ejemplo/) y la [ayuda](https://gastronomia.deltanubeweb.com/ayuda/) están publicadas. Esta operación no desplegó el POS, cartas de comercios, DNS ni cambios en la autoridad de licencias.

Release de identidad visual: `portal-20261104T214231Z-b738ad4b` (anterior: `portal-20261104T212724Z-f0946f52`). La cabecera usa los dos elementos originales del logo como piezas independientes: símbolo a la izquierda, marca a la derecha, en una misma línea. El favicon usa sólo el símbolo. La fuente Inter del POS, su aviso OFL y la imagen WebP se sirven desde el propio dominio. El vhost existente importa el fragmento desde `/config/gastronomy-portal/releases/portal-20261104T214231Z-b738ad4b/portal.caddy`, en el volumen persistente del edge; sólo su subdirectorio `public/` se sirve. No eliminar ese volumen al recrear el proxy. El recibo privado de despliegue guarda el respaldo del Caddyfile, el manifiesto y las verificaciones HTTPS.

Para revertir **esta publicación** desde la cuenta de despliegue en el servidor, ejecutar `python3 /home/deploy/gastronomy-portal/operations/portal-20261104T214231Z-b738ad4b/deploy.py rollback`. La reversión restaura la portada anterior, no elimina el sitio. El procedimiento rehúsa sobrescribir un Caddyfile editado posteriormente. En ese caso, revisar el cambio y apuntar solamente el import del portal a la release anterior, preservando el inode del archivo montado; validar y recargar sin reiniciar. Después verificar `/health`, `/manage/` y el bloqueo de `/admin/licenses`.

## Activación optativa en el proxy (operador)

No crear un segundo host con el mismo nombre. **No cambiar el DNS de licencias**, su código, base, claves, puertos ni sus contenedores. No reemplazar el Caddyfile existente con un ejemplo.

1. Copiar únicamente el contenido de [la carpeta pública](../apps/gastronomy-portal/public/) al directorio público del edge. El proceso Caddy necesita lectura de los estáticos y del [fragmento portal.caddy](../docker/gastronomy-portal/portal.caddy). Nunca servir la raíz del repositorio. La raíz estática por defecto es `/srv/gastronomy-portal`; si ya existe un volumen accesible en el proxy se puede usar con `GASTRONOMY_PORTAL_ROOT`. Como alternativa, el [override de sólo lectura](../docker/gastronomy-portal/edge.override.yml) documenta los montajes para el servicio **caddy**; definir las rutas absolutas que pide antes de validar el Compose. No aplicarlo al servicio de licencias. Si requiere recrear el proxy, programarlo explícitamente, no hacerlo en caliente en un sitio en uso.
2. Guardar una copia de la configuración efectiva. **Dentro del bloque existente** de `gastronomia.deltanubeweb.com`, incorporar esta línea sin alterar los manejadores existentes (en una configuración que use orden literal, antes de la ruta que captura todo):

   ```caddyfile
   import /etc/caddy/snippets/gastronomy-portal.caddy
   ```

   Sólo GET/HEAD de las rutas públicas y `/portal-assets/*` entran al servidor de archivos. No hay fallback de aplicación ni proxy a través de JavaScript. `/health`, `/manage/`, `/v1/*`, `/v2/*`, los bloqueos de `/admin*` y demás rutas siguen con sus reglas anteriores.
3. Validar la **configuración completa** con `caddy validate --config <Caddyfile> --adapter caddyfile`; comprobar en staging las tres páginas, los recursos y que el health, panel y restricciones administrativas respondan igual que antes. Sólo después y con autorización recargar el edge. Para revertir, quitar el único `import`, validar y recargar; no hay migración de licencias.

**Prueba automatizada:** con Caddy v2 en PATH (o `CADDY_BIN` como ruta al binario), ejecutar `node --test apps/gastronomy-portal/test/edge.test.mjs`. Levanta dos proxies efímeros en loopback, uno con el bloque existente y otro con la portada, contra una autoridad ficticia. Compara métodos, destinos y respuestas sin usar el dominio ni las credenciales reales. La navegación se prueba con `pnpm exec playwright test tests/e2e/gastronomy-portal.spec.ts`.
