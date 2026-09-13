# Continuar Delta Nube Gastronomía en Codex desde otra PC

## Proyecto

- **Repositorio:** https://github.com/Emirexe97/delta-nube-gastronomia
- **Rama de trabajo:** `main`
- **Último commit verificado:** `d15966212913dd45eb767ccc64b0e1eae5d0c0f9`
- **Versión actual:** `0.1.2`
- **Stack:** Electron, React, Vite, TypeScript, SQLite y pnpm workspaces/Turborepo.

## Acceso seguro a GitHub

Este archivo no contiene contraseñas ni tokens. En la otra PC, iniciar sesión de
GitHub desde una terminal con GitHub CLI:

```powershell
gh auth login
```

Elegir:

1. `GitHub.com`
2. `HTTPS`
3. Autenticación mediante navegador

Comprobar el acceso:

```powershell
gh auth status
```

> No pegar un Personal Access Token, contraseña o clave privada dentro de este
> archivo ni dentro de un prompt de Codex. Codex utilizará las credenciales que
> GitHub CLI o Git Credential Manager guarden de forma segura en esa PC.

## Descargar el proyecto

```powershell
gh repo clone Emirexe97/delta-nube-gastronomia
cd delta-nube-gastronomia
git switch main
git pull --ff-only origin main
git rev-parse HEAD
```

El último comando debería devolver inicialmente:

```text
d15966212913dd45eb767ccc64b0e1eae5d0c0f9
```

También se puede clonar sin GitHub CLI:

```powershell
git clone https://github.com/Emirexe97/delta-nube-gastronomia.git
cd delta-nube-gastronomia
```

## Preparar el entorno

Requisitos:

- Windows 10/11 x64
- Node.js 22 o superior
- Git
- GitHub CLI (`gh`), recomendado
- Codex Desktop o Codex CLI

Instalación:

```powershell
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install --frozen-lockfile
```

## Validar el punto de partida

```powershell
pnpm typecheck
pnpm --filter @gastronomy/database test
pnpm --filter @gastronomy/web test
pnpm build
```

Pruebas E2E de los últimos cambios:

```powershell
pnpm --filter @gastronomy/desktop-shell rebuild:native
pnpm exec playwright test tests/e2e/quick-entry-navigation.spec.ts tests/e2e/table-removal.spec.ts tests/e2e/print-preview.spec.ts
```

Última validación conocida:

- TypeScript: 7 paquetes correctos.
- Base de datos: 66 pruebas correctas.
- Web: 50 pruebas correctas.
- E2E combinadas: 17 pruebas correctas.

## Estado funcional entregado en 0.1.2

1. En la carga rápida del salón, `Enter` avanza y `Shift+Enter` retrocede.
2. Al ingresar un número de mesa válido se habilita el campo siguiente, por lo
   que también se puede continuar con el mouse sin conocer `Tab`.
3. Una mesa vacía puede eliminarse individualmente sin cambiar la cantidad total
   del salón. Se conserva el historial y se bloquea el borrado si hay consumo,
   pagos o impresiones.
4. Cuando no existe una impresora directa válida, se abre una vista previa con
   botones **Imprimir** y **Cancelar**.
5. Cancelar o cerrar la vista previa no bloquea la mesa, no registra un intento
   fallido y deja disponible **Reintentar comanda/cuenta**.
6. Los errores técnicos reales de impresión conservan el estado `FAILED`; una
   cancelación voluntaria devuelve `SKIPPED` y elimina el trabajo transitorio.

## Archivos importantes de los últimos cambios

- `apps/gastronomy-web/src/pages/tables-page.tsx` — salón, carga rápida y eliminación de mesas.
- `apps/gastronomy-web/src/components/order-editor.tsx` — impresión y reintento no bloqueante.
- `apps/desktop-shell/src/printer.ts` — impresión directa, vista previa y resultado `PRINTED/SKIPPED`.
- `apps/desktop-shell/src/print-preview-preload.ts` — controles seguros de la vista previa.
- `apps/desktop-shell/src/main.ts` — integración IPC de impresión.
- `packages/database/src/sqlite-repository.ts` — baja lógica de mesas y trabajos de impresión.
- `tests/e2e/quick-entry-navigation.spec.ts`
- `tests/e2e/table-removal.spec.ts`
- `tests/e2e/print-preview.spec.ts`

## Ejecutar durante el desarrollo

Demo web rápida:

```powershell
pnpm dev:demo
```

Aplicación de escritorio, en dos terminales:

```powershell
pnpm dev:web
```

```powershell
pnpm dev:desktop
```

## Generar instalador

```powershell
pnpm --filter @gastronomy/desktop-shell dist:win
```

El instalador se genera en:

```text
apps/desktop-shell/release/Delta Nube Gastronomía Setup 0.1.2.exe
```

`release/` y `dist/` están excluidos de Git. Para publicar una versión nueva,
actualizar la versión en `package.json` y `apps/desktop-shell/package.json`,
validar y regenerar el instalador.

## Workflow solicitado para Codex

- Usar un **orquestador inteligente**.
- Astra con razonamiento medio planifica y revisa.
- Luna ejecuta subtareas acotadas cuando la delegación sea útil y esté permitida.
- Preferir el modelo más económico que pueda realizar correctamente cada tarea.
- No sobrescribir cambios ajenos ni ejecutar acciones destructivas.
- Antes de editar: revisar `git status`, `git log` y documentación relevante.
- Después de editar: pruebas focalizadas, typecheck, `git diff --check` y una
  validación de runtime cuando corresponda.
- No hacer commit, push, publicar ni instalar salvo pedido explícito.

## Prompt inicial para pegar en Codex

```text
Continuá el proyecto Delta Nube Gastronomía desde este repositorio. Primero leé
README.md, docs/ y CONTINUAR_EN_CODEX_OTRA_PC.md; verificá git status, la rama
main y el commit actual. Recuperá la memoria persistente del proyecto si Engram
está disponible. No cambies código todavía: resumime el estado técnico, las
pruebas disponibles y cualquier diferencia entre el checkout actual y el commit
d15966212913dd45eb767ccc64b0e1eae5d0c0f9. Trabajá con orquestador inteligente,
planificación/revisión Astra Medio y ejecución Luna para subtareas adecuadas,
usando el modelo más económico que pueda resolverlas correctamente. No hagas
commit, push, publicación ni instalación sin autorización explícita.
```

## Publicación actual

- Commit publicado: https://github.com/Emirexe97/delta-nube-gastronomia/commit/d15966212913dd45eb767ccc64b0e1eae5d0c0f9
- Instalador local 0.1.2 regenerado previamente.
- SHA-256 conocido del instalador: `F839B376F748485DCB109A0AD5E64458C24F642ACE47787613CED63AC0DE5AD3`.
