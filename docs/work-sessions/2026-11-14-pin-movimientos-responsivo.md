# 2026-11-14 — Autorización por PIN sin bloquear la caja

## Alcance

- El IPC de operaciones con `authorizerPin` utiliza la preparación asíncrona existente, antes limitada a gestión de usuarios. No cambia la forma de ingresar el PIN ni agrega selección de autorizante.
- Cada par PIN/hash se comprueba una vez por comando. Si una operación reautoriza antes del recibo y dentro de su transacción, reutiliza únicamente el resultado criptográfico: identidad y permisos se vuelven a resolver con los datos actuales.
- No hay caché entre movimientos, reducción de costo bcrypt (12), cambios de PIN ni migración. Se preservan rechazo de PIN ambiguo heredado, autoría individual y auditoría sin credenciales.
- La preparación no mantiene una transacción abierta durante las esperas. Antes de escribir revalida usuarios activos/hashes y el turno de caja: una espera no puede aplicar un retiro al turno siguiente.
- Caja indica «Verificando autorización…» (o «Registrando…» sin PIN); Finanzas indica «Verificando autorización y procesando…». Ambos formularios bloquean envíos repetidos mientras están ocupados y conservan el borrador ante rechazo.

## Evidencia

- E2E de retiro con perfil temporal y 13 usuarios activos: antes del cambio se reprodujo un bloqueo de temporizadores de **852 ms**. Tras el cambio, la prueba equivalente registró **206 ms** como intervalo máximo y **892 ms** de duración completa del comando.
- Esos valores son de la PC de prueba, no una promesa de latencia en otras instalaciones. En un retiro con una sola autorización el trabajo criptográfico total sigue creciendo con los usuarios; la mejora de tiempo total se concentra en comandos que antes repetían las comprobaciones.
- Las pruebas instrumentan bcrypt: una comparación asíncrona por hash distinto, ninguna comparación síncrona dentro de la escritura y preparación nueva en cada comando. Incluyen corrección de pago con doble reautorización, PIN/activación/permisos cambiantes, ambigüedad y cambio de turno durante la espera.

## Validación

- Typecheck y build globales: 11/11.
- Base de datos con Electron/tsx: 14/14 (trabajo de PIN, autorizantes y movimientos).
- Web: 380/380.
- E2E: 7/7, UI de dinero, guardas de doble submit, rechazo y conservación de datos, y respuesta del proceso principal. La prueba anterior de edición de usuarios se estabilizó esperando que termine la inicialización del modal antes de llenar el segundo borrador.

## Continuidad

Sin commit, push, despliegue, cambio de versión ni instaladores. La mejora requiere distribuir escritorio cuando se autorice.

Hay cambios simultáneos ajenos de licencias, portal y aprovisionamiento, incluido otro bloque de `main.ts`; no pertenecen a esta unidad y no se deben incluir en un commit futuro por accidente.

Rollback: retirar el nuevo criterio de preparación del IPC, la guarda del turno y feedback de Caja/Finanzas junto con sus pruebas; conservar la preparación preexistente de gestión de usuarios y los cambios ajenos.
