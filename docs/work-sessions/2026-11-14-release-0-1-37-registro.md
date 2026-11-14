# Entrega 0.1.37 — registro sin tarjeta y autorización PIN

## Alcance autorizado

El usuario autorizó generar y subir los instaladores y luego confirmó «Autorizar entrega completa validada» para commit/push y compilación macOS. Incluye registro/trial/subdominio y la mejora de PIN ya validada en la sesión paralela. No incluye carpetas locales `.codex-*`, secretos, bases ni artefactos generados.

## Comportamiento

- Alta email-first, recuperación y descargas configurables; 30 días exactos desde primer ingreso exitoso desktop, sin tarjeta ni gracia de trial.
- Subdominio con vencimiento firmado y extensión al renovar; cuentas y sitios anteriores conservan compatibilidad.
- Autorización PIN asíncrona por comando, sin caché global ni pasos adicionales; guardas de turno y feedback en Caja/Finanzas.
- Runtime Docker incluye explícitamente Nodemailer 10.5.0 fijado en lockfile.

## Validación local de entrega

- Typecheck y build generales aprobados.
- Servicio licencias: 65/65 aprobadas, incluida prueba de packaging.
- E2E de registro, cuentas anteriores, recorrido real web→Electron→subdominio→offline y autorización PIN: 14/14 aprobadas.
- Pruebas desktop aprobadas; arranque Windows empaquetado en perfil temporal verificado, crea SQLite sin usar perfil real.
- Windows x64 NSIS: `apps/desktop-shell/release/Delta Nube Gastronomía Setup 0.1.37.exe`, 99.921.067 bytes, SHA256 `757929F3079E8A81787D7ADE1297A48237BD08531378640799B14CB906B8B20D`.
- Authenticode **NotSigned**. Distribución manual, updater deshabilitado. No afirmar actualización automática ni confianza de editor.

## Publicación pendiente en este corte

El correo apunta a Hostinger según MX/SPF/DKIM públicos, pero el acceso delegado de Diego no muestra casillas y aún no se obtuvo credencial SMTP. También hay registros DNS de Resend; no prueban credenciales ni entrega real. No se modificó el DNS.

La habilitación del registro exige envío verificado y despliegue coordinado licencias/Pedidos. No confundir la publicación de instaladores con alta pública operativa. Mac se compila con el workflow nativo desde el SHA publicado; firma ad-hoc, no notarización. Registrar run y rutas al terminar.

## Reversión

- Registro: apagar opt-in; no borrar cuentas, licencias ni historial de trial.
- No volver a cliente/servicio Pedidos anterior ignorando vigencia del trial.
- Descargas: rutas versionadas, sin reemplazar instaladores antiguos ni feed automático; configuración edge respaldada antes de recarga validada.
- PIN: ver la unidad y reversión en `2026-11-14-pin-movimientos-responsivo.md`.
