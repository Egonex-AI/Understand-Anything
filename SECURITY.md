# Reporting security issues

Thanks for taking the time to disclose responsibly.

## How to report

Please use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository. That keeps the report visible to the maintainer without
exposing the details publicly.

If private reporting is unavailable for any reason, open a regular issue
titled `security: brief description` **without** any exploit details, and
the maintainer will reply with a private channel.

## What to include

- A description of the issue and its potential impact.
- Steps to reproduce — minimal is fine, a full PoC is not required.
- Affected versions if you've narrowed them down.
- Whether you'd like to be credited in the eventual fix.

## What to expect

- Initial acknowledgement within a few days.
- A fix or mitigation plan within ~30 days for confirmed issues; longer for
  cases that require coordinated disclosure with upstream dependencies.
- Public credit once a fix has shipped, if you'd like.

## Scope

This project is a **local-only** static-analysis tool. It runs on a
developer's machine, reads the analyzed project, and writes the resulting
graph to `.understand-anything/`. It does not phone home and the dashboard's
file-content endpoint is gated behind an access token and a graph-derived
path allowlist.

Issues we care about:

- Code execution triggered by analyzing a hostile project (e.g. a path in a
  hostile file leaking outside the analyzed directory, or untrusted JSON in
  the graph being executed by the dashboard).
- The dashboard's file-content endpoint serving files outside the allowlist.
- The `/understand` skill running shell commands derived from untrusted
  paths or contents.

Issues that are **out of scope**:

- Bugs that require a malicious local user with write access to the
  analyzed project (they could just edit the source directly).
- Anything that requires the user to copy a malicious URL and paste it back
  into the dashboard.
