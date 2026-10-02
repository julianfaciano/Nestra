# Operación de agentes en Nestra

Flujo: **HQ humano/ChatGPT → tarea aprobada → dispatcher local → Engineer/Analyst
→ gate determinista → QA en sesión nueva → resultado / retry / decisión humana**.
Leer `docs/STATE.md`, `docs/DECISIONS.md` y `.agent-tasks/README.md` antes de actuar.

- HQ define alcance y aprueba. Engineer/Analyst implementa o investiga. QA revisa
  evidencia en una sesión limpia: nunca implementar y auditar en la misma sesión.
  Los tests del implementador no sustituyen esa QA.
- Un rol es una responsabilidad; un modelo es una elección del adapter. Pueden
  compartir modelo, nunca contexto de sesión. Performance es un tipo de tarea;
  maintenance/docs es una tarea o fase auxiliar, no un asiento permanente.
- Toda escritura requiere un worktree dedicado y una rama de tarea. Verificar rama,
  HEAD, limpieza inicial y alcance. No cambiar `master`/`main`, hacer push ni merge
  sin autorización humana explícita. Este piloto no implementa esas operaciones.
- Un **worktree no es un sandbox**: comparte objetos/refs de Git y permisos del
  usuario. No impide acceso al disco, red, credenciales o procesos. Antes de activar
  agentes reales se necesitan aislamiento y permisos efectivos, además de estas reglas.
- Prohibido acceder, modificar o borrar `.fanaticotas`, backups externos, `.env`
  y credenciales, datos productivos, carpetas fuera del worktree, registry/configuración
  del sistema o procesos no relacionados. Las referencias históricas no autorizan acceso.
  Respetar `allowedPaths` y `protectedPaths`; no seguir symlinks/junctions fuera del alcance.
- Proteger el baseline `976cb21`. No cambiar nesting, geometría, PDF, PNG, UI ni
  comportamiento productivo en tareas de infraestructura. Nunca relajar invariantes
  físicas para mejorar benchmarks: Imprenta 2 mantiene canvas 1560 × 5000 mm,
  gap visible 3 mm, stroke láser negro 3 mm, clearance 6 mm y margen exterior 1.5 mm.
- Sólo ejecutar gates locales/versionados y revisados. Un PASS del LLM no sustituye
  al gate; un PASS del gate tampoco sustituye a QA ni concede permiso de producción.
- Máximo **2 retries** después del intento inicial; cada retry repite gates y QA
  nueva. Escalar a humano al agotarlos, ante límites de seguridad, inputs ausentes,
  evidencia contradictoria, ampliación de alcance o decisiones productivas.
- En este piloto: archivos locales y dry-run; sin GitHub remoto, commit, push, merge,
  ejecución real de agentes ni cambios de producción. Dejar la QA para otra sesión.
