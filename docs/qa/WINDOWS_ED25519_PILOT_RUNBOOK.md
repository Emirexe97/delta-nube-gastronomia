# Piloto Windows Ed25519: preparación privada

**Estado:** clave piloto generada por el titular con recuperación desde USB comprobada. Los [instaladores Windows del piloto 0.1.38 → 0.1.39](WINDOWS_PILOT_LOCAL_20261117.md) quedan en una carpeta local; consultar su recibo de firma para el estado. No hay equipo enrolado ni publicación y el actualizador general sigue deshabilitado. El [ensayo instalado 98.0.1 → 98.0.2](WINDOWS_INSTALLED_UPDATE_QA_20261117.md) usó claves y una licencia de prueba; no es un instalador para la cohorte.

## 1. Confirmar custodia antes de generar la clave

| Elemento | Procedimiento |
|---|---|
| Custodio | El titular designa a un responsable de releases y un responsable de recuperación (o procedimiento de emergencia si una sola persona opera). Registrar custodios y fecha, **sin dejar secretos en el registro**. |
| Clave de firma | Ed25519 exclusiva del piloto, por ejemplo ID `gastronomia-piloto-ed25519-01`. Generarla y usarla en la PC de releases, con cuenta restringida y disco cifrado. Guardarla como **PKCS#8 cifrada** con una contraseña larga aleatoria generada por un gestor. No reutilizar las claves de licencias, TLS o del futuro canal estable. |
| Copia y contraseña | Conservar al menos una copia cifrada en un medio offline separado de la PC. La contraseña va en el gestor, con su acceso de emergencia comprobado; no junto con el archivo, en terminal grabada, argumentos, variables, chat, repositorio, CI ni VPS. |
| Registro no secreto | Guardar ID de clave, clave pública SPKI, SHA-256 de su DER, fecha de alta y referencia al lugar de custodia sin datos de acceso. Verificar la huella por un canal independiente antes de incorporarla al build. |
| Aprobación | No usar la clave para firmar paquetes piloto hasta comprobar una restauración desde la **copia**, no desde el original. |

### Generación a cargo del custodio

En una **consola local sin grabación**, en un directorio nuevo y restringido fuera del repositorio y de carpetas sincronizadas. Las rutas son relativas a ese directorio; si un archivo ya existe, detenerse para no reemplazarlo:

```powershell
if ((Test-Path -LiteralPath 'pilot-01.private.encrypted.pem') -or
    (Test-Path -LiteralPath 'pilot-01.public.pem')) { throw 'Elegí un directorio de custodia nuevo.' }
openssl genpkey -algorithm ED25519 -aes-256-cbc -out pilot-01.private.encrypted.pem
if ($LASTEXITCODE -ne 0) { throw 'No continuar: falló la generación.' }
openssl pkey -in pilot-01.private.encrypted.pem -pubout -out pilot-01.public.pem
if ($LASTEXITCODE -ne 0) { throw 'No continuar: falló la extracción pública.' }
```

