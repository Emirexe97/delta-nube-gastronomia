# Evidencia de QA

La bitácora de resultados es `../SYSTEM_USABILITY_AUDIT_PLAN.md`.
Se versionan los resúmenes de regresión y directorios necesarios para generar evidencia.
Capturas, traces, perfiles, fixtures, logs y backups de fuentes permanecen locales,
fuera de Git. No son necesarios para ejecutar las pruebas canónicas de `tests/e2e`.
Los resultados de cada pasada y sus límites están documentados en la bitácora;
los resúmenes son históricos, no sustituyen ejecutar pruebas sobre una fuente nueva.

Para Electron, usar `pnpm build` y el runner nativo compatible con la ABI actual.
No reconstruir SQLite con Node durante una sesión Electron. No compartir bases
locales, datos de negocio, variables de entorno ni credenciales como evidencia.
