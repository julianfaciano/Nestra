# Nestra

Aplicación de escritorio para Windows orientada a preparación y nesting de artes
textiles de sublimación. Proyecto independiente NEStra; nombre visible **Nestra**.

Esta entrega implementa solamente **Fase 0**: base Tauri + React, pantalla Inicio,
tema visual, herramientas de calidad y límites entre módulos. Todavía no importa,
guarda, optimiza ni exporta trabajos. Fase 1 requiere revisión previa del usuario.

## Ejecutar en Windows

Requisitos de desarrollo: Node.js 24 LTS o posterior, Rust estable MSVC,
Microsoft C++ Build Tools con el SDK de Windows y WebView2 Runtime.
Ver [prerrequisitos oficiales](https://v2.tauri.app/start/prerequisites/).
Después de instalar Rust, abrir una terminal nueva para actualizar el PATH.

```powershell
# Ejecutar desde la raíz del repositorio clonado.
npm ci
npm run tauri dev
```

`npm run dev` inicia solamente la interfaz en <http://127.0.0.1:1420>.
No ejecutarlo a la vez que `tauri dev`: Tauri inicia su propio servidor en ese puerto.

## Comprobaciones y build

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run check:rust
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run build:windows
```

`build:windows` genera `src-tauri/target/release/nestra.exe` sin instalador.
Se puede abrir directamente y requiere WebView2 instalado. No necesita Node, Rust,
servidor Vite ni conexión a Internet para su uso. Las herramientas y dependencias
de desarrollo sí se descargan durante la preparación/primera compilación.

`npm run format` aplica Prettier. `npm run test:watch` deja Vitest en modo continuo.
La prueba inicial verifica el arranque del estado vacío; los tests de reglas físicas
se escribirán junto a su implementación en Fase 1.

## Estructura

```text
src/
  app/          Composición de la UI y pantalla Inicio
  ui/           Tema CSS
  domain/       Reservado: unidades y reglas puras de producción
  geometry/     Reservado: integración con geometría/nesting
  persistence/  Reservado: adaptación de datos locales
  export/       Reservado: exportadores sobre layouts físicos validados
  test/         Configuración de tests
src-tauri/
  src/          Host Rust mínimo
  capabilities/ Permisos explícitos, vacíos por ahora
  tauri.conf.json
docs/
  phase-0.md                Decisiones y alcance
  product-specification.txt Pedido original completo
```

Las carpetas reservadas contienen solamente documentación. No hay lógica geométrica
en React ni contratos prematuros. SQLite se evaluará cuando aporte valor real.
Los futuros layouts usarán mm; el raster se calculará al exportar y el diseño del
exportador deberá admitir procesamiento por franjas/tiles sin un bitmap gigante en RAM.

La app no tiene autenticación, servicios cloud, secretos ni plugins de red.
El identificador provisional de aplicación es `com.nestra.desktop`.
Los iconos de la plantilla Tauri son provisionales.

## Próximo paso

Revisar Fase 0. Después: unidades mm/cm, CanvasProfile, configuración de Imprenta y
Calandra, validaciones y tests de límites. No avanzar automáticamente.
