# Tareas locales (piloto v0)

Node >=24, Git y las dependencias del lockfile para typecheck. Sin dependencias
nuevas. GitHub CLI y Codex CLI se necesitarán al habilitar transporte/ejecución;
este piloto no los invoca. Ejecutar desde la raíz del worktree:

```powershell
npm run agent:validate -- .agent-tasks/NES-0001.json
npm run agent:dispatch -- .agent-tasks/NES-0001.json --dry-run
npm run agent:gate -- .agent-tasks/EXAMPLE-0000.json
npm run agent:gate -- .agent-tasks/EXAMPLE-0000.json --no-fail-fast
npm run agent:test
```

`EXAMPLE-0000.json` es una plantilla completa y segura. Copiar sus campos y ajustar
el alcance con HQ; no copiar comandos desde un issue. `APPROVED` significa alcance
aprobado para planificar: el archivo no acredita autorización remota ni habilita
ejecución. Las tareas locales son definiciones iniciales; dispatch sólo acepta
`status=APPROVED`, `retryCount=0`, `result=null` y
`humanDecisionRequired=false`. `NES-0001.json` es sólo la definición del próximo
análisis.

| Campo                              | Contrato                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`, `title`, `type`              | ID como NES-0001, título y tipo libre (analysis, performance, maintenance, etc.).                |
| `mode`, `objective`, `constraints` | read-only/write, objetivo y lista no vacía de restricciones.                                     |
| `protectedPaths`                   | Prefijos de escritura prohibida; siempre incluir .git, .fanaticotas, .env, backups, credentials. |
| `allowedPaths`                     | Prefijos de escritura permitida; vacío en read-only. Nunca se superponen con protegidos.         |
| `inputs`                           | Rutas relativas de lectura, sin URL, globs ni comandos. No se abren automáticamente.             |
| `acceptanceCriteria`               | Evidencia necesaria; una lista no vacía de criterios comprobables.                               |
| `gates`                            | IDs únicos del catálogo local; lista no vacía. Sin args, cwd, shell ni ejecutables.              |
| `implementer`, `reviewer`          | ID de adapter local registrado; hoy sólo `codex`. Model null o elegido por HQ; session=new. QA read-only. |
| `retryCount`, `maxRetries`         | Enteros; inicial 0 y techo 0..2. Contar retries, no el intento inicial.                          |
| `status`                           | Definición local: siempre `APPROVED`; el estado posterior se deriva en memoria.                  |
| `result`                           | null hasta obtener evidencia; después reporte inline como texto, nunca un comando ejecutable.    |
| `humanDecisionRequired`            | Booleano; las definiciones locales exigen false; la decisión humana ocurre en runtime.           |

Rutas: usar `/`, componentes alfanuméricos, `_`, `-`, `.`; sin `..`, rutas absolutas,
backslashes, ADS de Windows o nombres de dispositivos. Un prefijo protege su subárbol.
La prohibición de acceso a `.git`, `.fanaticotas`, `.env`/`.env.*`, backups y
credenciales se aplica además en cualquier componente de inputs/allowedPaths;
Git puede consultar sus propios metadatos. La validación no descubre todo posible
secreto por nombre: HQ revisa el alcance. El loader sólo admite archivos regulares
`.agent-tasks/<nombre>.json` de hasta 64 KiB y rechaza enlaces del directorio/archivo.
Los inputs y rutas de escritura son declaraciones, **no permisos del sistema operativo**.

```text
APPROVED → ANALYSIS (read-only) / IMPLEMENTATION (write)
         → DETERMINISTIC_GATE → LLM_QA → READY_FOR_APPROVAL
