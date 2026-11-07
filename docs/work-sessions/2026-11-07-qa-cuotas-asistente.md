# 2026-11-07 — QA de cuotas del asistente IA

## Objetivo

Versionar la prueba opt-in de cuotas IA sobre Electron empaquetado con perfil descartable y autoridad QA aislada.

## Archivos y cambios

- `tests/e2e/pos-assistant-quota-qa.spec.ts`: cooldown, recuperación, límites diarios de usuario/comercio y FAQs locales disponibles sin llamadas adicionales al proveedor.
- Se excluyen `.codex-gemini-baseline/`, `.codex-gemini-release/` y `.codex-gemini-smoke/`: copias y artefactos locales de QA. No se borran.

## Verificaciones

- `corepack pnpm typecheck`: 11 tareas exitosas (9 desde caché).
- `corepack pnpm build`: 11 tareas exitosas (9 desde caché); no genera instalador.
- `corepack pnpm exec playwright test tests/e2e/pos-assistant-quota-qa.spec.ts`: 1 skipped, sin activar `POS_QA_E2E=1`.
- La ejecución funcional empaquetada NO fue validada en esta sesión: requiere app temporal, autoridad/control QA y clave pública configurados mediante las variables POS_QA_* indicadas en la prueba.

## Riesgos y pendientes

La prueba requiere infraestructura QA externa; su descubrimiento y omisión esperada no prueban el flujo funcional. No ejecutar contra producción. Sin cambio de versión, instaladores ni despliegue.

## Continuidad y rollback

Base: `60c3e07`. Destino: `origin/main`, repositorio `Emirexe97/delta-nube-gastronomia`. Revertir esta unidad elimina sólo la nueva prueba y esta nota; no modifica código productivo ni artefactos locales.
