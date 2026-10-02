# Estado operativo

- Baseline productivo protegido: `976cb21` — “Checkpoint: Imprenta 2 production
  and export pipeline”. Imprenta 2 ya es funcional; esta infraestructura no altera
  su implementación ni acredita una nueva validación productiva.
- El worktree de infraestructura usa `chore/agent-orchestration`; `master` se conserva.
- La arquitectura multiagente está en piloto local: tareas JSON, gates deterministas
  y dispatcher sólo dry-run. No hay transporte GitHub, agentes ejecutándose ni QA automática.
- Los JSON locales son definiciones iniciales: dispatch exige APPROVED, retryCount 0,
  result null y humanDecisionRequired false; el runtime sólo se deriva en memoria.
  GitHub requerirá una capa confiable de estado/evidencia separada de la definición.
- La ejecución real, incluido write mode, sigue deshabilitada hasta tener preflight de
  worktree, validación de paths, control de cambios fuera de alcance y aislamiento OS.
- Próximo experimento: **NES-0001**, análisis read-only de ~115.64 m de Imprenta 2
  frente a ~109 m históricos de Calandra. Su definición local no ejecuta el análisis.
  Debe identificar la corrida de ~63 → ~24 layouts: la evidencia versionada también
  contiene otra corrida de 67 → 24 y 117.557678 m; no son cifras intercambiables.
- Codex es el primer adapter previsto, sin modelo fijado. Claude, OpenCode Go,
  OpenHands y modelos locales no forman parte del sistema activo.

Deuda preexistente fuera de alcance: el README raíz conserva texto de Fase 0;
ESLint/Prettier globales tienen deuda histórica y no son gates bloqueantes por defecto.
Vitest completo puede agotar timeouts con concurrencia; preferir tests relevantes
aislados con un margen documentado. Typecheck, build web y Rust fmt/check/tests se
reportaron aprobados en el baseline; eso no equivale a haberlos repetido aquí.
