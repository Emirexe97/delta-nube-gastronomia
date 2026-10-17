# 2026-10-17 — Versión 0.1.26: detalle de egresos en el ticket de caja

El usuario solicitó versión 0.1.26, commit/push, instaladores Windows y Mac, publicación y actualización de esta PC.

## Cambio

- El ticket de caja y su vista previa incluyen siempre el detalle de las salidas de efectivo del turno: tipo, concepto registrado, importe, fecha y hora de Buenos Aires.
- Incluye gastos, pagos vinculados a envíos/rendiciones, retiros, devoluciones y ajustes de salida. Identifica anulaciones, conserva los registros originales y no modifica los totales del arqueo.
- Usa los movimientos completos de la sesión aunque se filtren las ventas. Los históricos sin detalle muestran un aviso; no se inventan conceptos. No se incluyen movimientos que no afecten efectivo.
- Conceptos escapados en HTML, con ajuste de línea para tickets de 58 y 80 mm.
- Versión coherente en el manifest raíz y el shell: 0.1.26. No cambia identidad de aplicación, base de datos ni licencia.

## Validación de fuente

- Dominio: 41 pruebas aprobadas.
- Ticket: 8 pruebas aprobadas, incluido render de conceptos extensos y comprobación de ancho/solapamiento en 58 y 80 mm. Captura de 58 mm revisada.
- Typecheck y build de dominio, web y shell aprobados. Después del cambio de versión se recompiló el shell.
- Suite desktop: 76 pruebas aprobadas.
- Los archivos de evidencia, bases, instaladores y el respaldo local ajeno a esta entrega se mantienen fuera del commit.

## Distribución e instalación

- El usuario confirmó que no dispone de certificado Authenticode. `updates-config.json` permanece deshabilitado. No se habilita ni se considera validado el canal automático: requiere firma, feed HTTPS configurado y un ensayo real entre versiones.
- Se preparan instaladores manuales y publicación de descarga en GitHub Releases. Mac conserva el workflow arm64/x64 con firma ad-hoc y verificaciones dentro del DMG; no equivale a notarización ni prueba física de impresión.
- Antes de instalar se detectó caja #33 del 17/10 abierta; se informó al usuario que la actualización de esta PC espera el cierre real del turno. No se cierra caja ni se cambian movimientos desde herramientas.
- La instalación requiere respaldo consistente nuevo, comprobación de integridad, comparación de datos antes/después, versión instalada y licencia operativa. Estado y hashes finales se registrarán al completar esas etapas.

## Artefactos verificados

