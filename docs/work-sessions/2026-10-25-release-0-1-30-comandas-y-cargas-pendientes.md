# 2026-10-25 — Versión 0.1.30: comandas y cargas pendientes

El usuario autorizó publicar los cambios, generar la siguiente versión y actualizar esta PC conservando datos y licencia.

## Cambios

- Reimpresión de cocina con selección de comanda completa o sólo cantidades agregadas; parcial predeterminada cuando hay novedades. Cada trabajo conserva su snapshot y sólo una impresión exitosa actualiza la referencia. Los pedidos históricos sin referencia requieren una impresión completa inicial.
- Salón y Pedidos conservan formularios y modales pendientes al navegar; la barra lateral sigue accesible. Se preservan datos y foco, y los formularios ocultos no interceptan atajos.
- Ocultar la notificación de impresión no vuelve a mostrar notificaciones anteriores; una nueva impresión vuelve a avisar.
- Pizza mitad y mitad muestra ambas variedades como detalle de cocina. OBS conserva exclusivamente notas manuales y no se eliminan notas existentes.
- Migración SQLite 42 aditiva: snapshot de trabajos de impresión e índice para consultar impresiones exitosas.

## Distribución y validación

Versión raíz y desktop 0.1.30. Windows NSIS x64 local y DMG Mac arm64/x64 desde el mismo commit mediante GitHub Actions. Actualizaciones automáticas deshabilitadas; Mac mantiene distribución manual.

La entrega requiere pruebas focalizadas, typecheck y build, verificación del paquete real y migración sobre copia consistente antes de instalar. Los respaldos, artefactos y evidencia privada permanecen ignorados fuera de Git. No se incluyen archivos personales ajenos a la entrega.

## Resultados de entrega

- Fuente de los instaladores: e896571fb243c866f77c9c3df9886ede9e7cdfcc, etiqueta v0.1.30, publicada en main.
- Typecheck y build: nueve paquetes aprobados. Dominio 47, impresión web/demo 10 y escritorio 83 pruebas aprobadas. Ocho E2E de reimpresión/notificaciones/navegación aprobados; nueve E2E de vista previa aprobados en la corrida final. Se corrigió sólo la automatización de cancelación: acepta el cierre esperado durante el clic y confirma ventana cerrada y resultado sin impresión; la apertura de ventanas tiene un presupuesto de 30 segundos para equipos ocupados.
- Windows NSIS x64: 97971832 bytes, SHA256 DBCCB7E373C0F55C6531BC2691DA9395C39DC66C16C8F58BF88ED86737F7D755. Instalador local en apps/desktop-shell/release/Delta Nube Gastronomía Setup 0.1.30.exe. Authenticode NotSigned; entrega manual, updater deshabilitado.
- Paquete Windows real probado sobre copia consistente: migración 41 → 42, integridad y claves foráneas correctas, tablas existentes y caja conservadas. Renderer del ASAR coincide con el build verificado.
- Mac: CI https://github.com/Emirexe97/delta-nube-gastronomia/actions/runs/40225047062 completó arm64 y x64 con éxito sobre el mismo commit. Verificaciones de DMG, firma ad-hoc, arquitectura SQLite, licencia empaquetada y arranque correctas. ZIP descargados y verificados contra tamaño y SHA256 de GitHub.
- Carpeta absoluta Mac: C:\Users\Bonis\Documents\ChatGPT\Delta Nube Gastronomía\apps\desktop-shell\release\mac-build\run-40225047062. Subcarpetas arm64 y x64. DMG arm64 SHA256 F462090CC0D8FFDEBE410BF21EF3DF611E059432797CB519B743B9BF14D210B9; DMG x64 SHA256 BD482DB554AA0559C140D7C6EC80DAE4C2A40DB669E7988723AB54208887B9EB. CI no sustituye pruebas físicas de impresión ni notarización.
- Esta PC: instalador terminó con salida 0, ejecutable instalado 0.1.30.0 y ASAR idéntico al paquete. Respaldo completo antes de instalar en %LOCALAPPDATA%\DeltaNubeBackups\antes-instalar-0.1.30-2026-10-25T19-27-53-359Z.
- Después del arranque normal: datos anteriores y caja #38 conservados, integridad correcta, migración 42 verificada; licencia activa e identidad del equipo conservada. Ventana normal observada. Evidencia privada en apps/desktop-shell/release/qa-0.1.30/.
