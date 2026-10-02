# Decisiones de orquestación

| Decisión                         | Motivo / límite                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| GitHub será el bus/control-plane | Issues y labels reflejarán estados; hoy sólo JSON local, sin operaciones remotas.           |
| Dispatcher local mínimo          | Cargar, validar y planificar. Sin scheduler, daemon, base de datos ni framework.            |
| HQ, Engineer/Analyst y QA        | Responsabilidades separadas de modelos; Codex es el primer adapter previsto.                |
| QA independiente                 | Nueva sesión tras gates; conservar evidencia y sesión de cada actor al habilitar ejecución. |
| Gates deterministas              | Catálogo local revisado, IDs cerrados, sin comandos provenientes de tareas/issues.          |
| Worktree por tarea de escritura  | Aislar cambios de Git; no confundirlo con sandbox de disco/red/procesos.                    |
| Máximo 2 retries                 | Hasta 3 intentos; falla posterior o decisión necesaria → humano.                            |
| Human gates                      | Push, merge, main/master y producción requieren autorización humana explícita.              |
| Performance es un tipo de tarea  | No necesita un agente fijo; maintenance/docs es auxiliar.                                   |
| Cline Kanban es opcional         | Puede visualizar tareas en el futuro; nunca es autoridad ni dependencia.                    |
| Transporte separado del core     | `loadTask` carga definiciones; el runtime local es efímero y GitHub requerirá estado confiable separado. |
| Activación posterior explícita   | Sin ejecución CLI de agentes, transporte remoto ni persistencia de estados en v0.           |