- Fuente: `da71b51d5cd5295cc27a3b48357457c5e99d7afa`, etiqueta `v0.1.26`, publicadas en origin.
- Windows x64 NSIS: `apps/desktop-shell/release/Delta Nube Gastronomía Setup 0.1.26.exe`, 97.923.411 bytes. SHA256 `56D967FC2C2D6B36FA507AA3D81709B6302E4D5F4D48AADAE304EF216C785222`. Versión 0.1.26, Authenticode `NotSigned`: distribución manual, no candidato al updater firmado.
- El paquete Windows real arrancó con `isPackaged=true`, versión 0.1.26 y un perfil temporal aislado, usando una copia SQLite consistente. Integridad correcta y las 49 tablas sin cambios tras el inicio/migración. Ticket y vista previa nuevos presentes en ASAR. El perfil de prueba sin licencia devuelve `UNACTIVATED`, `canOperate=false`; no se copió ni alteró la licencia operativa.
- [CI Mac 39068935566](https://github.com/Emirexe97/delta-nube-gastronomia/actions/runs/39068935566): arm64 y x64 exitosos desde la etiqueta y commit indicados. Verificaciones de DMG, arquitectura SQLite, firma ad-hoc, licencia ASAR y arranque del paquete aprobadas en CI.
- Ambos ZIP descargados tienen tamaño y SHA256 coincidentes con los metadatos de GitHub Actions. Carpeta Mac absoluta: `C:\Users\Bonis\Documents\ChatGPT\Delta Nube Gastronomía\apps\desktop-shell\release\mac-build\run-39068935566`.
- DMG arm64: `arm64/Delta-Nube-Gastronomia-0.1.26-arm64.dmg`, SHA256 `88E37E53AE77BF588941F165D9FAFD303EAC518DD83A079EF1ADA689B0E505ED`.
- DMG x64: `x64/Delta-Nube-Gastronomia-0.1.26-x64.dmg`, SHA256 `0F41ABA2AE3B9973E3E5164C89ED049E2EBBB4F749DA2EE8FE13575F00BA3503`.
- La evidencia privada de este release permanece en `apps/desktop-shell/release/qa-0.1.26/`, ignorada por Git. La copia de prueba queda fuera del repositorio; no reemplaza el respaldo final previo a instalar.

## Publicación y estado previo a instalar

- [Release 0.1.26 publicado](https://github.com/Emirexe97/delta-nube-gastronomia/releases/tag/v0.1.26), con EXE Windows x64, DMG arm64/x64 y `SHA256SUMS.txt`. Los hashes de cada asset almacenado por GitHub coinciden con los archivos locales.
- Descargas públicas sin credenciales verificadas en los tres instaladores: respuestas HTTP 206 a solicitudes de rango, tamaño total y hash del servidor correctos; cabecera ejecutable Windows correcta. Se resolvieron las URL definitivas tras salir del estado borrador.
- Actualización automática **no activada**: el usuario confirmó que no tiene certificado Authenticode. No se publican metadatos `latest.yml` que anuncien instaladores sin firma como actualización automática.
- Una nueva comprobación de la base operativa, posterior a la publicación, conserva integridad correcta y encuentra la caja #33 del 17/10 abierta. **Instalación en esta PC pendiente de cierre real del turno**; no se ejecutó el instalador ni se interrumpió la aplicación 0.1.25 aprobada.
- Al reanudar: comprobar nuevamente que no haya caja abierta, generar y validar un respaldo consistente nuevo del cierre, instalar el EXE de hash registrado y verificar versión 0.1.26, conservación de datos/licencia y operación. La prueba aislada del paquete no sustituye esa aprobación de instalación.

## Instalación Windows aprobada — 2026-10-17

- Posteriormente el usuario preguntó por una instalación que conservara la caja abierta. Tras explicar la pausa de operaciones, cierre del programa, respaldo y verificación, respondió «adelante». Esa instrucción autoriza la excepción manual en este equipo; no modifica el requisito de caja cerrada del updater ni lo habilita.
- Se cerró normalmente la aplicación y se hizo un respaldo SQLite consistente nuevo con integridad y coincidencia de las 49 tablas comprobadas: `C:\Users\Bonis\AppData\Local\DeltaNubeBackups\antes-instalar-0.1.26-2026-10-17T21-27-12-555Z\gastronomy.sqlite`. Se conservaron también copias locales de los archivos de licencia e identidad cifrada, fuera de Git.
- SHA256 del instalador verificado contra el artefacto publicado; instalación NSIS manual silenciosa, salida 0. Ejecutable instalado: `C:\Users\Bonis\AppData\Local\Programs\@gastronomydesktop-shell\Delta Nube Gastronomía.exe`, versión 0.1.26.0. ASAR instalado idéntico al paquete verificado e incluye el nuevo ticket y vista previa.
- Después de instalar y antes de volver a iniciar, las **49 tablas coincidían exactamente con el respaldo**, incluida la caja abierta. No se cerraron sesiones, registraron cobros ni cambiaron movimientos como parte de la instalación.
- El primer arranque de comprobación quedó oculto; se reinició para mostrar normalmente la aplicación. Después del arranque visible se observó caja #33 abierta con el mismo estado. El usuario retomó la operación; se dejó de navegar para no interferir.
- Comprobación final de solo lectura: integridad correcta y coincidencia de `cash_sessions`, `cash_movements`, `payments`, `payment_refunds` y `delivery_ledger` con el respaldo. Las tablas de pedidos, impresiones y eventos ya podían reflejar la actividad retomada por el usuario; no se afirma que toda la base permaneciera congelada tras reanudar el trabajo.
- Licencia persistida con firma Ed25519 válida y vinculada a la misma instalación. Identidad del equipo y clave cifrada sin cambios, inscripción `APPROVED`, licencia `ACTIVE`, `canOperate=true`, verificación online registrada después del arranque. No requirió una nueva habilitación del propietario.
- **Windows 0.1.26 instalada, verificada y aprobada para trabajar**, con caja abierta preservada por autorización del usuario. Evidencia local ignorada: `installation-receipt.json`, `installed-before-start.json`, `installed-after-start.json`, comprobaciones de licencia y `work-approval.json` dentro de `apps/desktop-shell/release/qa-0.1.26/`.
- El canal automático permanece deshabilitado por falta de Authenticode y ensayo real firmado. No se cambió la distribución manual Mac ni se regeneraron instaladores durante esta instalación.
