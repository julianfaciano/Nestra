# Alcance de Fase 0

Implementación: shell de escritorio Tauri 2, React, TypeScript estricto, Vite, CSS,
ESLint, Prettier y Vitest. La pantalla Inicio tiene estado vacío explícito.

No implementado: perfiles físicos, siluetas, persistencia, lotes, nesting, editor,
preflight, exportación, deduplicación o calibración. La navegación no ofrece pantallas
vacías adicionales. No hay comandos IPC ni plugins habilitados.

## Decisiones

- Nombre técnico `nestra`, nombre visible `Nestra`; proyecto independiente NEStra.
- CSS simple: sin framework visual, router ni estado global hasta necesitarlos.
- Rust queda como host mínimo; las tareas pesadas se incorporarán por fase.
- Carpetas documentadas reservan límites entre capas, sin repositorios genéricos ni
  entidades anticipadas. La lógica de negocio no irá en JSX.
- SQLite diferido: todavía no hay datos que guardar.
- Fuentes del sistema para la interfaz, sin descargas. La tipografía de etiquetas
  de producción se decidirá en su fase y deberá tener licencia libre.
- CSP restrictiva; HMR permitido solo en desarrollo local. No hay servicios remotos,
  secretos, telemetría propia ni actualización automática de la app.
- Build inicial como ejecutable Windows sin instalador (`--no-bundle`). NSIS queda
  seleccionado para empaquetado futuro. El ejecutable requiere WebView2 instalado.
- Iconos de la plantilla Tauri provisionales; identidad gráfica final fuera del alcance.

## Puerta de entrada a Fase 1

Revisar esta base con el usuario. Luego implementar tipos físicos, perfiles configurables
y tests de límites. No hacen falta artes ni siluetas para comenzar Fase 1.

## Verificación de esta entrega

- Typecheck, ESLint y Prettier: correctos.
- Vitest: 1 prueba de arranque aprobada.
- Build Vite: correcto.
- Cargo check con lockfile y cargo fmt: correctos.
- Tauri release Windows x64: compilado correctamente, sin instalador.
- Ejecutable abierto: contenido de Inicio confirmado por accesibilidad de WebView2.
- Revisión visual en navegador local, incluyendo 800 × 650: correcta.
- La captura nativa falló por una interfaz de captura no soportada en este entorno;
  se verificó el contenido nativo por accesibilidad, sin afirmar una revisión visual nativa.

Entorno: Windows 10 x64, Node 24.19.0, Rust 1.98.1 MSVC,
Visual Studio Build Tools 2022 y WebView2 152.0.4191.62.
Se instalaron Build Tools/SDK y Rust porque no estaban presentes.

## Referencias

- [Prerrequisitos oficiales de Tauri para Windows](https://v2.tauri.app/start/prerequisites/)
- [Creación de proyectos Tauri](https://v2.tauri.app/start/create-project/)

La especificación original está conservada en `docs/product-specification.txt`.
