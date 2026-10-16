# Workflow de agentes para Delta Nube Gastronomía

## Orquestación predeterminada

- Usar **Astra con razonamiento medio** como orquestador para analizar, dividir, integrar y revisar el trabajo.
- Delegar tareas independientes y acotadas a **Luna**, eligiendo razonamiento bajo para auditorías, inventarios y documentación, y medio para implementación o pruebas.
- Evitar delegar cambios triviales cuando la coordinación cueste más que resolverlos directamente.
- Escalar a un modelo o razonamiento más costoso sólo cuando Luna no pueda resolver correctamente la tarea o el riesgo lo justifique.

## Coordinación

- Asignar a cada subagente un objetivo, archivos y límites claros.
- Evitar que dos agentes editen el mismo archivo al mismo tiempo.
- El orquestador integra los cambios y ejecuta las validaciones finales del conjunto.
- Los subagentes no hacen commit, push, cambio de versión ni instalador salvo pedido explícito.

## Entrega

- Antes de informar que una implementación está terminada, ejecutar las pruebas focalizadas, typecheck y build correspondientes.
- No incluir archivos ajenos a la tarea en commits futuros.
- No hacer commit, push ni regenerar el instalador sin una solicitud explícita del usuario.

## Distribución por plataforma

- Windows: usar actualización automática con descarga en segundo plano e instalación confirmada, con caja cerrada. No informar que está activa hasta configurar y validar feed/firma y una actualización real.
- Mac: distribución manual mediante instalador. No activar el updater macOS; mantenerlo deshabilitado en sus builds.
- Cuando el usuario pida crear una nueva versión o generar el instalador para la siguiente versión, generar también el instalador Mac y entregar la ruta absoluta de la carpeta que lo contiene.
- Un pedido de commit/push por sí solo no autoriza cambio de versión, instalador ni despliegue.
