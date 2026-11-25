# Modelo de amenazas

Estado: propuesto.

## Activos y fronteras

Código privado, credenciales, grafos, fingerprints, tokens del dashboard y configuración global. Fronteras: repositorio no confiable → scanner → artefactos → agente/modelo; cliente MCP → servidor → viewer; navegador → HTTP local; instalación → dependencias/upstream; Figma → API externa.

## Actores y supuestos

Repositorio manipulado, dependencia comprometida, cliente MCP con permisos excesivos, página web externa, proceso local con acceso al usuario. No se pretende proteger contra administrador del host comprometido. El modelo remoto es un destino externo aunque el CLI sea local.

| Amenaza | Control requerido | Verificación |
|---|---|---|
| Lectura fuera de raíz / symlinks | Sandbox y política centralizada | Fixture con ancestros y carrera |
| Secretos en archivos o prompts | Veto no reversible y detección de contenido | Canarios sintéticos en código y config |
| Cruce entre proyectos | Raíz única por sesión | Dos repos con nombres iguales |
| Prompt injection | Datos no confiables, herramientas limitadas | README y grafo adversariales |
| Supply chain | Release fijada, lockfile, SBOM, revisión | Instalación reproducible |
| Exposición HTTP | Loopback, token de sesión, host/origin, CSP | Cliente sin credencial y origen externo |
| Egress | Denegar red del plugin por defecto; autorización separada de inferencia remota | Captura de tráfico con canarios |
| Agotamiento de recursos | Límites de tamaño, tiempo y concurrencia | Fixtures grandes |
| Alteración de artefactos | Escrituras confinadas y publicación atómica | Fallos inducidos y recuperación |

La política debe vivir fuera del repositorio analizado. Ningún filtro de nombres garantiza detectar todos los secretos.
