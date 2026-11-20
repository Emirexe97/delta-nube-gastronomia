# Piloto Windows x64 — paquete local reservado

**Alcance:** una PC Windows designada por el titular. No se ejecutaron los instaladores, no se enroló ninguna PC y no se modificó ni publicó nada en el servidor. La versión del workspace sigue en 0.1.37 y su configuración de actualizaciones en `enabled: false`.

## Entregables

Carpeta local: `apps/desktop-shell/release/piloto-win-20261117`.

| Artefacto | Versión | SHA-256 |
|---|---|---|
| Instalación inicial (NSIS) | 0.1.38 | `2c295a690a74b7ac83f29508c3fd6aaa1d291272d90714ebe0751995354dbae4` |
| Actualización (NSIS) | 0.1.39 | `b0ce131991ecac377c65cf5d5d04dcbdc12b5cd7e91bc2cee6f940afdc4799a8` |

- `preflight-instaladores.json`: huella del pin público, hashes y verificación antes de firmar.
- `feed-local/release.json` y `preflight-firma.json`: **firma Ed25519 local verificada (PASS)** contra el NSIS 0.1.39 y el pin público recuperado. Secuencia 1; vence el 24/11/2026 a las 17:12 de Buenos Aires (20:12:18 UTC). SHA-256 del manifiesto: `c7a40b8adb01b4dd49142c548e64a7cc59ea5e73733348f05433d40397992487`.
- La instalación inicial se distribuye sólo por un canal confiable y con verificación de su SHA-256; la firma Ed25519 del manifiesto autentica el **archivo de actualización** 0.1.39. No es firma Authenticode de los ejecutables.

## Comprobaciones y límites

1. Se extrajo el ASAR de ambos NSIS con 7-Zip sin ejecutarlos. Se comprobó la versión del paquete y del recurso PE, el pin público, modo/URL piloto, la configuración de licencia original y el SHA-256 del módulo SQLite nativo empaquetado.
2. Un primer candidato contenía un SQLite auxiliar por resolución de paquetes del workspace. Fue descartado sin firmar ni entregar. La compilación final usa un directorio standalone con dependencias necesarias copiadas desde las versiones instaladas, y el inventario del ASAR rechazó SQLite locales, PEM, env y dependencias del workspace.
3. El guard de enrolamiento de este par **no se puede activar sólo al instalar**: sin su archivo local de aprobación no inicia el proveedor de actualizaciones. El archivo no se empaquetó ni se escribió al perfil real. Pruebas del módulo de staging: ausente e incorrecto → DISABLED; prueba con marca correcta solamente en perfil desechable e inyección sin red.
4. 18 pruebas focalizadas, typecheck desktop/web y build de 9 workspaces aprobados. Al terminar la firma se repitió el preflight con la clave pública y se comprobaron los SHA-256 de ambos EXE y del manifiesto sin ejecutar instaladores. La [actualización instalada de laboratorio 98.0.1 → 98.0.2](WINDOWS_INSTALLED_UPDATE_QA_20261117.md) es evidencia del mecanismo, no una ejecución de estos binarios piloto.

## Puertas para próximos pasos

El [runbook](WINDOWS_ED25519_PILOT_RUNBOOK.md) exige una ventana de caja cerrada y una copia recuperable de datos/licencia, validación del instalador y política de esta PC, autorización separada antes de colocar la marca local y un feed verdaderamente restringido antes de publicar. No copiar estos archivos a un árbol público ni reutilizar sus números de versión para otros bytes.
