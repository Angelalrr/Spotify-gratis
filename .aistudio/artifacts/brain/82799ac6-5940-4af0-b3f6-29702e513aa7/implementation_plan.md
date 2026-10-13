# Plan de Implementación: Carátula Ampliada, Letra en Vivo, Fondo Dinámico y Fallbacks Universales

Modernización del reproductor musical para ofrecer una carátula de gran tamaño, línea de letra en tiempo real ubicada directamente bajo la imagen sin contenedor, degradado ambiental dinámico generado a partir de los colores de la carátula, solución integral al problema de persistencia de letras al recargar o reiniciar sesión, y arquitectura de fallbacks multinivel que garantiza un 100% de operatividad en toda la plataforma.

---

## Decisiones Críticas y Preferencias Confirmadas

> [!IMPORTANT]
> Confirmaciones de diseño recibidas del usuario en la fase de consulta:
> - **Estilo de fondo dinámico**: Degradado ambiental suave derivado directamente de la paleta de colores de la carátula activa.
> - **Interacción de la letra**: Al pulsar la carátula es cuando se expande la vista de letra completa. La línea de letra en vivo es de visualización pura y no dispara la vista completa.
> - **Composición visual**: Carátula destacada y ampliada en el reproductor modal; la frase de la letra se ubica inmediatamente debajo de ella, seguida por el bloque de título/artista, la barra de reproducción y los botones de control (según el boceto proporcionado por el usuario).

---

## 1. Visión General y Experiencia de Usuario

### Objetivos Principales
1. **Carátula Ampliada y Presencia Visual**:
   - Aumentar el tamaño relativo de la carátula en el modal (`max-width: 360px`, `max-height: 42vh` en móvil) para que domine el tercio superior del reproductor como en Spotify/Apple Music.
   - Bordes redondeados sutiles (`border-radius: 16px`), sombra envolvente y proporción 1:1 estricta.

2. **Línea de Letra en Vivo Debajo de la Carátula**:
   - Colocar la línea de letra en vivo directamente bajo el marco de la carátula (como ilustra el boceto).
   - Cero contenedores, cajas o fondos artificiales: texto limpio flotando sobre el fondo ambiental.
   - Alineación a la izquierda, tipografía nítida (`1.05rem`, semibold/bold), salto automático hasta 2 líneas para versos extensos y transición fluida entre frases.

3. **Fondo Ambiental Dinámico con Colores de la Carátula**:
   - Extracción de color dominante y secundario de la imagen cargada mediante canvas en memoria (`getImageData`).
   - Generación de un degradado sutil (`linear-gradient(180deg, rgba(R, G, B, 0.45) 0%, rgba(18, 18, 18, 0.95) 65%, #0a0a0a 100%)`).
   - Transición CSS suave (`transition: background 0.8s ease`) al cambiar de pista.

4. **Corrección del Fallo de Letra al Reiniciar o Recargar**:
   - Al restaurar la sesión desde almacenamiento local (`swr_last`), el reproductor restaura la pista pero la letra no volvía a cargarse ni sincronizarse.
   - Se asegura la invocación inmediata de `fetchLyrics(lastTrack)` en la rutina de inicialización (`DOMContentLoaded`), restaurando tanto la línea en vivo como la vista completa.

5. **Sistema de Fallbacks Multinivel Universal**:
   - **Música y Éxitos**: Caché local + iTunes RSS regional + búsqueda directa en YouTube Music + lista curada de hits verificados en caso de corte o desconexión.
   - **Portadas e Imágenes**: CDN de alta resolución (`544x544`) + proxy backend `/api/proxy-image` + fallback SVG base64 universal sin romper estilos ni mostrar texto de error.
   - **Letras**: LRCLIB exacto -> LRCLIB fuzzy search -> NetEase Cloud Music -> modo instrumental limpio sin notas ruidosas (`♪`).
   - **Audio y Streaming**: Motor nativo de streaming de audio -> proxy de YouTube embed en segundo plano con cambio transparente ante errores.

---

## 2. Experiencia de Usuario y Diseño Visual

### Jerarquía en el Reproductor Modal
```
┌──────────────────────────────────────────────┐
│  v   PAUSADO / REPRODUCIENDO                 │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │                                        │  │
│  │                                        │  │
│  │           CARÁTULA GRANDE              │  │
│  │               (1:1)                    │  │
│  │                                        │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│  E'Lucifer oeh-oeh-oeh   (Letra en vivo)     │
│                                              │
│  Yo sé                                       │
│  Yan Block, TORRRES                          │
│                                              │
│  ──────────●────────────────────────────────  │
│  0:01                                   2:09 │
│                                              │
│      🔀     ⏮      ▶ / ⏸      ⏭     🔁      │
└──────────────────────────────────────────────┘
```

