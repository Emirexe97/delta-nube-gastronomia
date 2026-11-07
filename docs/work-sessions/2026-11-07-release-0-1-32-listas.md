# Entrega 0.1.32 — listas de precios

Usuario autoriza nueva versión, instaladores, actualización local y publicar Mozo sólo si es necesario.

Fuente funcional: commit 2e3e843. Raíz y shell avanzan a 0.1.32. Windows NSIS manual; updater deshabilitado al no existir publicación firmada validada. Mac arm64/x64 mediante workflow existente, distribución manual con firma ad-hoc, sin activar updater ni prometer notarización.

Antes de reemplazar la app instalada: comprobar caja cerrada y respaldar perfil y aplicación. No modificar licencias ni datos de otros programas. Mozo consume los precios efectivos de Salón a través del escritorio; no cambió su página ni el servicio remoto en este cambio.

## Windows y PC

- Instalador: `C:\Users\Emir\Desktop\Instalables\Delta Nube Gastronomía\0.1.32\Windows\Delta Nube Gastronomía Setup 0.1.32.exe`.
- SHA256: `8C23BBCC863FA6CCFD28BDF39A6D9A660C62E0168CFC7CED37943A244475804F`. Authenticode NotSigned; no publicado en feed automático.
- Typecheck/build 11/11. Paquete probado con `isPackaged=true`, versión 0.1.32 y perfil temporal; API de listas con Principal disponible. ASAR sin bases, respaldos ni secretos.
- Caja normal cerrada. App cerrada sin forzar; respaldo completo de aplicación y perfil: `C:\Users\Emir\AppData\Local\DeltaNubeGastronomiaBackups\release-0.1.32-20261107`.
- Instalación NSIS silenciosa con salida 0. ASAR instalado idéntico al verificado: `3BF3715C5763721005B28B5134C62F138D143A7FFD5067AC5D0AAD4E71BC2854`.
- App instalada abierta y respondiendo. Migración 47→48, `quick_check=ok`, cero cajas abiertas. Comparación contra respaldo: mismos precios efectivos, pedidos, líneas, pagos y cajas. Licencia sólo actualizó sus marcas de tiempo de control (`lastTrustedTime`, `maxSeenWallClock`), no identidad/activación.
- Este perfil normal muestra «Revisá la licencia»; no se activó ni cambió la cuenta. No confundirlo con el perfil independiente del piloto Mozo.
- `https://mozos.gastronomia.deltanubeweb.com/waiter` devuelve HTTP 200. No se requiere redeploy: no cambiaron HTML/servicio Mozo ni sus contratos de transporte.

## Mac

El intento inicial 42375709598 se bloqueó en el build limpio: faltaba generar `@gastronomy/ui/theme` antes de Vite. Corregido el orden en 6ee8aca para usar Turbo con dependencias. Doce verificadores de empaquetado/actualización aprobados. Se volvió a compilar desde ese commit sin mover la etiqueta original ni cambiar la lógica instalada de Windows.

[CI 42375979316](https://github.com/Emirexe97/delta-nube-gastronomia/actions/runs/42375979316): **success arm64 y x64**. Ambos pasaron empaquetado, integridad del DMG, arquitectura SQLite, firma ad-hoc del bundle y configuración de licencia del ASAR. Esto no acredita notarización ni impresión física en la Mac destinataria. Updater Mac permanece deshabilitado.

Carpeta de artefactos descargados: `C:\Users\Emir\Desktop\IA\POS Módulo Gastronómico\apps\desktop-shell\release\mac-build\0.1.32\run-42375979316`. Copia para entrega: `C:\Users\Emir\Desktop\Instalables\Delta Nube Gastronomía\0.1.32\Mac`.

Descargas verificadas contra los digest SHA256 de GitHub Actions (archivo ZIP): Intel `297c30b1e08c67e055bce33b186e6e4058754bae409a2d1c279d891d9dd2ec81`, Apple Silicon `4c19f1fe6ee47e50ec61f19cc2888538aa1f62b3cd6f38597c01603d3cbea2b0`.

SHA256 de los DMG entregados: Intel `6702AF9D8F9BC232A56B55EB35522A0EFA9720BCA62411DFC914B157FED0559C`; Apple Silicon `7A76D3110B538483F1791A8661AA2943064F37F860EBC57AFC18F12E1AE2CCB1`. Verificadores focalizados finales 13/13, incluida regresión del orden de build limpio. Esta última prueba y la documentación no cambian los binarios ya construidos.
