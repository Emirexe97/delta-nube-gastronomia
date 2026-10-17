# 2026-10-17 — Versión 0.1.27: búsqueda de productos

El usuario autorizó expresamente cambio de versión, commit/push, generación y publicación de instaladores Windows y Mac y actualización manual de esta PC conservando la caja abierta y todos los datos.

## Cambio y comprobaciones de fuente

- El catálogo prepara los precios y el stock visibles cuando cambia `data.products`, reutilizándolos al escribir la búsqueda. Evita construir cientos de formateadores monetarios por tecla.
- Conserva nombre/código/categoría, filtros, variantes, formatos monetarios y stock y selección de productos. No cambia la base, movimientos, precios guardados, identidad de aplicación ni licencia.
- Detalle y límites de las mediciones en [la investigación de rendimiento](2026-10-17-catalog-search-performance.md): mejora del trabajo repetido, sin prometer la desaparición de todos los picos bajo carga.
- Pruebas previas del mismo cambio: 12 unitarias de catálogo/filtros y una prueba browser sobre bundle de producción aprobadas. Build web incluido typecheck aprobado. La prueba usa 260 productos sintéticos y CPU ralentizada; no accede al programa operativo.
- Revisión independiente de código y prueba sin regresiones concretas identificadas de precio, stock ni variantes. El memo depende del reemplazo inmutable de `data.products`, coherente con bootstrap/React Query.
- Versión 0.1.27 en los manifests raíz y desktop. Validaciones de entrega, hashes y resultado de instalación se completarán al finalizar cada etapa.

## Procedimiento de distribución e instalación

- Windows y Mac se publican como instaladores manuales en GitHub Releases. El updater permanece deshabilitado: no hay certificado Authenticode configurado. No se publican metadatos automáticos para binarios sin firma.
- Mac: generar DMG Apple Silicon arm64 e Intel x64 desde la misma etiqueta/commit, con las verificaciones del workflow. Firma ad-hoc y arranque en CI no sustituyen notarización o impresión física. Mantener updater Mac deshabilitado.
- Instalación Windows con caja abierta autorizada por el usuario: pausar operaciones cerrando el programa, respaldar SQLite consistentemente y conservar licencia/identidad, verificar hashes del instalador, instalar, comparar todas las tablas antes de reabrir y verificar integridad, caja abierta, licencia y arranque normal.
- No modificar sesiones ni movimientos para instalar. La autorización manual no relaja las condiciones del updater automático. Mantener respaldo, datos, evidencias privadas y binarios fuera de Git; excluir el respaldo local ajeno a la entrega.

## Validación de artefactos e instalación Windows

- Fuente publicada: `ad8c71dd88fba119c0b1a96e23ac5b8bfe1770d0`, etiqueta `v0.1.27`. Typecheck web/desktop y sus builds aprobados. Nueva ejecución de la prueba browser sobre el bundle final aprobada: cero construcciones de formateadores monetarios durante la escritura, una sola carga de costos, foco/filtros/variantes/selección correctos.
- NSIS Windows x64: `apps/desktop-shell/release/Delta Nube Gastronomía Setup 0.1.27.exe`, 97.923.577 bytes, SHA256 `5CEE988ABF91E97166D6EF893F1A65563B1DF254087D377D28A22285FA258A52`, versión 0.1.27, Authenticode `NotSigned`; se mantiene entrega manual.
- Smoke del paquete real con perfil temporal aislado: versión 0.1.27, `isPackaged=true`, SQLite íntegro y las 49 tablas sin cambios tras arranque/migración. Se comprobó que el ASAR incluye exactamente el JavaScript de producción validado por la prueba de búsqueda. El perfil de prueba no copia la licencia operativa y devuelve `UNACTIVATED`, `canOperate=false`; updater `DISABLED`.
- Se cerró normalmente la aplicación operativa. Respaldo consistente nuevo, integridad y coincidencia de tablas verificadas: `C:\Users\Bonis\AppData\Local\DeltaNubeBackups\antes-instalar-0.1.27-2026-10-17T23-16-13-083Z\gastronomy.sqlite`. Incluye la caja abierta y todos los datos previos; se conservaron localmente licencia e identidad cifrada.
- Instalación silenciosa autorizada por el usuario, salida 0. Ejecutable en `C:\Users\Bonis\AppData\Local\Programs\@gastronomydesktop-shell\Delta Nube Gastronomía.exe`, versión 0.1.27.0. ASAR instalado idéntico al paquete verificado.
- Antes de reabrir, las 49 tablas coincidían exactamente con el respaldo y la caja #33 seguía abierta. Después del arranque normal visible se repitió la comprobación: base íntegra y **las 49 tablas seguían sin cambios**, incluida la caja abierta.
- Licencia Ed25519 válida y activa, `canOperate=true`, inscripción `APPROVED`, misma instalación, clave pública del dispositivo y clave cifrada. Se registró verificación online posterior al arranque; no requirió una nueva aprobación del propietario.
- La ventana instalada fue detectada normalmente. La captura/navegación adicional fue interrumpida por entrada del usuario y ventana minimizada; se evitó seguir navegando. No se afirma una medición de rendimiento en vivo de esta instalación: la corrección se validó sobre el bundle de producción y se verificó su presencia exacta en el paquete instalado.
- **Windows 0.1.27 instalada, verificada y aprobada para trabajar**, con la caja abierta y todos los datos preservados. Evidencia privada en `apps/desktop-shell/release/qa-0.1.27/`, ignorada por Git; incluye respaldo/comparaciones, recibo NSIS, licencia, correspondencia de binario y `work-approval.json`.

## Instaladores Mac

- [CI 39078060240](https://github.com/Emirexe97/delta-nube-gastronomia/actions/runs/39078060240): arm64 y x64 `success` desde el mismo commit/etiqueta. DMG, arquitectura SQLite, firma ad-hoc, configuración de licencia ASAR y arranque del paquete verificados dentro del workflow.
- Carpeta absoluta de esta entrega: `C:\Users\Bonis\Documents\ChatGPT\Delta Nube Gastronomía\apps\desktop-shell\release\mac-build\run-39078060240`. Ambos ZIP descargados coinciden en tamaño y SHA256 con GitHub Actions; se verificaron los DMG y sus hashes contra los assets publicados.
- Apple Silicon: `arm64/Delta-Nube-Gastronomia-0.1.27-arm64.dmg`, 116.548.601 bytes, SHA256 `EACEBFB29938DBD6D127D8025C4829438FA9F662DA793FFCD54458C054AFFE11`.
- Intel: `x64/Delta-Nube-Gastronomia-0.1.27-x64.dmg`, 141.981.581 bytes, SHA256 `943440B2F272D91D160F1A4963B7776F4DB6377D1DB4C0D8D89300EE5654F676`.

## Publicación final

- [Release 0.1.27 publicado](https://github.com/Emirexe97/delta-nube-gastronomia/releases/tag/v0.1.27): EXE Windows x64, DMG Apple Silicon/Intel y `SHA256SUMS.txt`. Todos los hashes de assets almacenados por GitHub coinciden con los archivos locales.
- Descarga pública sin credenciales comprobada en los tres instaladores mediante rangos HTTP 206, tamaño total y hash del servidor coincidentes; cabecera ejecutable Windows correcta. No se publicaron bases, licencias ni evidencia privada.
- El registro local `release-status.json` confirma publicación, descargas verificadas e instalación Windows `APPROVED`, versión 0.1.27 y caja abierta preservada. El canal automático permanece deshabilitado.
