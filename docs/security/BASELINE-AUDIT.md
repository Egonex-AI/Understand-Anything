# Security baseline audit

Estado: borrador para revisión, no aprobado para instalación.

Commit declarado por el ZIP: `b232f356446295e4eaa05b9b285e08ce5cd5e8a0`. SHA-256 del ZIP: `5c7e379e810bf979e5063d650e24aababcda61760f59c3d98e0e8f3aaa5c9730`. CRC verificado; 538 archivos. No se ha contrastado el contenido con un checkout remoto ni ejecutado el plugin.

## Alcance

Revisión estática dirigida de los puntos citados, consolidando la auditoría previa. Las prioridades son de hardening, no CVSS ni vulnerabilidades explotadas. No se encontró un mecanismo explícito de exfiltración maliciosa en los puntos revisados; ello no certifica ausencia de malware. Dependencias transitivas, agentes restantes, pruebas dinámicas y tráfico quedan pendientes.

## Registro de hallazgos

### SEC-001 · Alta

- Evidencia: `package.json:30,47-62`.
- Observación: prepare y onlyBuiltDependencies habilitan compilación
- Mitigación propuesta: Separar instalación y build; revisar scripts autorizados.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-002 · Alta

- Evidencia: `install.sh:97,271; install.ps1:93,280`.
- Observación: pull --ff-only sin pin de release
- Mitigación propuesta: Instalar artefactos aprobados con hash.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-003 · Alta

- Evidencia: `install.sh:121-143; install.ps1:128-159`.
- Observación: Enlaces/junctions a checkout mutable
- Mitigación propuesta: Distribución versionada separada del desarrollo.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-004 · Media

- Evidencia: `install.sh:21-22; install.ps1:25-26`.
- Observación: Origen y destino controlados por entorno; requiere control de esas variables
- Mitigación propuesta: Validar origen y destino; autorización explícita.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-005 · Media

- Evidencia: `install.sh:130,153-168; install.ps1:128-136`.
- Observación: Reemplazo de enlaces sin comprobación de pertenencia completa
- Mitigación propuesta: Registrar propiedad y rechazar colisiones.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-006 · Alta

- Evidencia: `install.sh:12-13`.
- Observación: Ejemplo curl | bash desde main mutable; no es ejecución automática
- Mitigación propuesta: Documentar instalación por release verificada.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-007 · Alta

- Evidencia: `understand-anything-plugin/hooks/hooks.json:3-23`.
- Observación: Registro PostToolUse y SessionStart en plataforma compatible
- Mitigación propuesta: Opt-in externo por proyecto.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-008 · Alta

- Evidencia: `understand-anything-plugin/hooks/post-tool-use-auto-update.mjs:48-52`.
- Observación: Instrucción de no pedir confirmación; no demuestra bypass de sandbox
- Mitigación propuesta: Respetar autorización y alcance.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-009 · Alta

- Evidencia: `understand-anything-plugin/hooks/session-start-stale-check.mjs:22-23`.
- Observación: Override de ruta de prompt por entorno
- Mitigación propuesta: Resolver instrucciones desde release confiable.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-010 · Alta

- Evidencia: `understand-anything-plugin/hooks/post-tool-use-auto-update.mjs:13-23,44-46`.
- Observación: autoUpdate depende de configuración del proyecto
- Mitigación propuesta: Separar preferencias de autorización externa.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-011 · Media

- Evidencia: `understand-anything-plugin/hooks/post-tool-use-auto-update.mjs:11,42`.
- Observación: Regex de comandos no prueba cambio efectivo de HEAD
- Mitigación propuesta: Verificar HEAD anterior y posterior.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-012 · Alta

- Evidencia: `understand-anything-plugin/hooks/auto-update-prompt.md:48-56,90-91`.
- Observación: Subagentes pueden procesar código remotamente según proveedor
- Mitigación propuesta: Consentimiento de datos y presupuesto; modo local diferenciado.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-013 · Alta

- Evidencia: `understand-anything-plugin/packages/dashboard/vite.config.ts:125-175; understand-anything-plugin/packages/viewer/bin/viewer.mjs:144-186`.
- Observación: Validación lexical seguida de stat/read; escape por symlink condicionado a acceso y grafo
- Mitigación propuesta: Confinamiento efectivo y pruebas de carreras.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-014 · Alta

- Evidencia: `understand-anything-plugin/packages/dashboard/vite.config.ts:66-80,157-175; understand-anything-plugin/packages/viewer/bin/viewer.mjs:117-130,171-186`.
- Observación: Grafo permite lecturas sin veto independiente de secretos en estas rutas
- Mitigación propuesta: Política obligatoria antes de leer.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-015 · Alta

- Evidencia: `understand-anything-plugin/packages/mcp/bin/understand-anything-mcp.mjs:54-63,246-251`.
- Observación: Raíz elegida por cliente sin allowlist de sesión
- Mitigación propuesta: Vincular servidor a raíz autorizada.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-016 · Media