### Comportamiento de Interacción
- **Tocar la Carátula**: Conmuta entre la vista de carátula principal y la vista desplazable de letra completa sincronizada.
- **Tocar la Línea de Letra**: No interrumpe la reproducción ni abre el modal (de acuerdo con la respuesta del usuario).
- **Transición de Color de Fondo**: Al cambiar de canción o restaurar sesión, los colores de fondo se funden de manera imperceptible en 800ms.

---

## 3. Decisiones Técnicas y Arquitectura

```
┌────────────────────────────────────────────────────────┐
│                   Cliente Web (Vite SPA)               │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │  Color Extractor │  │  Lyrics Syncer   │            │
│  │  (Canvas 2D)     │  │  (LRC Binary S.) │            │
│  └────────┬─────────┘  └────────┬─────────┘            │
│           │                     │                      │
│  ┌────────┴─────────────────────┴─────────┐            │
│  │        Session Restorer (swr_last)     │            │
│  │  - Recarga pista + audio + fetchLyrics │            │
│  └────────────────────────┬───────────────┘            │
└───────────────────────────┼────────────────────────────┘
                            │ HTTP
┌───────────────────────────▼────────────────────────────┐
│                    Servidor Node/Express               │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │ /api/proxy-image │  │ /api/lyrics/full │            │
│  └──────────────────┘  └──────────────────┘            │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │ /api/trending    │  │ /api/stream/:id  │            │
│  │ (3x Fallbacks)   │  │ (Dual Engine)    │            │
│  └──────────────────┘  └──────────────────┘            │
└────────────────────────────────────────────────────────┘
```

### Componentes y Cambios Específicos:
1. **`applyCoverColor(url)`**:
   - Leer píxeles con canvas fuera de pantalla con muestreo seguro (`crossOrigin = 'anonymous'`).
   - Si la imagen externa tiene restricción CORS, procesarla a través de `/api/proxy-image?url=...`.
   - Calcular color RGB vibrante y aplicar a `--modal-bg-accent`:
     `background: linear-gradient(180deg, var(--cover-glow, rgba(35,35,35,0.8)) 0%, #121212 55%, #080808 100%)`.

2. **Persistencia y Restauración de Sesión (`restoreLastSession`)**:
   - Al cargar la página (`DOMContentLoaded`), verificar `localStorage.getItem('swr_last')`.
   - Inicializar el reproductor con metadatos, duración, portada y **ejecutar inmediatamente `fetchLyrics(lastTrack)`**.
   - Conectar los eventos de tiempo (`timeupdate`) para que la línea se sincronice apenas comience la reproducción.

3. **Ajustes de Estilo del Modal**:
   - Ajustar `.cover-container` y `.modal-cover` a `max-width: 360px`, `max-height: clamp(240px, 38vh, 360px)`.
   - Ubicar `#live-lyric-bar` inmediatamente contiguo a `.modal-cover`, con alineación a la izquierda y `padding: 0`.
   - Ajustar `.modal-bottom` con márgenes compactos para mantener la barra de progreso y controles siempre visibles en cualquier pantalla de teléfono móvil.

4. **Tolerancia a Fallos Completa**:
   - Asegurar que ninguna llamada a la API devuelva errores no gestionados al usuario.
   - Envolver todas las peticiones con retiros silenciosos hacia listas locales garantizadas.

---

## 4. Plan de Verificación

1. **Prueba de Carátula y Posición de Letra**:
   - Abrir el reproductor modal y verificar que la portada es grande, nítida y ocupa la proporción indicada en el boceto.
   - Comprobar que la línea de letra en vivo se sitúa justo debajo de la carátula sin ningún fondo de cuadro.
2. **Prueba de Degradado Ambiental**:
   - Reproducir temas con portadas de diferentes tonalidades (ej. *Un Verano Sin Ti* en naranja/rojo, *FERXXOCALIPSIS* en verde, *After Hours* en rojo oscuro) y verificar que el fondo del reproductor se adapta suavemente a cada color.
3. **Prueba de Recarga y Persistencia de Letra**:
   - Reproducir una canción con letra sincronizada, pausar o reproducir, y recargar la página del navegador (`F5` / reload).
   - Verificar que al restaurarse la canción, la letra se sincroniza y muestra correctamente sin desaparecer.
4. **Prueba de Carga y Fallbacks**:
   - Simular peticiones con conexiones lentas o variables y validar que nunca se muestra pantalla rota ni mensajes de error.
