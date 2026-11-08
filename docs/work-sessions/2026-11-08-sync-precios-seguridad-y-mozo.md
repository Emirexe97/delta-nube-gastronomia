# Sincronización de precios, seguridad de caja y Mozo

Solicitud: guardar y subir todos los cambios pendientes del proyecto, sin cambiar la versión ni generar instaladores.

## Contenido

- Listas de precios con redondeo, precios propios, consulta y edición simplificadas, separadas de modificadores.
- Conversión de tarifas históricas a Principal/Delivery sin alterar importes; Retiro separado sólo si sus precios eran distintos. Verificación transaccional y pruebas de reversión.
- PIN inicial obligatorio, autorización de movimientos de caja y gastos, y restauración protegida con caja cerrada.
- Aprovisionamiento del modo Mozo y ajustes de recepción, licencias y servicios relacionados.
- Pruebas y documentación correspondientes, incluida adaptación de fixtures al PIN inicial.

## Validación de integración

- Typecheck y build: 11/11 tareas aprobadas.
- Dominio: 56 pruebas; interfaz: 378; licencias/provisión desktop: 23; servicios/provisión: 46, todas aprobadas.
- Electron: 6 pruebas aprobadas (PIN inicial, autorización de dinero, listas de precios y alta de Mozo).
- Base de datos: 296 pruebas aprobadas en la ejecución completa; una prueba anterior exigía unificar Retiro/Delivery, contradiciendo la conservación solicitada. Se actualizó para comprobar los importes separados y pasó en una repetición focalizada. No se repitió la suite completa tras ese cambio de expectativa.
- Las pruebas usan perfiles y bases temporales; no se actualizó la instalación del negocio.

## Alcance de la entrega

Se conserva la versión 0.1.32. No se generan instaladores ni se realiza despliegue. Se excluyen las carpetas temporales `.codex-gemini-*`, los logs y los resultados generados de pruebas.
