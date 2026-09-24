# Preparación y validación de la versión macOS

Este documento describe cómo preparar y validar el empaquetado macOS de Delta Nube Gastronomía. **La existencia de esta guía no implica que la aplicación ni el instalador ya se hayan compilado o probado en una Mac.** La validación final debe hacerse en hardware o CI macOS.

## Requisitos del entorno

- Una Mac con una versión de macOS compatible con la versión de Electron del proyecto.
- Xcode y sus Command Line Tools instalados y aceptados (`xcode-select --install`; luego `sudo xcodebuild -license accept` si Xcode lo solicita).
- Node.js y pnpm según `package.json`/Corepack del proyecto, además de Git.
- Para distribuir a usuarios fuera del entorno de desarrollo: membresía del Apple Developer Program, certificado **Developer ID Application**, acceso a credenciales de notarización (preferentemente App Store Connect API key) y `notarytool` de Xcode.

La compilación de módulos nativos debe realizarse para cada arquitectura de destino en un entorno macOS. En particular, `better-sqlite3-multiple-ciphers` contiene un addon nativo (`.node`), por lo que no basta con copiar el binario Windows ni con que el empaquetado complete correctamente.

## Preparación y compilación

Desde la raíz del monorepo, en macOS:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @gastronomy/desktop-shell dist:mac
```

`dist:mac` compila web y desktop y pide a `electron-builder` un `.dmg` para cada arquitectura configurada (`arm64` y `x64`). `npmRebuild` reconstruye el addon SQLite durante el empaquetado para cada arquitectura; no anteponer `rebuild:native`, porque ese comando sólo prepara el binario para la arquitectura del host.

Para una matriz de distribución, producir y validar **arm64 (Apple Silicon)** y **x64 (Intel)** por separado o confirmar que el target configurado genera un binario universal. Un universal sólo es válido si tanto la aplicación como todos sus addons nativos incluyen ambas arquitecturas. No dar por hecho que una compilación arm64/x64 cruzada desde otra arquitectura sea correcta sin inspeccionar el artefacto.

Los artefactos se esperan en `apps/desktop-shell/release/` (directorio `build.directories.output` actual). Anotar versión, arquitectura y nombre/hash de cada artefacto validado.

## Validación funcional en Mac

Probar cada arquitectura/artefacto en una Mac limpia o cuenta de prueba, además de ejecutar la suite del repositorio:

```sh
pnpm --filter @gastronomy/desktop-shell test
pnpm --filter @gastronomy/desktop-shell typecheck
```

Checklist manual mínimo:

1. Instalar desde el `.dmg` (arrastrar la app a Applications), abrirla y confirmar que no depende de rutas del repositorio ni de herramientas de desarrollo.
2. Confirmar inicio/cierre, carga del renderer, persistencia de datos y migraciones; revisar que SQLite se carga correctamente dentro del `.app`/ASAR unpacked y puede crear/escribir su base local.
3. Recorrer las operaciones POS esenciales (crear/editar una venta, cobrar y consultar historial) con datos de prueba.
4. Validar impresión real y vista previa con las impresoras soportadas/disponibles: impresora de tickets térmica, tamaño/papel, acentos y símbolos, cortes y reimpresión. Probar también el selector/diálogo de impresión de macOS. Una prueba de build no sustituye una prueba de impresora.
5. Comprobar permisos, persistencia tras reiniciar y comportamiento al actualizar/reinstalar sin perder datos de usuario.
6. Probar la app firmada en una cuenta limpia y confirmar que Gatekeeper la abre sin instrucciones de bypass.

Guardar versión de macOS, modelo/arquitectura, impresora/controlador, comandos, resultado y logs de errores. No marcar macOS como validado hasta completar y registrar estos pasos.

## Firma y notarización para distribución

- Configurar en electron-builder `identity`/firma de Developer ID y entitlements adecuados para Electron (incluyendo hardened runtime cuando corresponda). No incrustar secretos/certificados privados en el repositorio.
- Proporcionar secretos de firma/notarización mediante el almacén seguro del entorno de release. Variables y mecanismos exactos dependen del método configurado por el equipo; no escribir contraseñas ni claves en comandos, logs o este documento.
- Firmar todos los ejecutables y addons nativos incluidos, verificar firma y entitlements (`codesign --verify --deep --strict --verbose=2 ...` y `codesign -dv --verbose=4 ...`).
- Notarizar el `.dmg` o el paquete distribuido con `xcrun notarytool`, esperar resultado aceptado y adjuntar el ticket con `xcrun stapler staple ...`; luego verificar con `xcrun stapler validate ...` y `spctl --assess --type open --verbose ...`.
- Validar Gatekeeper en una Mac distinta o cuenta limpia, no sólo en la máquina que firmó el artefacto.

Firma/notarización son requisitos de distribución confiable; un `.dmg` sin firmar puede servir para una prueba interna controlada, pero macOS advertirá o bloqueará su apertura según la configuración de seguridad.

## Límites de Windows

Windows puede editar la configuración y ejecutar los chequeos comunes, pero **no es el entorno de validación final de macOS**. Electron Builder puede permitir ciertos cruces para macOS, pero Xcode, firma/notarización, compatibilidad de addons nativos, Gatekeeper y la impresión no quedan demostrados por compilar desde Windows. El `.exe` NSIS existente tampoco se convierte en instalador Mac. Para release, ejecutar el comando en macOS y probar el artefacto en macOS; una VM/CI puede ayudar con build automatizado, pero no reemplaza la prueba de impresión con dispositivos reales.
