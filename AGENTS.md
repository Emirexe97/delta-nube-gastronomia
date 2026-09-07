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
