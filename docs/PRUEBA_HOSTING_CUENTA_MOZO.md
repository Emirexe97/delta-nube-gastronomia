# Piloto alojado con cuenta de licencia y Mozo

## Estado

La ruta de licencia para un piloto alojado exige un opt-in explícito y origen HTTPS coincidente con la configuración privada. Además, en ese modo queda deshabilitado el sincronizador de comercio web: no publica el catálogo local ni consulta/acknowledgea pedidos web. Esta protección cubre también el reintento manual y el descubrimiento de tienda del sincronizador. El relay Mozo continúa separado y puede usar su configuración explícita.

El hosting compartido quedó descartado para esta prueba por NPROC 108/120 y fallas al límite 120. Después de auditar capacidad, el usuario autorizó explícitamente **dos servicios nuevos y limitados en el VPS**, sin modificar el POS ni sus licencias. El 06-11-2026 quedaron publicados por HTTPS `https://licencias.gastronomia.deltanubeweb.com` y `https://mozos.gastronomia.deltanubeweb.com`, con cuenta, claves y bases ficticias separadas. La autorización es sólo para esos servicios nuevos: no habilita usar autoridades, cuentas o catálogos de producción. Ver el registro operativo `docs/work-sessions/2026-11-06-piloto-vps-cuenta-mozo.md`.

`scripts/hosted-pilot.mjs` es el lanzador E2E automatizado. Para una sesión operada por una persona o CUA, `scripts/hosted-pilot-manual.mjs` prepara el mismo perfil aislado y simulación de impresora, pero **no ingresa la cuenta ni opera controles**: la configuración se hace mediante la interfaz.

## Preparación privada y ejecución

Guardar un archivo JSON fuera del repositorio y de cualquier raíz pública. No guardarlo en el árbol web publicado. No pasar credenciales ni tokens en argumentos de consola.

```json
{
  "licenseOrigin": "https://<origen-licencias-hostinger-de-prueba>",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n<clave-publica-ed25519>\n-----END PUBLIC KEY-----\n",
  "accountEmail": "<cuenta-ficticia-preparada>",
  "accountPassword": "<secreto-privado>",
  "ordersOrigin": "https://<origen-pedidos-hostinger-de-prueba>",
  "storeId": "<tienda-de-prueba-autorizada>",
  "receiveToken": "<token-receptor-privado-de-prueba>",
  "installationId": "<identificador-exclusivo-de-esta-pc>"
}
```

Ambos orígenes deben ser HTTPS DNS públicos exactos sin ruta, credenciales, query ni fragmento; se rechazan IPs y nombres loopback/locales. Preparar previamente una cuenta ficticia y una licencia nueva de prueba en el servicio de licencias autorizado. La contraseña debe cumplir 15–128 caracteres y máximo 512 bytes UTF-8. El lanzador nunca crea cuentas, compra otra licencia, solicita una tienda ni provisiona servicios; intenta la activación de esa cuenta mediante la UI real y aborta si falla o no es compatible. El archivo sólo se acepta si está fuera del repositorio. El lanzador no imprime secretos, usa un perfil temporal nuevo y conserva allí la evidencia.

Ejecutar desde la raíz del repositorio, proporcionando sólo la ruta absoluta al JSON:

```powershell
node scripts/hosted-pilot.mjs --config="C:\ruta\privada\hosted-pilot.json"
```

No detener ningún otro piloto activo. Los servicios nuevos del VPS ya existen: no repetir su aprovisionamiento al relanzar la PC. El lanzador manual se ejecuta con el mismo argumento `--config` y conserva su perfil local independiente.

## Alcance de la prueba autorizada

- Perfil temporal independiente y evidencia conservada localmente; nunca reutilizar el perfil real del negocio.
- Cuenta/licencia ficticia preparada y autorizada, ingresada mediante la UI real; acceso exclusivo desde la PC autorizada.
- Alta de mesa, mozo y productos únicamente en la base SQLite del perfil aislado.
- Impresión simulada, sin enviar papel a impresoras reales.
- Validar acceso celular por la URL Mozo HTTPS configurada explícitamente. No asumir que el QR funciona en datos móviles hasta probarlo desde la red celular.
- Usar únicamente los dos servicios nuevos del VPS aprobados; nunca endpoints de catálogo ni configuración de producción por valores predeterminados o fallback.

## Protección de catálogo

La aplicación normalmente sincroniza el catálogo si se configuran `GASTRONOMY_WEB_ORDERS_URL`, `GASTRONOMY_WEB_ORDERS_TOKEN` y `GASTRONOMY_WEB_ORDERS_STORE_ID`. El modo de piloto alojado validado desactiva esa ruta de publicación/consulta incluso ante reintentos manuales, para que crear productos de prueba no escriba en un catálogo remoto. No configurar esas variables a menos que exista una decisión explícita y revisada para un sistema de pruebas separado.

La prueba deberá demostrar el QR desde un teléfono por datos móviles, registrar URL/orígenes usados sin guardar secretos en evidencia, y confirmar que la impresión es simulada. La publicación del servicio no migra automáticamente los clientes instalados ni acredita por sí sola la prueba física del teléfono.