DETERMINISTIC_GATE falla → GATE_FAIL → RETRY
LLM_QA falla             → QA_FAIL   → RETRY
RETRY → worker → gates → nueva QA
En una falla, retryCount >= maxRetries → HUMAN
NEEDS_DECISION → HUMAN
```

El contador aumenta al reservar RETRY; el segundo retry todavía puede terminar
con éxito. Una tercera falla con contador 2 escala a humano. El dispatcher deriva
el estado desde una definición `APPROVED` y mantiene snapshots opacos sólo en memoria;
no acepta estados runtime desde el JSON. Un PASS de QA nunca hace push/merge:
READY_FOR_APPROVAL es el fin del core. El dry-run predice éxito explícitamente: no
ejecuta gates/agentes, no cambia tareas, no crea worktrees y no publica nada. Rechaza
main/master y HEAD separado. Los estados del dry-run no son evidencia de ejecución.

Cuando GitHub sea transporte/control-plane, la tarea seguirá siendo una definición;
el estado runtime y la evidencia deberán vivir en una capa confiable separada, con
eventos producidos por el ejecutor confiable.

## Gates y salidas

El catálogo `scripts/agent-gates.config.mjs` contiene únicamente:

- `node-runtime`: comprueba que Node responde (`node --version`).
- `diff-check`: `git diff --check HEAD`, incluye cambios staged/unstaged versionados.
- `typecheck`: TypeScript local con `--noEmit`, sin ejecutar scripts npm de tareas.
- `agent-tests`: tests Node de esta infraestructura, separados de Vitest productivo.

No hay push/merge ni shell; comandos y args son fijos, con timeout y límite de salida.
Se valida toda la tarea antes del primer proceso. Fallar rápido es el default;
`--no-fail-fast` continúa y conserva exit 1 si cualquiera falla. Gates omitidos figuran
en `skipped`, nunca como PASS. Cada ejecutado incluye PASS/FAIL, exitCode, durationMs,
stdout/stderr y error. Timeout/fallo al lanzar también es FAIL.

Los scripts Node emiten un objeto JSON en stdout y resumen humano en stderr;
exit 0=éxito, 1=gate fallido, 2=entrada/configuración inválida. Para parsear stdout,
invocar Node directamente o `npm --silent run ...` (npm normal añade su encabezado).
No se persisten logs automáticamente. `diff-check` no inspecciona archivos nuevos
sin seguimiento ni demuestra inmutabilidad productiva. Ninguno de los gates del
piloto valida por sí solo la geometría ni la veracidad del informe NES-0001.

Los gates son **código de confianza**, no sandbox: también lo son sus dependencias,
tests y configuración TypeScript/Git. Revisarlos antes de ejecutarlos sobre cambios
no confiables; nunca permitir que una tarea remota amplíe este catálogo o sus permisos.
No se lanzan benchmarks históricos (algunos leen datos externos), lint/prettier
globales, build ni Rust por defecto. Gates específicos futuros requieren revisión local.

## Cierre de ejecución write

El modo write sólo admite planificación dry-run en este piloto. La ejecución real de
adapters sigue deshabilitada; no se habilita hasta contar con preflight de worktree,
validación efectiva de paths, control de cambios fuera de alcance y aislamiento
suficiente del sistema operativo. `allowedPaths` y `protectedPaths` siguen siendo
declaraciones, no permisos del sistema.

## Handoff para QA limpia

Una segunda sesión debe leer AGENTS/STATE/DECISIONS, tarea y diff completo (incluidos
nuevos archivos), verificar límites y reproducir `agent:test`, typecheck, validación,
dry-run y gate del ejemplo. Revisar especialmente inyección de comandos, rutas,
presupuesto de retries y que los planes no sean evidencia. Entregar hallazgos y
PASS/FAIL sin implementar en esa sesión, sin commit ni push. Esta sesión de
implementación sólo ejecuta verificaciones; no se declara QA independiente.

Antes de ejecución real faltan: aislamiento OS de rutas/red/procesos, preflight y
creación segura de worktrees, validación efectiva de paths, captura de evidencia/IDs
de sesiones distintos, control de cambios fuera de alcance, persistencia e idempotencia,
adapter ejecutable y transporte GitHub autenticado. Un worktree comparte permisos y
refs: no es un sandbox.
