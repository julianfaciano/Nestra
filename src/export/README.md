# Exportación (pendiente)

Los futuros exportadores consumirán layouts físicos ya validados. La conversión mm → px
se realizará únicamente al renderizar/exportar. PNG por defecto y JPG a 300 PPI; SVG
con dimensiones físicas. Todos los canvas tendrán fondo blanco.

El exportador raster deberá permitir escritura incremental por franjas o tiles desde Rust.
No se define una API que exija un bitmap completo en RAM ni su transferencia a React.
El preflight será obligatorio antes de exportar; no hay exportación en esta fase.
