# Estilo compartido de escritorio y Modo Mozo

## Alcance

Base visual común tomando la identidad naranja del escritorio: superficies claras,
botones, campos, tarjetas, radios y colores semánticos. Navegación más sobria, tablas
sin encabezados en mayúsculas y textos operativos más breves.

- `packages/ui/src/theme.ts`: módulo CSS independiente de React, consumido por el
  renderer y por el HTML del servicio de mozos. Los controles del escritorio usan
  los mismos tokens. `theme-types.d.ts` permite typecheck sin build previo.
- `HelpTip`: hover, foco, clic, Escape y cierre exterior. Portal con límites de
  viewport, persistencia al mover el puntero al contenido y cierre al ocultar el
  espacio de trabajo. No se anida el botón dentro del label de un campo.
- `Field`: ayudas secundarias junto a la etiqueta; `hintMode="inline"` preserva
  estados y mensajes indispensables. Se auditó validación de clientes/existencia,
  caja, precio manual, señas, repartidor bloqueado, liquidación e impresoras.
- Modo Mozo mantiene estados de red/envío/cocina visibles. Ayuda táctil real,
  controles de al menos 44 px, misma paleta y sin desbordes a 320/390 px.
- Se simplificaron Resumen, encabezados de Salón/Pedidos, vinculación de teléfonos
  y bandeja de pedidos de mozos, sin alterar contratos ni operaciones.
- Docker y paquete de hosting incluyen la nueva dependencia de tema; no hubo
  publicación ni despliegue.

## Validación

- `pnpm typecheck`: 11/11 tareas.
- `pnpm build`: 11/11 tareas; sólo advertencia existente de chunk web >500 kB.
- `pnpm --filter @gastronomy/web test`: 354/354.
- `pnpm --filter @gastronomy/orders-service test`: 42/42.
- `node --test scripts/hosting/test.mjs`: 4/4, arranque del paquete de mozo con tema.
- E2E: 17 pruebas de caja/clientes/navegación aprobadas; la pasada final focalizada
  de estilo escritorio, móvil y circuito QR→pedido→cocina→revisión→revocación pasó
  3/3. Se adaptaron selectores al rol del control para no confundir una ayuda con
  el campo cuyo nombre incluye. No se eliminaron aserciones de negocio.
- Inspección visual de capturas reales de Electron oculto y Chromium móvil.
  Evidencia local ignorada por Git: `docs/qa/evidence/shared-style-2026-11-06/`.
- `git diff --check`: sin errores.

Las pruebas usan perfiles, datos y servidores locales temporales. El sandbox
bloqueaba conexiones a 127.0.0.1; se repitieron con el permiso correspondiente.
No se hizo rebuild nativo ni se tocó el perfil real del usuario.

## Límites y reversión

No se hizo commit, push, cambio de versión, instalador ni despliegue. El workspace
ya tenía cambios de licencias, relays, caja y piloto: se preservaron.

Para revertir esta unidad, quitar sólo los cambios de tema/ayuda/copy y las pruebas
de esta sesión en UI, renderer y waiter-page; retirar su dependency/export/lock y
las líneas de empaquetado de UI. **No restaurar archivos completos contra HEAD**:
varios ya tenían cambios previos ajenos. No revertir contratos, base de datos,
licencias ni el traslado previo de la bandeja a Salón → Mozos.

La instalación offline de pnpm no estaba completa (faltaba el tarball local de
Turbo); se añadió únicamente el enlace workspace de UI y su entrada en lockfile,
sin descargar dependencias ni ejecutar scripts de instalación.

## Próximo paso

Revisar el resultado con el usuario. La aplicación instalada y el sitio publicado
no se actualizan hasta que se solicite la distribución correspondiente.

## Actualización solicitada y aplicada — 6 de noviembre, 18:33

El usuario pidió actualizar la instalación normal, la ventana de prueba y la
página de mozo. Confirmó ambos destinos de escritorio y que el otro chat había
terminado sus pruebas antes de reiniciar el servicio remoto.

- **Página pública**: actualizado solamente `waiter-page.js`, el paquete del tema
  y sus declaraciones de dependencias. Reiniciado exclusivamente
  `gastronomy_account_waiter_pilot-waiter-1`; quedó saludable. Los otros 14
  contenedores conservaron ID, PID, inicio, reinicios, imagen y salud. No se
  modificaron DNS, proxy, licencias, POS ni Staging.
- **Piloto hosted-aVsXlC**: recargado el renderer sin reiniciar el proceso,
  conservaron caja #2 abierta, identidad, configuración y datos. Quedó visible
  Configuración → Modo Mozo para generar un QR nuevo; no se enviaron pedidos.
- **Instalación normal 0.1.31**: reemplazado atómicamente sólo `app.asar` con los
  compilados `dist/renderer` actuales. Verificados 917 archivos preservados,
  47 archivos nativos desempaquetados idénticos y 13 compilados. Se conservaron
  configuración, dependencias, ejecutable, versión y perfil. Se abrió y se
  comprobó visualmente el nuevo diseño. Muestra licencia pendiente; no se activó
  ni se copió la identidad del piloto para habilitarla.

### Comprobaciones de distribución

- HTTP 200 para `/waiter` y ambas rutas `/health`; rutas ajenas a mozo siguen 404.
- En página publicada: tema `#c2410c`, sin desborde a 320/390 px, sin errores JS;
  ayuda PIN abre/cierra con toque y actualiza `aria-expanded`.
- Candidato instalado: arranque con perfil temporal aislado, Salón/Mesas,
  Resumen, ayuda con click/Escape y ausencia de errores JS: aprobado.
- Inspección visual de la instalación real y del piloto con el estilo nuevo.
- Pruebas/typecheck/build de implementación registrados arriba siguen siendo la
  base de esta distribución; no hubo cambios funcionales adicionales ni commit,
  push, nuevo instalador o cambio de versión.

### Respaldo y evidencia

- Respaldo de instalación y perfil:
  `C:\Users\Emir\AppData\Local\DeltaNubeGastronomiaBackups\shared-style-20261106-1825`.
  Para revertir, cerrar únicamente la instalación normal y restaurar su
  `resources/app.asar` desde ese respaldo. Los nativos no se reemplazaron.
  No restaurar datos del perfil sin evaluar antes los movimientos posteriores.
- Respaldo del release remoto y estados antes/después:
  `/home/deploy/gastronomy-account-waiter-pilot/operations/shared-style-20261106T212205Z`.
  La reversión debe limitarse a los archivos de waiter y su único contenedor.
- Evidencia ignorada por Git: `docs/qa/evidence/shared-style-deployment/`.
  Candidato aprobado `candidate-final/app.asar`; los intentos incompletos no son
  instalables. SHA256 instalado:
  `cd7d81679cbaebf285187540c665a12023e7fa2e2b968abe228dbd4901781b7f`.

El reinicio remoto invalida la sesión previa del teléfono: para volver a probar,
usar **Vincular teléfono** en el piloto y escanear un QR nuevo.
