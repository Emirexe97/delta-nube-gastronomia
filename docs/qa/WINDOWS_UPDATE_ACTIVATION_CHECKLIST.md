# Checklist de activación del updater Windows

**2026-11-16:** Authenticode queda pendiente por decisión del usuario. Este checklist y su script validan únicamente el canal Authenticode existente. La [alternativa de firma propia](WINDOWS_OWN_SIGNATURE_UPDATE_DESIGN.md) está en diseño; no se debe aprobar con este preflight ni quitar sus verificaciones para simular compatibilidad.

El preflight local es una barrera previa, no habilita el canal. Ejecutar desde `apps/desktop-shell` en Windows x64, una vez configurados certificado y artefactos:

```powershell
node scripts/verify-windows-update.mjs --config updates-config.json --artifacts .\release
```

El comando es de solo lectura: requiere `enabled: true`, `target: win32-x64`, feed HTTPS sin credenciales/query/fragmento y `windowsPublisherNames`; valida proveedor/URL/editor de `app-update.yml`, `latest.yml` estable, presencia y confinamiento local de instalador/blockmap, tamaño/SHA-512 del instalador y firma Authenticode/editor esperado usando la regla de coincidencia de `electron-updater` 6.8.9. Lee la configuración empaquetada de `release\win-unpacked\resources\app-update.yml`, no de la raíz de artefactos. El formato habitual de `latest.yml` no declara el blockmap por separado: se verifica el sidecar `<instalador>.blockmap`; se valida su tamaño si existe `blockMapSize`. Si el sidecar no figura por separado en `latest.yml`, el manifiesto no proporciona hash para él: el preflight solo puede verificar existencia, no-vacío y, si se declara, tamaño; no reporta ni inventa hash. Ante cualquier falta, informa un error accionable y termina con código distinto de cero. No cambia config, firma, instala, compila, publica ni verifica el hosting remoto. La URL real todavía debe seleccionarse/configurarse; la firma/certificado también están pendientes.

## Activación — completar manualmente, sin saltar validaciones

- [ ] Resolver la consulta pendiente de certificado: quién aporta/controla el certificado Authenticode y su identidad legal exacta; instalarlo en el almacén de firma de Windows o configurar el mecanismo privado aprobado. No guardar PFX, contraseñas o tokens en el repo.
- [ ] Configurar el feed HTTPS persistente, elegido y controlado por el proyecto; mantener archivos inmutables y metadatos fuera del alcance de modificación de terceros. Sin tokens en el cliente.
- [ ] Preparar JSON de release opt-in para Windows x64, `enabled: true`, feed y publisher; conservar configuración ordinaria deshabilitada y no alterar Mac.
- [ ] Crear release firmada Windows con el proceso aprobado (esto requiere pedido/autorización explícita de crear instalador); verificar ejecutable e instalador con el certificado definitivo.
- [ ] Ejecutar el preflight local anterior sobre el directorio de artefactos. Guardar su salida como evidencia interna.
- [ ] Cargar primero `.exe` y `.blockmap`, luego `latest.yml`; revisar URL estable, HTTPS, `Content-Length`, hash, firma remota y ausencia de redirecciones/credenciales.
- [ ] Probar N→N+1 real con versiones estables crecientes en Windows limpio y actualizar una instalación previa; cubrir búsqueda, descarga, cancelación, error de red/espacio e instalación confirmada con caja cerrada y operaciones bloqueadas mientras corresponda.
- [ ] Solo después de todas las evidencias, aprobar por separado la activación de clientes. El éxito del preflight no demuestra que el updater esté activo ni que el alojamiento sea correcto.

macOS permanece en distribución manual y su updater deshabilitado. Un ensayo local con firma simulada sirve únicamente para unit tests; no es evidencia de certificado ni publicación real.
