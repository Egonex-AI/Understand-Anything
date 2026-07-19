<h1 align="center">Understand Anything</h1>
<p align="center">
  <strong>Convierte cualquier código fuente, base de conocimiento o documentación en un grafo de conocimiento interactivo que puedes explorar, buscar y consultar.</strong>
  <br />
  <em>Compatible con Claude Code, Codex, Cursor, Copilot, Gemini CLI y más.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Understand Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a>
</p>

<p align="center">
  <a href="#-inicio-rápido"><img src="https://img.shields.io/badge/Inicio_Rápido-blue" alt="Quick Start" /></a>
  <a href="https://github.com/Egonex-AI/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/Licencia-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/Página_Principal-d4a574" alt="Homepage" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/Demo_en_Vivo-00c853" alt="Live Demo" /></a>
</p>

<p align="center">
  <img src="../assets/hero.png" alt="Understand Anything — Convierte cualquier código fuente en un grafo de conocimiento interactivo" width="800" />
</p>

<p align="center">
  <strong>An open-source project from <a href="https://github.com/Egonex-AI">Egonex</a></strong>
  <br />
  <em>Originally created by <a href="https://github.com/Lum1104">Lum1104</a>.</em>
</p>

---

**Acabas de unirte a un nuevo equipo. El código tiene 200,000 líneas. ¿Por dónde empiezas?**

