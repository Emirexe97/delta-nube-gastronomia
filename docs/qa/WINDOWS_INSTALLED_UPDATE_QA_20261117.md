# Actualización instalada Windows x64: 98.0.1 → 98.0.2 aprobada

El POS empaquetado de prueba descargó el segundo instalador NSIS por HTTPS local, autenticó el manifiesto Ed25519 y arrancó el instalador real. Windows abrió la versión 98.0.2 con `--updated` en la **misma ruta y el mismo perfil**. El canal de clientes sigue deshabilitado: no se tocó producción.

| Comprobación | Resultado |
|---|---|
| Identidad de la instalación | `DeltaNubeQA-bc913602`; registro por usuario con GUID exclusivo, sin registro HKLM. |
| Descarga | Un manifiesto y una descarga de 99.742.295 bytes; verificación de tamaño y SHA-512. |
| Permiso de salida | Caja abierta: rechazo antes del diálogo. Caja cerrada y cancelación: READY y ningún reinicio. Caja cerrada y confirmación: lanzamiento real. |
| Datos | Mismo ID, código y nombre del producto; mismo cierre de caja y monto contado de 1.234 unidades menores. |
| Licencia | La misma licencia de prueba firmada siguió ACTIVE y operativa, con el mismo identificador de instalación y el mismo token persistido. No se reactivó ni se renovó. |
| Limpieza | Se desinstaló sólo la aplicación de prueba y se verificó la eliminación de su clave de instalación en HKCU; se conservaron archivos y pruebas. |

## Instaladores y evidencia

- Instaladores y copia del recibo: `apps/desktop-shell/release/qa-ed25519-20261117` (salida local ignorada por Git).
- `DeltaNubeQA-bc913602-Setup-98.0.1.exe`: SHA-256 `3448a788923c3820b33d0b0f86f6bcb9e7415fa8113fe03d29bb59b7f6d0797d`.
- `DeltaNubeQA-bc913602-Setup-98.0.2.exe`: SHA-256 `462838595d3fd2af169c7f3683ed314e0edefbbb8cc1f16087afad848621c96d`.
- [Recibo de la prueba](evidence/windows-installed-update-20261117/resultado.json) y [checkpoint](evidence/windows-installed-update-20261117/checkpoint.json). No contienen la clave privada ni el token de licencia.
- Reproducción: `node scripts/qa-windows-installed-update.mjs --isolated-install`, con el renderer compilado, los módulos nativos compatibles con Electron y la herramienta OpenSSL local. Cada ejecución crea nueva identidad, puerto, claves y carpeta. No redistribuir los instaladores: el perfil, ruta y feed fueron fijados al laboratorio.

## Qué se probó y qué no

- En Windows 11 Home, el aislamiento fue por **identidad, registro, carpeta, perfil y servicios en loopback**. No fue una máquina virtual. Las copias de código de la prueba rechazaron servicios externos y su arranque fuera de la ruta temporal prevista. No se cambió el código de producción, la versión oficial ni la configuración deshabilitada.
- La prueba controló la respuesta del diálogo en Electron y usó una macro de NSIS sólo de QA para omitir el asistente visual. El IPC, la admisión de caja, HTTPS, Ed25519, la reverificación Win32, la sustitución de archivos y el arranque de la nueva versión fueron reales. No se modificaron ni desactivaron las protecciones de Windows.
- Antes de activar el canal para clientes falta custodiar la clave de firma real, validar el instalador de distribución y sus políticas de Windows, y autorizar la publicación piloto. El pase local prueba el mecanismo, no constituye una publicación.
