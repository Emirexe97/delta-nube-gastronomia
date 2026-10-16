# 2026-10-16 — Mejoras operativas y actualizaciones seguras

## Objetivo

Publicar el lote integrado aprobado de Delta Nube Gastronomía en `Emirexe97/delta-nube-gastronomia`, rama `main`, sin cambiar versión ni generar instaladores. Base: `5f22c00`.

## Archivos y cambios

- Configuración de mitad y mitad: contratos/dominio, SQLite/demo, editor y configuración web; pruebas unitarias y recorrido Electron con reinicio.
- Recuperación documental de compras: migración39, anulación y producto efectivo mediante ledgers inmutables, UI/demo y pruebas históricas. No altera caja/stock por corregir documentos.
- Combos reales: migración40, selección de componentes/extras, precios/stock/COGS por snapshots, UI y tickets, pruebas SQLite/demo/dominio.
- Repetir pedidos: borrador atómico desde cliente, precios/dirección actuales, revisión previa y pruebas. No copia cobros ni estado operativo histórico.
- Updater seguro: controlador, factory de configuración/firma, admisión atómica e IPC/preload, UI/aviso READY, scripts opt-in y pruebas. `updates-config.json` sigue deshabilitado; no se publica feed.
- Distribución acordada: Windows automático (aún requiere configurar y validar canal); Mac mediante instalador manual cada vez que el usuario pida nueva versión o siguiente instalador, entregando carpeta absoluta. Documentado en `AGENTS.md` y `docs/qa/AUTOMATIC_UPDATES.md`.
- `.gitignore` excluye adjuntos locales `.codex-remote-attachments/`; no se suben fotos, DB, secretos, builds ni instaladores.

## Verificaciones

En esta publicación:

- `pnpm typecheck`: 9/9 paquetes aprobados.
- `pnpm build`: 9/9 paquetes aprobados; no empaquetado.
- `pnpm test`: 9/9 paquetes aprobados (SQLite236, dominio38, web301, shell76, protocolo7, servicio14; se reutilizaron resultados Turbo válidos donde correspondía).
- `corepack pnpm --filter @gastronomy/web typecheck`: aprobado por el script de sincronización adaptado al repositorio correcto.
- `git diff --cached --check` y revisión de archivos locales/secretos antes del commit.

Evidencia funcional de la misma implementación, registrada antes de este commit:

- Electron focal updater + mitad y mitad: 3/3, perfiles aislados; updater deshabilitado por IPC real y estados de descarga/READY mediante fixture UI sin ejecutar binarios.
- Electron focal mejoras operativas + mitad y mitad + modales: 5/5.
- Detalles en `docs/qa/AUTOMATIC_UPDATES.md`, `HALF_AND_HALF_SETTINGS_QA.md`, `OPERATIONS_IMPROVEMENTS_QA.md` y plan maestro secciones81–83.

## Riesgos y pendientes

- Windows: faltan hosting HTTPS, certificado/firma y ensayo real de actualización N→N+1 antes de activar clientes. La integración no equivale a canal publicado.
- Mac: mantener updater deshabilitado y usar instalador manual por pedido; M1 requiere arm64. Entregar ruta absoluta al generar el artefacto y verificarlo, no reutilizar instalador viejo como nueva versión.
- No se generan backup automático ni Agotado por hoy; rendiciones se revisarán desde la PC afectada.
- Las migraciones39/40 se ejecutan por el flujo normal de apertura de la aplicación; no hay rollback automático del esquema.
- Un test concurrente de backup previo mostró EPERM transitorio Windows en una corrida anterior; repetición aprobada sin cambiar backups. La normalización demo que alteraba updatedAt/idempotencia fue corregida.

## Continuidad y rollback

- Destino: `origin/main`, remoto `https://github.com/Emirexe97/delta-nube-gastronomia.git`.
- Mantener datos locales y licencia; no desplegar ni actualizar clientes por el solo hecho de este push.
- Frontera de reversión funcional: lote de operaciones y updater posterior a `5f22c00`, con sus pruebas y documentación. Revertir fuente no revierte DB ya migrada: para clientes migrados se requiere plan específico y copia validada antes de cualquier rollback.
- La política de entrega por plataforma es independiente y debe conservarse salvo instrucción explícita del usuario.
