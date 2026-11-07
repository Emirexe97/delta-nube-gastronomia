# Sincronización de Gastronomía y Mozo

## Alcance

Publicar el trabajo local pendiente de Gastronomía: cuenta de licencia, pruebas aisladas locales/alojadas, acceso Mozo hasta cierre de caja y refinamiento compartido de interfaz/rendimiento. Incluye sus contratos, migración, pruebas y documentación para continuar desde otra PC. La versión 0.1.31 ya estaba preparada anteriormente; este pedido no la incrementa ni genera instaladores.

## Validación antes del commit

- `pnpm typecheck`: 11/11 tareas correctas (caché).
- `pnpm build`: 11/11 tareas correctas (caché).
- `pnpm --filter @gastronomy/web test`: 358 pruebas, 45 archivos aprobados.
- `pnpm --filter @gastronomy/orders-service test`: 44/44 aprobadas fuera del aislamiento de red. El primer intento restringido no completó correctamente los servidores locales; no se atribuye a una regresión.
- Smoke anterior al reemplazo de la instalación: Salón, Resumen y ocho pestañas de Configuración en perfil aislado.
- E2E de catálogo móvil aprobado durante la entrega; la suite E2E completa no se repitió para este commit.
- Página pública verificada byte por byte contra compilado y saludable; sólo se reinició el contenedor Mozo aislado, no los otros 14 servicios.

## Seguridad y continuidad

No incluir bases, credenciales privadas, compilados, instaladores ni evidencia local ignorada. Se retiraron del informe VPS el PIN activo de prueba y la ruta exacta del archivo de credenciales. El script de la skill `commit` apunta a otro repositorio (POS Tienda): no ejecutarlo sobre este proyecto.

La instalación normal y el perfil de prueba mantienen respaldos independientes. En el perfil alojado existente la caja #2 sigue abierta; volver a vincular el teléfono con QR nuevo después del reinicio remoto. Impresión simulada, sin validar papel físico.

## Reversión

El código se revierte como una entrega integrada: contratos/migración/relay y consumidores de escritorio y página deben permanecer compatibles. Revertir Git no revierte bases ni archivos ya instalados. Para la distribución usar los respaldos documentados en los informes de estética y del piloto; nunca restaurar datos comerciales sin evaluar movimientos posteriores.