OpenSSL solicita las contraseñas de forma interactiva; no agregar `-pass`, `-passin` ni variables con la contraseña. No copiar el PEM privado al workspace. [Generación OpenSSL](https://docs.openssl.org/3.5/man1/openssl-genpkey/) · [Opciones de contraseña](https://docs.openssl.org/3.5/man1/openssl-passphrase-options/).

Con Node.js 24 y el código de la herramienta disponible en la PC offline, usar su ruta absoluta en `$tool`. Primero registrar y confirmar la huella de la pública; después verificar la copia restaurada, no el archivo original:

```powershell
node $tool fingerprint --public-key $publicPem
node $tool recovery-check --public-key $publicPem --fingerprint $huellaRegistrada --private-key $copiaPrivadaCifrada
```

La herramienta es `apps/desktop-shell/scripts/windows-pilot-release.mjs`. Requiere consola interactiva con entrada oculta para operaciones privadas; no funciona enviando la clave o contraseña por argumentos, chat ni pipeline.

### Recuperación y rotación

1. En una PC de recuperación aprobada, abrir una copia **cifrada** del backup con la contraseña recuperada por separado. Ejecutar `recovery-check` con la huella anotada antes de la copia. El comando exige la identidad pública prevista y verifica una firma sobre un desafío aleatorio; no exporta ni imprime la clave privada.
2. Registrar fecha, custodio, ID, huella y PASS/FAIL; retirar el medio. Repetir después de mover/rotar custodia y planificar simulacros periódicos. Un FAIL suspende la firma.
3. Rotación normal: crear otra clave y otra huella, ensayar recovery, distribuir un cliente puente con ambos pines por canal confiable y después retirar la anterior. Los pines no se descargan del feed.
4. Pérdida o sospecha de exposición: congelar la publicación y bloquear el feed piloto sin alterar el estable. Si no se puede descartar compromiso, no firmar la transición con la clave sospechada: preparar un nuevo bootstrap confiable para la cohorte, con revocación de la confianza anterior. Un manifiesto firmado con la misma llave comprometida no restablece confianza.

## 2. Preparar un piloto sin alcance general

| Control | Valor propuesto |
|---|---|
| Equipos | Una PC Windows x64 elegida por el titular para el primer corte, con un responsable y ventana de caja cerrada. Ampliar sólo por decisión explícita. |
| Aplicación | Mismo appId del POS para continuar con su instalación, datos y licencia; probar en una copia de respaldo antes de hacerlo en el negocio. La primera versión compatible se instala por un canal confiable, sólo en esa PC. El actualizador de las instalaciones previas no puede incorporar confianza por sí solo. |
| Canal | `windows-ed25519-pilot-v1` y payload `channel: "pilot"`. Usa clave pública compilada propia y estado/caché `windows-signed-updates-pilot-v1`. `stable` no acepta ese manifiesto, aunque accidentalmente se reutilice la misma clave. |
| Build | Usar una copia de compilación dedicada. Insertar sólo `{keyId, spkiPem, sha256}` en `compiledPilotPins` de `windows-pilot-trust.ts`. Copiar el [ejemplo de configuración](../../apps/desktop-shell/updates-config.pilot.example.json) sólo en esa copia y habilitarlo **después** de autorizar la cohorte y comprobar acceso. No modificar llavero, config ni versión oficial del workspace. La configuración de build Authenticode no es un modo piloto; conservar sus requisitos. |
| Hosting futuro | Reservado en código: `https://actualizaciones.deltanubeweb.com/gastronomia/piloto/windows/x64/`. No configurado en esta preparación. Antes de publicar, restringir acceso a la red de la cohorte (por ejemplo una VPN con salida dedicada y lista de acceso); acceso de otros orígenes denegado en pruebas. Una ruta distinta o un paquete con firma no hacen privado el feed. |
| Protección del equipo | Authenticode queda pendiente. Si las políticas de Windows bloquean el binario, pausar el piloto: no desactivar SmartScreen, Smart App Control ni restricciones de la empresa. |

El piloto local incorpora sólo el pin público real, con enrolamiento local ausente. **No** se agregaron vhosts, ACL ni archivos en Caddy, ni se enroló una PC. Los dos instaladores de QA anteriores tienen otra identidad y no deben firmarse para este piloto.

## 3. Paquete local y criterios para el corte

Directorio local vacío, fuera de árboles servidos y sin claves privadas:

```text
piloto-local/
  versions/<version>/<instalador>.exe
  release.json
```

El firmador offline vincula el nombre, tamaño y SHA-512 al manifiesto. El preflight usa el mismo verificador que el cliente y no ejecuta el instalador. Registrar la versión base, versión destino, SHA-256 del ejecutable, huella del firmante, secuencia y vencimiento. **Verificar antes** que el instalador revisado se construyó para ese appId y esa versión: el manifiesto no inspecciona el contenido interno del NSIS. Mantener un registro independiente de secuencias y nunca reutilizar una con otros bytes. Si ya hubo un manifiesto aceptado, copiar su checkpoint para preflight; sólo el primer corte se ensaya sin checkpoint.

Con el NSIS piloto revisado en `$artifact`, y las fechas en UTC con formato `YYYY-MM-DDTHH:MM:SSZ`, ejecutar únicamente en la PC offline:

```powershell
$release = @('--public-key', $publicPem, '--fingerprint', $huellaRegistrada,
  '--key-id', $keyId, '--installed-version', $versionBase, '--artifact', $artifact)
node $tool sign @release --private-key $privadaCifrada --version $versionDestino --sequence $secuencia --issued-at $emitidoUtc --expires-at $venceUtc --out $manifestLocal
if ($LASTEXITCODE -ne 0) { throw 'Firma piloto no apta.' }
node $tool verify @release --manifest $manifestLocal
if ($LASTEXITCODE -ne 0) { throw 'Preflight piloto no apto.' }
```

Si existe `$checkpoint` de una publicación anterior, pasar además `--last-accepted $checkpoint` a ambos comandos. Usar una vigencia corta para el piloto. El firmador no sobrescribe archivos, no ejecuta el NSIS y no tiene flujo de publicación.

Antes de autorizar publicación y enrollar el primer equipo:

- [ ] Custodio, backup separado y simulacro de recuperación real confirmados.
- [ ] Equipo piloto, ventana, datos/licencia respaldados y recuperación verificada.
- [ ] Bootstrap y objetivo **de distribución** revisados y construidos en copia separada; no son los instaladores QA. Inspeccionar ambos paquetes finales: appId/versión, modo y URL piloto y huella compilada prevista, sin privadas. Etiquetar nombre y carpeta como piloto, inventariar hashes y comprobar que el paquete normal no incorpora esos pines/config. Probar en una copia recuperable que la versión destino sigue en piloto y que las políticas de Windows lo permiten.
- [ ] Manifiesto firmado y preflight correctos, verificación del nombre/versionado y archivos inmutables.
- [ ] Acceso privado probado desde un equipo autorizado y uno ajeno; sin fallback estable, listado ni archivos privados.
- [ ] Rotación de credenciales previamente expuestas concluida antes de publicar en esa infraestructura.
- [ ] Autorización independiente para publicar y, después del ensayo de cohorte, para ampliar. Publicar artefacto antes que manifiesto.

Si falla el piloto, no ampliar la cohorte. Retirar el manifiesto y bloquear el acceso para impedir nuevas descargas. **Eso no revoca un instalador ya descargado:** notificar a la cohorte para que no confirme, salir normalmente de la app para descartar ese estado READY y no reabrir hasta verificar el bloqueo del feed. No hay instalación al salir ni reutilización del archivo al reiniciar. Ensayar esta parada antes del enrolamiento. No publicar un downgrade. Para volver al estable, validar ruta por canal confiable y compatibilidad de datos/versión; si hace falta, preparar una corrección de versión mayor o recuperar desde una copia validada.

## Verificación de esta preparación

- **75 pruebas aprobadas y 1 omitida por plataforma** en las suites focalizadas de piloto, verificador, runtime, lanzador, admisión y preflight. Recovery, firma y comprobación usaron claves efímeras/bytes inertes. En HTTPS local: el modo estable rechazó el manifiesto piloto; el piloto llegó a READY con su checkpoint separado y sin lanzar el archivo.
- `corepack pnpm --filter @gastronomy/desktop-shell typecheck`, `corepack pnpm --filter @gastronomy/desktop-shell... build` y `git diff --check`: correctos. El build no es un instalador, no agrega claves ni cambia `updates-config.json`.
- Repetir el ejercicio offline: `node --test apps/desktop-shell/scripts/windows-pilot-release.test.mjs apps/desktop-shell/src/windows-pilot-channel.test.ts apps/desktop-shell/src/windows-signed-update-adapter.test.ts`. Las pruebas TLS de loopback requieren OpenSSL local.
