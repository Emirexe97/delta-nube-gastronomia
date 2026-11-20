# HTTPS listo; actualización automática pendiente

El 2026-11-16 se habilitó `actualizaciones.deltanubeweb.com` en el Caddy existente. **Sólo se habilitó el transporte HTTPS**: raíz vacía, sin manifiesto, sin claves, sin instaladores nuevos y con `apps/desktop-shell/updates-config.json` en `enabled: false`.

## Verificación

| Control | Resultado |
|---|---|
| DNS | A `145.223.121.144`, TTL 300; Hostinger autoritativo y 1.1.1.1 |
| Certificado | Let's Encrypt YE1, CN correcto; vencimiento observado 2027-02-14 12:06:15 UTC |
| TLS externo | TLS 1.3 con validación de cadena/nombre normal, sin omitir controles |
| HTTP | 308 hacia HTTPS |
| Caddy | Configuración completa adaptada/validada; reload sin restart; inode 524860 preservado |
| Rutas previas | Comparación de JSON adaptado preserva rutas, salvo renumeración biyectiva de grupos internos; nuevo host añadido a TLS y exclusión de log existente |
| Pruebas negativas | 11/11: raíz, manifiesto ausente, latest.yml, directorio, exe ausente, blockmap, txt, traversal literal/codificado, /updates/ y /.env: 404 y no-store |
| Descarga real | Pendiente: no se publicó contenido ficticio ni se probó una actualización real |
| Instaladores manuales | Árbol existente `gastronomy/0.1.37` intacto |

Un 404 en `release.json` es **esperado** mientras no exista una publicación firmada válida. No significa fallo de TLS. La caché inmutable sólo aplica a ejecutables servidos con status 2xx/304; los ausentes no deben quedar cacheados durante un año. Se detectó y corrigió ese comportamiento durante la prueba inicial.

### Servicios existentes

Antes y después: POS y staging raíz 302; portal Gastronomía y `/waiter` de Pedidos 200. Los endpoints `/health` de `licencias.gastronomia.deltanubeweb.com` y `mozos.gastronomia.deltanubeweb.com` dieron **502 en ambas mediciones**: incidente previo al cambio, no corregido en este alcance. Los contenedores reportaron los mismos estados healthy y no fueron reiniciados.

## Respaldo y reversión

- Archivo activo: `/opt/pos/delta-nube-pos/docker/Caddyfile`.
- Respaldo anterior al despliegue: `/home/deploy/update-hosting-backups/20261116T130443Z/Caddyfile.before` (directorio 700, archivo 600).
- SHA-256 inicial: `0cc9b4a60fc63a58779bb0f585eac2658ce4e16a68ebc7e8e89df2f101eaf1bd`.
- SHA-256 final: `3fab6e1acd6afea0048823ea4a6ee37b478095cbfaad2977e3570b59460965d9`.
- Para revertir, primero comprobar cambios posteriores. Restaurar contenido del respaldo **sobre el mismo inode**, validar el archivo montado y recargar Caddy; nunca reemplazar por rename ni reiniciar servicios como sustituto. No se ejecutó rollback porque las verificaciones del cambio fueron satisfactorias.

## Límites y seguimiento

1. Implementar/verificar canal Ed25519 según el [diseño](WINDOWS_OWN_SIGNATURE_UPDATE_DESIGN.md); definir custodia y recuperación de clave antes de generar claves reales.
2. Publicar sólo con autorización de release y validar descarga e instalación N→N+1, conservando datos y licencia. Mac sigue manual; Authenticode pendiente.
3. Revisar los dos 502 del piloto por separado.
4. Incidente informado al usuario: una consulta SSH con quoting anidado incorrecto ejecutó `printenv` sin el filtro previsto y mostró variables sensibles del contenedor en la salida de herramientas. **No se copian valores a este informe ni a las evidencias.** Coordinar rotación de credenciales afectadas y revisar la herencia innecesaria de secretos en el edge; no se rotaron automáticamente para evitar interrupciones.
5. La raíz compartida también tiene rutas públicas preexistentes en otros hosts. La allowlist de este hostname no hace privados los archivos colocados allí: sólo publicar artefactos públicos, nunca secretos ni symlinks.

No hubo cambios de runtime, typecheck/build de aplicación, commit, push, incremento de versión ni generación de instaladores. Las validaciones correspondientes a este cambio fueron las de Caddy y las pruebas HTTPS; no sustituyen las pruebas futuras del actualizador.

## Evidencia

- `evidence/update-hosting-20261116/https-deploy.txt`: validación inicial, respaldo e inode.
- `evidence/update-hosting-20261116/https-verification.txt`: certificado y pruebas iniciales (antes del ajuste de caché; no usar como estado final).
- `evidence/update-hosting-20261116/https-cache-fix.txt` y `https-cache-default.txt`: ajustes validados de caché.
- `evidence/update-hosting-20261116/https-final-verification.txt`: pruebas finales sobre configuración corregida.

Referencias: [Caddy HTTPS automático](https://caddyserver.com/docs/automatic-https), [validación y reload](https://caddyserver.com/docs/command-line), [headers condicionales por status](https://caddyserver.com/docs/caddyfile/directives/header).
