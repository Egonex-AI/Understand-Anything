# Secure installation

Understand Secure uses offline activation of independently
reviewed release artifacts.

## Runtime requirements

- Python 3.9 or later.
- Node.js 22 or later for the analysis engine and MCP.
- Git for repository analysis and freshness checks.

The current distribution has been functionally tested on
Linux under WSL2 with Node.js 24.

Native Windows compatibility remains subject to validation.

## Release preparation

Release preparation is a separate maintainer operation.

The build-release.py script assembles previously prepared
production dependencies and compiled artifacts:

    python3 scripts/build-release.py \
        --staging /path/to/prepared-mcp \
        --output /path/to/release

The staging directory must contain reviewed production
dependencies and must not contain external or broken links.

The assembler does not download dependencies or compile code.

## Release verification

Place the reviewed release under:

    ~/.understand-secure/releases/<commit>

The directory name must match the approved 40-character
Git commit identifier.

Generate its inventory during release preparation:

    python3 scripts/generate-release-manifest.py \
        /path/to/releases/<commit> --commit <commit>

The resulting manifest SHA-256 must be approved independently.
A locally generated digest alone does not establish provenance.

Never approve artifacts solely because their manifest is valid.

## Linux and macOS

From a trusted local installer checkout or approved release:

    bash install.sh codex \
        --commit "$COMMIT" \
        --manifest-sha256 "$APPROVED_SHA256"

Uninstall:

    bash install.sh --uninstall codex

## Windows

From a trusted local installer checkout or approved release:

    .\install.ps1 -Platform codex `
        -Commit $Commit `
        -ManifestSha256 $ApprovedSha256

Uninstall:

    .\install.ps1 -Uninstall codex

## Updates

Automatic updates are disabled.

New releases require separate preparation, review and approval.
Remove the managed installation before activating a different
approved release.

## Dashboard authentication

The local viewer uses random session credentials and Bearer
authentication for protected endpoints.

For manual browser access, use the URL printed in your terminal:

    node packages/viewer/bin/viewer.mjs /path/to/project --no-open

Run this command from the installed plugin directory.

Never share session credentials with AI agents or third parties.

MCP requests private browser opening and returns a token-free URL.

## Security limitations

- Release verification does not provide runtime immutability.
- Processes running as the same user remain within the trust boundary.
- Filesystem race conditions are not completely eliminated.
- Windows ACL enforcement remains subject to validation.
- MCP and the viewer are not operating-system sandboxes.
- Hooks are not activated automatically.
- Full source-to-artifact reproducibility remains unverified.
