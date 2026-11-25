# Roadmap de hardening

PR 1: documentación únicamente. No modifica funcionalidad.

| PR | Alcance | Criterio de salida |
|---|---|---|
| 2 | SEC-001–006,020,029–030: instalación, CI, supply chain | Release fijada, SBOM, auditoría de ambos lockfiles, CI mínimo |
| 3 | SEC-013–015,017,021–026: filesystem y secretos | Lecturas/escrituras confinadas; pruebas negativas |
| 4 | SEC-007–012,018: autorización, hooks, agentes, red | Opt-in por proyecto, entorno mínimo, pruebas de tráfico y prompt injection |
| 5 | SEC-016,019,027–028: dashboard, demo, Figma | Sesión segura, recursos externos bloqueados por defecto, Figma opt-in |
| 6 | Distribución global Codex, MCP | Release separada de checkout, instalación/desinstalación sin colisiones |
| 7 | Regresión y piloto | Matriz de compatibilidad aprobada con fixtures; después piloto SecurePyme |

Cada PR debe incluir pruebas, revisión de cambios, trazabilidad de hallazgos y rollback. Mantener MIT y avisos originales. No actualizar upstream directamente en la versión instalada. No activar hooks ni Figma sin autorización externa. No utilizar repos privados en pruebas de exfiltración.
