# Compatibilidad funcional

Objetivo: conservar las capacidades originales, con opciones sensibles deshabilitadas por defecto. No se ha ejecutado ninguna prueba; todas las filas están pendientes.

| Capacidad | Comportamiento objetivo | Prueba de aceptación |
|---|---|---|
| Scanner y Tree-sitter | Análisis multilenguaje | Comparar inventario y símbolos con upstream sobre fixture sin secretos |
| Knowledge Graph | Nodos, aristas, capas, tours y lecciones | Validar esquema y referencias |
| Incremental | Cambios, borrados, renombres y rollback | Comparar con rebuild completo; probar fallo de publicación |
| Dashboard | Navegación, búsqueda, código, exportación | Flujo autenticado; sin salida de red por defecto |
| MCP | Opcional, recomendado para Codex, raíz autorizada | Consultas válidas y rechazo de otra raíz |
| Figma | Opt-in, credencial mínima y caché | Mock API, errores 401/429, redirecciones; integración real autorizada aparte |
| Hooks | Opt-in por proyecto | No ejecución por defecto; cambio de HEAD real cuando habilitado |
| Demo | Disponible de forma aislada, fuera de ejecución privada | Datos sintéticos, sin acceso al proyecto |
| Skills auxiliares | Chat, diff, domain, explain, knowledge, onboard | Smoke tests por skill |
| Instalación global | Release auditada, no checkout mutable | Instalar, actualizar, rollback, desinstalar |
| Español e inglés | Preferencias por proyecto | Generar contenido en ambos idiomas |

Las exclusiones de secretos pueden reducir deliberadamente la cobertura frente a upstream. No se considera regresión que un acceso no autorizado sea rechazado. No prometer paridad exacta hasta ejecutar pruebas. Figma Starter es el entorno previsto; límites efectivos de API se validarán al integrar.
