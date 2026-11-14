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

## Publicación y límites

Fuente publicada: `0ae587978428f04231c667c706c6871a7911a1e5` en `main`. Workflow Mac solicitado desde ese SHA: [43602315830](https://github.com/Emirexe97/delta-nube-gastronomia/actions/runs/43602315830).

Windows está publicado en `https://gastronomia.deltanubeweb.com/instaladores/0.1.37/Delta-Nube-Gastronomia-Setup-0.1.37-x64.exe`. Descarga HTTPS completa desde Windows y SHA256 coincidente; `/health` conservó 200. Se agregó únicamente `/instaladores/*` al bloque existente de gastronomía, con validación y recarga Caddy sin reinicio. Backup y recibo: `/home/deploy/gastronomy-licensing/operations/downloads-0.1.37-20261114T135640Z/`. Fragmento versionable: `docker/gastronomy-portal/downloads.caddy`; no importar dos veces si la ruta ya está inline.

Imagen de autoridad `gastronomy-licensing:signup-0ae5879` preparada en `/home/deploy/gastronomy-licensing/releases/signup-0ae5879`, con import real del runtime/SMTP verificado en contenedor efímero sin red y sin datos de producción. **No sustituye todavía al servicio activo**.

El correo apunta a Hostinger según MX/SPF/DKIM públicos, pero el acceso delegado de Diego no muestra casillas y aún no se obtuvo credencial SMTP. También hay registros DNS de Resend; no prueban credenciales ni entrega real. No se modificó el DNS.

La habilitación del registro exige envío verificado y despliegue coordinado licencias/Pedidos. No confundir la publicación de instaladores con alta pública operativa. Mac se compila con el workflow nativo desde el SHA publicado; firma ad-hoc, no notarización. Registrar run y rutas al terminar.

### macOS generado

Run `43602315830`: ambos jobs aprobados desde el SHA indicado; `hdiutil verify`, arquitectura SQLite, firma ad-hoc del paquete dentro del DMG, configuración de licencia y arranque aislado verificados en runners nativos. Updater Mac deshabilitado. No acredita Developer ID, notarización, instalación en una Mac del usuario ni impresión física.

Carpeta absoluta: `C:\Users\Emir\Desktop\IA\POS Módulo Gastronómico\apps\desktop-shell\release\mac-build\run-43602315830`.

| Plataforma | Archivo público bajo `/instaladores/0.1.37/` | Bytes | SHA256 |
|---|---|---:|---|
| Apple Silicon | `Delta-Nube-Gastronomia-0.1.37-arm64.dmg` | 119637899 | `5C68BE1F991738CB719FB3852C0C99303E59E4C14D6F6BA8C1B799BE9A5C293C` |
| Intel | `Delta-Nube-Gastronomia-0.1.37-x64.dmg` | 142627152 | `8D81886BE453CAFFF90A6A87D42A2D20326374FEFB0D4E50269E0F1F6B8C8955` |

Artefactos originales guardados en subcarpetas `arm64` y `x64` (nombre del producto en Unicode NFD); URLs públicas usan nombres ASCII. No se reemplazó una versión anterior ni un feed de actualización.

Publicación de ambos DMG finalizada: descarga HTTPS completa de cada URL desde Windows, tamaño y SHA256 coincidentes con los artefactos de Actions. Los tres instaladores están disponibles; el registro público sigue pendiente del correo real y del despliegue coordinado de servicios.

## Reversión

- Registro: apagar opt-in; no borrar cuentas, licencias ni historial de trial.
- No volver a cliente/servicio Pedidos anterior ignorando vigencia del trial.
- Descargas: rutas versionadas, sin reemplazar instaladores antiguos ni feed automático; configuración edge respaldada antes de recarga validada.
- PIN: ver la unidad y reversión en `2026-11-14-pin-movimientos-responsivo.md`.
