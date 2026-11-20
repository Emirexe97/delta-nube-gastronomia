# Tutorial de primeros pasos

## Comportamiento

- Se ofrece automáticamente al abrir el programa cuando la cuenta todavía no tiene progreso, después de configurar el PIN inicial y cargar el negocio.
- Cinco etapas: ubicarse, preparar productos/caja, tomar un pedido, cobrar y continuar con cierre/informes/copias.
- Práctica interactiva aislada: los botones de ejemplo no llaman a operaciones de caja, pedidos, pagos ni impresión.
- Anterior/Siguiente guardan el paso. Si se interrumpe el programa, el recorrido en curso se reanuda al abrirlo.
- Omitir, cerrar y Escape guardan el estado omitido: no se vuelve a abrir automáticamente.
- Configuración → Tutorial permite continuar un recorrido omitido o empezarlo nuevamente, incluso después de completarlo.
- La guía adapta los canales y las instrucciones a módulos y permisos. Los ejemplos son opcionales.
- Usa el modal accesible existente, navegación por teclado, foco restituido al disparador, fondo inerte y diseño adaptable. No navega entre páginas ni descarta borradores.
- Si falla guardar el avance, muestra el error, conserva el paso y permite salir sin guardar. Un fallo de carga no bloquea el POS; se puede reintentar desde Configuración.

## Persistencia e identidad

Migración SQLite 51: `tutorial_progress`, clave compuesta cuenta de licencia/usuario operativo/versión. IPC obtiene la cuenta desde el estado confiable de licencia (correo normalizado); no acepta identidad enviada por el renderer. Sin cuenta vinculada, usa el ámbito `local`.

El usuario operativo desktop actual es `user-admin`: no existe un inicio de sesión independiente por empleado. Por eso no alcanza una bandera por ID de usuario. La cuenta licenciada también aísla el progreso. El almacenamiento es local y viaja con las copias de la base; **no sincroniza avances entre equipos**.

La ausencia de progreso se interpreta como primer uso de esta guía, también para instalaciones existentes que todavía no la hicieron. La versión 1 no reinicia el tutorial por actualizar el programa.

Demo usa el mismo contrato y validación dentro de su almacenamiento de demostración; restaurar la demo también reinicia el tutorial.

## Archivos / unidad de entrega

- `apps/gastronomy-web/src/components/user-tutorial.tsx`: orquestación, modal, ejercicios y panel de Configuración.
- `apps/gastronomy-web/src/components/tutorial-content.ts`: pasos y capacidades.
- `apps/gastronomy-web/src/app.tsx`, `pages/settings-page.tsx`, `demo/demo-api.ts`: integración.
- `packages/contracts/src/tutorial.ts`, `index.ts`: contrato estricto y API.
- `packages/database/src/migrations.ts`, `sqlite-repository.ts`: persistencia por identidad.
- `apps/desktop-shell/src/main.ts`, `preload.ts`: puente IPC protegido por el PIN inicial.
- Pruebas unitarias de tutorial/configuración, SQLite, y `tests/e2e/user-tutorial.spec.ts`.
- El fixture E2E operativo omite el tutorial explícitamente; los casos de onboarding lanzan Electron directamente. La prueba de seguridad del primer PIN también descarta la guía antes de operar.

Unidad funcional única: tutorial y sus pruebas, sin dependencias nuevas. Reversión de código: retirar estas integraciones/API y los archivos nuevos sin tocar otras funciones. Una base que ya aplicó migración 51 debe conservar la tabla/migración inocua o recibir una migración futura explícita; no bajar manualmente su versión ni modificar datos comerciales.

## Validación local

- `pnpm --filter @gastronomy/web test`: 385 pruebas aprobadas.
- `pnpm typecheck`: 11 paquetes aprobados.
- `pnpm build`: 11 paquetes aprobados, sin generar instaladores.
- SQLite + PIN inicial: 4 pruebas aprobadas con Electron como Node y loader tsx. El Node del sistema no sirve para el módulo nativo compilado con ABI de Electron; se ejecutó con `ELECTRON_RUN_AS_NODE=1`, `Start-Process -WindowStyle Hidden -Wait` y salida redirigida.
- E2E: 6 pruebas aprobadas (1,8 minutos) con `pnpm exec playwright test tests/e2e/user-tutorial.spec.ts tests/e2e/settings-sections.spec.ts tests/e2e/settings-draft-navigation.spec.ts tests/e2e/first-pin-cash-security.spec.ts --reporter=list`.
- Revalidación final: 3 E2E del tutorial aprobados (1,2 minutos), incluyendo error de guardado, foco confinado/restaurado y títulos dentro del viewport a 390 px. Revisión visual de bienvenida, cobro y pantalla angosta; se corrigió la conservación del scroll entre lecciones y se fijaron los controles al pie del área visible.
- Evidencia local en `.codex-tutorial-*.log` y adjuntos de Playwright en `test-results/` (ignorados por Git).
- Capturas revisadas también conservadas en `docs/qa/evidence/user-tutorial-20261115/` (ignoradas por Git).

Sin commit, push, cambio de versión, instalador ni despliegue. Pruebas sobre perfiles temporales, no sobre datos de producción.

Durante la sesión aparecieron cambios concurrentes ajenos en el editor de pedidos, el repositorio SQLite, benchmark y E2E de productos/pedidos. Se preservaron; no atribuir ni incluir esos cambios en una futura unidad de commit del tutorial.