Understand Anything es un [Claude Code Plugin](https://code.claude.com/docs/en/plugins-reference#plugins-reference) que analiza tu proyecto con un pipeline multi-agente, construye un grafo de conocimiento de cada archivo, función, clase y dependencia, y luego te ofrece un panel interactivo para explorarlo visualmente. Deja de leer código a ciegas. Empieza a ver el panorama completo.

> **El objetivo no es un grafo que te impresione mostrándote lo complejo que es tu código — es un grafo que, sin alardes, te enseña cómo encaja cada pieza.**

---

## ✨ Características

> [!NOTE]
> **¿Quieres probarlo directamente?** Prueba la [demo en vivo](https://understand-anything.com/demo/) en nuestra [página principal](https://understand-anything.com/) — un panel interactivo donde puedes navegar, hacer zoom, buscar y explorar directamente en tu navegador.

### Explora el grafo estructural

Navega tu código como un grafo de conocimiento interactivo: cada archivo, función y clase es un nodo que puedes hacer clic, buscar y explorar. Selecciona cualquier nodo para ver resúmenes en lenguaje natural, relaciones y recorridos guiados.

### Comprende la lógica de negocio

Cambia a la vista de dominio y observa cómo tu código se mapea a procesos de negocio reales: dominios, flujos y pasos representados como un grafo horizontal.

### Analiza bases de conocimiento

Apunta `/understand-knowledge` a un [wiki LLM con patrón Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) y obtén un grafo de conocimiento dirigido por fuerzas con agrupación por comunidad. El parser determinístico extrae wikilinks y categorías de `index.md`, luego los agentes LLM descubren relaciones implícitas, extraen entidades y revelan afirmaciones, convirtiendo tu wiki en un grafo navegable de ideas interconectadas.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 Recorridos Guiados</h3>
      <p>Recorridos generados automáticamente de la arquitectura, ordenados por dependencia. Aprende el código en el orden correcto.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 Búsqueda Difusa y Semántica</h3>
      <p>Encuentra cualquier cosa por nombre o por significado. Busca "¿qué partes manejan la autenticación?" y obtén resultados relevantes en todo el grafo.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Análisis de Impacto de Cambios</h3>
      <p>Visualiza qué partes del sistema afectan tus cambios antes de hacer commit. Comprende los efectos en cascada a través del código.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 Interfaz Adaptativa por Persona</h3>
      <p>El panel ajusta su nivel de detalle según quién eres: desarrollador junior, PM o usuario avanzado.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ Visualización por Capas</h3>
      <p>Agrupación automática por capa arquitectónica — API, Servicio, Datos, UI, Utilidades — con leyenda codificada por colores.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 Conceptos del Lenguaje</h3>
      <p>12 patrones de programación (genéricos, closures, decoradores, etc.) explicados en contexto donde aparecen.</p>
    </td>
  </tr>
</table>

---

## 🚀 Inicio Rápido

### 1. Instala el plugin

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

> **¿Usas un modelo local?** Para configuraciones de privacidad o empresariales, apunta tu plataforma a un proveedor de modelos local como [Ollama](https://docs.ollama.com/integrations) — sigue su guía de integración para cambiar el proveedor de modelo.

### 2. Analiza tu código

```bash
/understand
```

Un pipeline multi-agente escanea tu proyecto, extrae cada archivo, función, clase y dependencia, y construye un grafo de conocimiento guardado en `.ua/knowledge-graph.json`. (Los proyectos que ya tienen un directorio `.understand-anything/` lo siguen usando: sigue siendo el directorio de datos cuando está presente, así que no hay que migrar nada.)

> **Aviso sobre el consumo de tokens:** El primer `/understand` analiza todo tu código y puede consumir una cantidad significativa de tokens en proyectos grandes. Recomendamos ejecutarlo con un plan / suscripción de tokens, o usar un modelo local (ver arriba) para la inicialización. Las ejecuciones posteriores son incrementales por defecto — solo se reanalizan los archivos modificados — por lo que usan muchos menos tokens.

**Salida localizada:** Usa `--language` para generar contenido en tu idioma preferido:

```bash
# Genera contenido en el idioma preferido (descripciones de nodos y UI del dashboard)
/understand --language en

# Idiomas soportados: en (default), zh, zh-TW, ja, ko, ru
```

El parámetro `--language` afecta:
- Resúmenes y descripciones de nodos en el grafo de conocimiento
- Etiquetas, botones y tooltips de la UI del dashboard
- Explicaciones de los tours guiados

### 3. Explora el panel

```bash
/understand-dashboard
```

Se abre un panel web interactivo con tu código visualizado como un grafo, codificado por colores según la capa arquitectónica, con funciones de búsqueda y clic. Selecciona cualquier nodo para ver su código, relaciones y una explicación en lenguaje natural.

### 4. Sigue aprendiendo

```bash
# Pregunta cualquier cosa sobre el código
/understand-chat How does the payment flow work?

# Analiza el impacto de tus cambios actuales
/understand-diff

# Profundiza en un archivo o función específica
/understand-explain src/auth/login.ts

# Genera una guía de incorporación para nuevos miembros del equipo
/understand-onboard

# Extrae conocimiento de dominio de negocio (dominios, flujos, pasos)
/understand-domain

# Analiza un wiki LLM con patrón Karpathy
/understand-knowledge ~/path/to/wiki

# Vuelve a ejecutarlo cuando quieras — incremental por defecto (solo archivos modificados)
/understand

# Instala un hook post-commit para actualizaciones incrementales automáticas
/understand --auto-update

# Acota el análisis a un subdirectorio (útil para monorepos enormes)
/understand src/frontend
```

---

## 🌐 Instalación Multiplataforma

Understand-Anything funciona en múltiples plataformas de codificación con IA.

### Claude Code (Nativo)

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

### Instalación de una línea (Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI / Nanobot / Kiro)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash
# o pasa la plataforma directamente para saltar el prompt:
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s codex
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.ps1 | iex
```

El instalador clona el repositorio en `~/.understand-anything/repo` y crea los enlaces simbólicos correspondientes para la plataforma elegida. Reinicia tu CLI/IDE al terminar.

> **Nota sobre cómo invocar las skills:** el prefijo de invocación varía según la plataforma. La mayoría usa comandos con barra (`/understand`), pero **Codex usa `$`** — escribe `$understand`, no `/understand`. Si ningún prefijo funciona, pídelo en lenguaje natural: *«Usa la skill understand para analizar este proyecto»*.

- Valores soportados de `<platform>`: `gemini`, `codex`, `opencode`, `pi`, `openclaw`, `antigravity`, `vibe`, `vscode`, `hermes`, `cline`, `kimi`, `nanobot`, `kiro`
- Actualizar más adelante: `./install.sh --update`
- Desinstalar: `./install.sh --uninstall <platform>`

### Cursor

Cursor detecta automáticamente el plugin a través de `.cursor-plugin/plugin.json` cuando se clona este repositorio. No requiere instalación manual: simplemente clona y abre en Cursor.

Si la detección automática no lo reconoce, instálalo manualmente: abre **Cursor Settings → Plugins**, pega `https://github.com/Egonex-AI/Understand-Anything` en el campo de búsqueda y añádelo desde allí.

### VS Code + GitHub Copilot

VS Code con GitHub Copilot (v1.108+) detecta automáticamente el plugin a través de `.copilot-plugin/plugin.json` cuando se clona este repositorio. No requiere instalación manual: simplemente clona y abre en VS Code.

Para habilidades personales (disponibles en todos los proyectos), ejecuta el `install.sh` de arriba con la plataforma `vscode`.

### Copilot CLI

```bash
copilot plugin install Egonex-AI/Understand-Anything:understand-anything-plugin
```

### Kiro CLI / IDE

```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s kiro
```

Tras la instalación:
- **Kiro CLI**: `kiro-cli chat --agent understand "Analiza este proyecto"`
- **Kiro IDE**: Las habilidades se enlazan simbólicamente en `~/.kiro/skills/` y el agente `understand` se escribe en `~/.kiro/agents/understand.json`, de modo que ambos quedan disponibles tras reiniciar el IDE.

Para habilidades personales (disponibles en todos los proyectos), ejecuta el `install.sh` de arriba con la plataforma `kiro`.

### Compatibilidad de Plataformas

| Plataforma | Estado | Método de Instalación |
|----------|--------|----------------|
| Claude Code | ✅ Nativo | Marketplace de plugins |
| Cursor | ✅ Soportado | Detección automática |
| VS Code + GitHub Copilot | ✅ Soportado | Detección automática |
| Copilot CLI | ✅ Soportado | Instalación de plugin |
| Codex | ✅ Soportado | `install.sh codex` |
| OpenCode | ✅ Soportado | `install.sh opencode` |
| OpenClaw | ✅ Soportado | `install.sh openclaw` |
| Antigravity | ✅ Soportado | `install.sh antigravity` |
| Gemini CLI | ✅ Soportado | `install.sh gemini` |
| Pi Agent | ✅ Soportado | `install.sh pi` |
| Vibe CLI | ✅ Soportado | `install.sh vibe` |
| Hermes | ✅ Soportado | `install.sh hermes` |
| Cline | ✅ Soportado | `install.sh cline` |
| KIMI CLI | ✅ Soportado | `install.sh kimi` |
| Nanobot | ✅ Soportado | `install.sh nanobot` |
| Kiro CLI / IDE | ✅ Soportado | `install.sh kiro` |

---

## 📦 Comparte el Grafo con tu Equipo

El grafo es solo JSON — **confírmalo una vez y tus compañeros se saltan el pipeline**. Ideal para onboarding, revisiones de PR y flujos docs-as-code.

> **Ejemplo:** [GoogleCloudPlatform/microservices-demo](https://github.com/GoogleCloudPlatform/microservices-demo) — referencia políglota (Go / Java / Python / Node) con el grafo ya confirmado.

**Qué confirmar:** todo lo que hay en `.ua/` *excepto* `intermediate/` y `diff-overlay.json` (archivos temporales locales). (Los proyectos heredados usan `.understand-anything/`: sustituye ese nombre de directorio abajo si es el que está presente.)

```gitignore
.ua/intermediate/
.ua/diff-overlay.json
```

**Mantenlo al día:** activa `/understand --auto-update` — un hook post-commit parchea el grafo de forma incremental, así cada commit llega con su grafo correspondiente. O vuelve a ejecutar `/understand` manualmente antes de cada release.

**Grafos grandes (10 MB o más):** úsalos con **git-lfs**.

```bash
git lfs install
git lfs track ".ua/*.json"
git add .gitattributes .ua/
```

### Ver el dashboard sin Claude Code

Una vez que el grafo se ha generado y subido al repositorio, cualquier persona del equipo puede abrirlo con un solo comando: sin Claude Code, sin LLM, sin clave de API. Solo hace falta Node.js (>= 18):

```bash
npx https://github.com/Egonex-AI/Understand-Anything/releases/latest/download/understand-anything-viewer.tgz /path/to/analyzed/project
```

La terminal imprime una URL con token (`http://127.0.0.1:5173/?token=…`) y abre el dashboard interactivo completo en tu navegador. El directorio del proyecto (por defecto: el directorio actual) debe contener el directorio de datos versionado (`.ua/`, o el heredado `.understand-anything/`). Todo se sirve en modo solo lectura desde el disco local: sin llamadas al LLM, sin que ningún dato salga de tu máquina.

¿Trabajas desde un clon del repositorio? `pnpm install && pnpm --filter @understand-anything/core build`, y luego `GRAPH_DIR=/path/to/analyzed/project pnpm dev:dashboard` hace lo mismo a través del servidor de desarrollo de Vite.

---

## 🔧 Bajo el Capó

### Híbrido Tree-sitter + LLM

Lo determinista lo hace el análisis estático, lo semántico lo hace el LLM:

- **Tree-sitter (determinista)** — parsea el código a un árbol de sintaxis concreto y extrae hechos estructurales: imports, exports, definiciones de funciones/clases, llamadas, herencia. Se preresuelve como `importMap` en la fase de escaneo y se pasa al file-analyzer para que no tenga que volver a derivar los imports desde el código fuente. La misma entrada siempre produce la misma salida, y también es la base de los fingerprints usados para las actualizaciones incrementales.
- **LLM (semántico)** — lee la estructura parseada junto con el código original para producir lo que los parsers no pueden: resúmenes en lenguaje natural, etiquetas, asignaciones de capa arquitectónica, mapeo de dominios de negocio, tours guiados, notas sobre conceptos del lenguaje.

Esta división es la que hace que el grafo sea reproducible en lo estructural (el mismo código siempre genera las mismas aristas) y a la vez capture intención en lo semántico (para *qué* sirve un archivo, no solo qué importa).

### Pipeline Multi-Agente

El comando `/understand` orquesta 5 agentes especializados, y `/understand-domain` añade un sexto:

| Agente | Rol |
|-------|------|
| `project-scanner` | Descubre archivos, detecta lenguajes y frameworks |
| `file-analyzer` | Extrae funciones, clases e importaciones; produce nodos y aristas del grafo |
| `architecture-analyzer` | Identifica capas arquitectónicas |
| `tour-builder` | Genera recorridos de aprendizaje guiados |
| `graph-reviewer` | Valida la completitud y la integridad referencial del grafo (se ejecuta inline por defecto; usa `--review` para una revisión completa con LLM) |
| `domain-analyzer` | Extrae dominios de negocio, flujos y pasos de proceso (usado por `/understand-domain`) |
| `article-analyzer` | Extrae entidades, afirmaciones y relaciones implícitas de artículos wiki (usado por `/understand-knowledge`) |

Los analizadores de archivos se ejecutan en paralelo (hasta 5 concurrentes, 20-30 archivos por lote). Soporta actualizaciones incrementales: solo reanaliza los archivos que cambiaron desde la última ejecución.

---

## 🎥 Comunidad

Un recorrido en video hecho por la comunidad de **Better Stack**.

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Recorrido en video por la comunidad de Better Stack — haz clic para ver en YouTube" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">Ver en YouTube &rarr;</a></em>
</p>

¿Has hecho un video, post o tutorial? Abre un issue o PR — estaremos encantados de mostrarlo aquí.

---

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Así puedes empezar:

1. Haz fork del repositorio
2. Crea una rama de funcionalidad (`git checkout -b feature/my-feature`)
3. Ejecuta las pruebas (`pnpm --filter @understand-anything/core test`)
4. Haz commit de tus cambios y abre un pull request

Para cambios importantes, abre primero un issue para que podamos discutir el enfoque.

---

<p align="center">
  <strong>Deja de leer código a ciegas. Empieza a entenderlo todo.</strong>
</p>

## Historial de Stars

<a href="https://www.star-history.com/?repos=Egonex-AI%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>Gracias a todas las personas que lo han usado y han contribuido — saber que les ahorra tiempo es lo que hizo que valiera la pena construirlo.</em>
</p>

<p align="center">
  MIT License &copy; Yuxiang Lin and Infinite Universe, Inc.
</p>