- Evidencia: `understand-anything-plugin/packages/dashboard/vite.config.ts:453,506; understand-anything-plugin/packages/viewer/bin/viewer.mjs:404-409`.
- Observación: Token en URL y salida; exposición condicionada a registros/historial
- Mitigación propuesta: Sesión local sin token persistente en URL.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-017 · Alta

- Evidencia: `understand-anything-plugin/packages/dashboard/vite.config.ts:25-39`.
- Observación: Búsqueda de artefactos en múltiples raíces
- Mitigación propuesta: Raíz única; fallo cerrado si falta artefacto.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-018 · Media

- Evidencia: `understand-anything-plugin/packages/mcp/bin/understand-anything-mcp.mjs:166-170`.
- Observación: spawn sin env explícito hereda entorno
- Mitigación propuesta: Allowlist mínima de variables.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-019 · Media

- Evidencia: `understand-anything-plugin/packages/viewer/bin/viewer.mjs:320-385`.
- Observación: No-store explícito solo en staleness en este bloque; revisar cabeceras globales
- Mitigación propuesta: CSP, no-store, referrer y host/origin según endpoint.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-020 · Alta

- Evidencia: `understand-anything-plugin/skills/understand/generate-ignore.mjs:38-53`.
- Observación: Resolución de módulo desde PLUGIN_ROOT configurable
- Mitigación propuesta: Importar solo desde distribución aprobada.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-021 · Alta

- Evidencia: `understand-anything-plugin/skills/understand/scan-project.mjs:802-829`.
- Observación: lstat final rechaza symlink directo; ancestros y carrera pendientes
- Mitigación propuesta: Lecturas confinadas, no solo realpath previo.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-022 · Alta

- Evidencia: `understand-anything-plugin/skills/understand/scan-project.mjs:870; understand-anything-plugin/skills/understand/generate-ignore.mjs:58-68`.
- Observación: Escritura a destino resuelto sin frontera independiente en esos puntos
- Mitigación propuesta: Confinar salidas y probar symlinks.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-023 · Media

- Evidencia: `understand-anything-plugin/skills/understand/prepare-incremental.mjs:113-116; understand-anything-plugin/skills/understand/finalize-incremental.mjs:66-71`.
- Observación: Temporal predecible sin creación exclusiva
- Mitigación propuesta: Directorio privado, creación exclusiva y rename seguro.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-024 · Media

- Evidencia: `understand-anything-plugin/skills/understand/scan-project.mjs:652-665`.
- Observación: Lectura completa en memoria sin límite en función
- Mitigación propuesta: Presupuesto por archivo y total; streaming.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-025 · Alta

- Evidencia: `understand-anything-plugin/packages/core/src/ignore-filter.ts:10-120; understand-anything-plugin/packages/core/src/ignore-generator.ts:266-277`.
- Observación: Exclusiones funcionales reversibles, sin veto específico de secretos
- Mitigación propuesta: Política no reversible; detección de secretos antes de enviar.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-026 · Alta

- Evidencia: `understand-anything-plugin/skills/understand/scan-project.mjs:482-582`.
- Observación: Fallback recursivo sin semántica gitignore propia
- Mitigación propuesta: Aplicar misma política de seguridad a ambos caminos.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-027 · Alta

- Evidencia: `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx:55-62`.
- Observación: Imagen externa derivada del grafo; posible tracking
- Mitigación propuesta: Bloquear por defecto; proxy/cache autorizado para Figma.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-028 · Media

- Evidencia: `understand-anything-plugin/packages/dashboard/src/App.tsx:44,56-74`.
- Observación: URLs demo configuradas en build; no implica tráfico en modo normal
- Mitigación propuesta: Demo aislada, sin datos privados.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-029 · Media

- Evidencia: `.github/workflows/ci.yml:28-36; .github/workflows/deploy-homepage.yml:26-68`.
- Observación: Referencias de acciones por tags mutables
- Mitigación propuesta: Fijar SHA y revisar actualizaciones.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

### SEC-030 · Media

- Evidencia: `.github/workflows/ci.yml`.
- Observación: No declara permissions; permisos efectivos dependen de GitHub
- Mitigación propuesta: Declarar contents: read y excepciones por job.
- Estado: abierto; impacto y explotabilidad pendientes de prueba.

## Canales legítimos y límites

Figma API (`understand-anything-plugin/packages/core/src/figma/source/api-source.ts:3,27`) envía token a Figma; validar destinos y redirecciones. Git/pnpm requieren red para adquisición; dashboard puede cargar imágenes y datos demo; los modelos remotos pueden recibir código. Ninguno demuestra exfiltración maliciosa. No confundir ejecución local con inferencia local.

## Cierre

No instalar hasta completar auditoría de dependencias, mitigaciones y pruebas de aceptación.
