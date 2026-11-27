# Residual security risks

The supply-chain hardening changes reduce the attack surface
but do not constitute a complete security guarantee.

Known limitations:

- Filesystem TOCTOU conditions are not completely eliminated.
- Release integrity verification does not ensure runtime immutability.
- Processes running as the same user remain within the trust boundary.
- Native Windows compatibility and ACL enforcement remain unverified.
- Kiro authorization behavior has not been validated end to end.
- The Vite development server is not equivalent to the hardened viewer.
- Git authorization fallback paths require additional integration coverage.
- Dependency audits only identify known reported vulnerabilities.
- Full source-to-artifact reproducibility remains unverified.

Use approved local releases and explicitly authorized projects.
Do not expose the viewer through public network interfaces.
