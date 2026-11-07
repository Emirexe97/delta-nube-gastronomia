# Piloto local: cuenta de correo/contraseña y Modo Mozo

Este procedimiento levanta una instancia **desechable y aislada** de la caja en esta PC. No configura ni consulta el VPS, no usa credenciales de producción y no altera el perfil habitual de la aplicación.

## Requisitos

- Windows con Node.js 24, dependencias del repositorio instaladas y los builds de `licensing-service`, `orders-service` y `desktop-shell` disponibles.
- Ejecutar desde la raíz del repositorio: `node scripts/local-pilot.mjs`.
- Opcionales: `--business="Nombre ficticio"`, `--auto-login` (escribe los datos generados en el formulario real de activación) o `--lan-ip=192.168.x.x` para el teléfono en la misma Wi-Fi. La IP debe ser privada y pertenecer a esta PC. El launcher genera un correo `@example.test` y una contraseña al azar; nunca acepta secretos en argumentos de consola.

El launcher crea una autoridad Ed25519 efímera, un comercio/licencia/cuenta ficticios y bases SQLite propias dentro de un directorio `gastronomy-local-pilot-*` de `%TEMP%`. Las credenciales están en `CUENTA_LOCAL.txt` dentro de ese perfil, con permisos de archivo restrictivos cuando el sistema operativo los admite. **No reutilices esas credenciales.** El perfil se conserva al salir para que puedas revisar capturas; bórralo manualmente cuando ya no lo necesites. La autoridad y sus claves solo viven en memoria durante esa ejecución: el perfil guardado no permite reactivar la cuenta tras cerrar el launcher.

La aplicación se abre con un `userData` distinto del perfil normal. Licencias escuchan únicamente en `127.0.0.1` con puerto efímero; pedidos en `127.0.0.1:8098` para permitir un forward HTTPS previamente configurado. No se cambia `licensing-config.json` empaquetado. En la pantalla de activación, completa **Correo de la cuenta** y **Contraseña de la cuenta**, y pulsa **Ingresar y activar este equipo** usando los valores de `CUENTA_LOCAL.txt`. Debe activarse contra la autoridad temporal de esta prueba, no contra la licencia de desarrollo.

## Probar Mozo desde el teléfono

Sin opciones, el QR/Modo Mozo es **solo para navegador en esta PC**: una URL loopback no es accesible desde el teléfono. Para la prueba telefónica en la misma Wi-Fi, inicia con `--lan-ip=<IPv4-LAN-de-esta-PC>`. El launcher genera un certificado HTTPS autofirmado para el IP exacto, no lo instala ni confía en él globalmente, y publica solo el HTML `/waiter` y las rutas móviles de pairing/RPC/receipt; rechaza `/health`, rutas administrativas y `/v1/waiter/terminal/*`. En el teléfono, abre `https://<IP>:8443/waiter` y acepta la advertencia **solo para esta prueba local ficticia**; no ingreses contraseñas reales ni reutilices ese certificado. No modifica firewall. Para `--waiter-url`, solo se permite HTTPS de una ruta externa preparada por el usuario.

Después de activar (manual o con `--auto-login`), el launcher crea en ese perfil una mesa 88, el mozo `Mozo piloto` (PIN `5731`) y dos productos ficticios. No salta la pantalla real de inicio de sesión ni aprueba equipos directamente. Luego configura y prueba la impresora simulada desde **Configuración → Comanda de cocina**, guarda el perfil y genera el QR desde **Configuración → Modo Mozo**. El listener de pedidos permanece en loopback `127.0.0.1:8098`; en modo LAN, solo el proxy HTTPS queda enlazado al IP LAN especificado.

## Impresión

La impresión está simulada de forma predeterminada. No se envían trabajos a impresoras físicas; las capturas se guardan como `simulated-printer.jsonl` en el perfil. No hay opción de impresión física habilitada por este piloto.

## Límites de validación

Esta es una prueba manual de desarrollo, no una instalación/distribución soportada ni una actualización de producción. El correo es ficticio, la licencia solo existe en la autoridad local efímera y los datos quedan en el perfil temporal. La conectividad móvil depende de la misma Wi-Fi y de que el teléfono permita continuar ante el certificado autofirmado; el launcher no modifica el firewall. Cerrar la ventana detiene los servidores, pero conserva los archivos de prueba.
