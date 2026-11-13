# Puppet Language Prompt Snippet

Targets **Puppet 8** semantics — the same autoload, name-resolution (top scope
only, no relative lookup), and `puppet:///` mount rules apply to **Puppet 7
and 9**.

## Key Concepts

- **Declarative Configuration**: Describe desired system state; Puppet compiles manifests into a catalog the agent applies and reconciles
- **Resources**: The unit of configuration — `file { '/etc/hosts': ensure => file }`; nearly every statement declares a resource of some type
- **Classes**: Named, singleton collections of resources (`class profile::web { ... }`); brought in via `include` / `require` / `contain` or node definitions
- **Defined Types**: Reusable, parameterized resource templates (`define cache_dir($owner) { ... }`); each instantiation creates its own scope — these are Puppet's primary reuse unit
- **Relationships**: `->` ordering arrows and `~>` notify/refresh arrows chain resources; notify fires only when the source actually changes
- **Facts**: Per-node inventory from Facter (`$facts['os']['family']`), available in every manifest and template
- **Catalog**: The compiled artifact — manifests + Hiera data + module code compile into the document the agent applies
- **Hiera Data Binding**: Key-value data separated from manifests; class parameters without defaults are bound implicitly from data by node/environment context
- **Modules**: Packaging unit with a fixed layout — `manifests/`, `lib/puppet/` (Ruby plugins), `templates/`, `data/`, `metadata.json`; autoload rules map class names to file paths
- **Virtual / Exported Resources**: `@` (virtual) and `@@` (exported, cross-node) declarations collected later via `realize`/collectors
- **Node Definitions**: `node 'web01' { ... }` selectors in `site.pp` that match certnames and pick which classes apply

## Notable File Patterns

- `manifests/site.pp` — Compilation entry point: node definitions and default class lists
- `manifests/init.pp` — A module's main class, named after the module itself
- `manifests/**/*.pp` — More classes / defined types, autoloaded as `<module>::<subpath>::<name>`
- `lib/puppet/functions/**/*.rb` — Custom functions in Ruby, namespaced by directory (`functions/apache/vhost_name.rb` → `apache::vhost_name`)
- `lib/puppet/type/*.rb` (+ `lib/puppet/provider/`) — Custom resource types and their implementations
- `templates/*.epp` / `templates/*.erb` — Rendered file bodies referenced by `epp()` / `template()`
- `hiera.yaml`, `data/**/*.yaml` — Hiera bindings and data
- `metadata.json` — Module identity, dependencies, supported platforms
- `Puppetfile` — r10k/g10k module pinning (control repos)
- `spec/classes/*_spec.rb` — rspec-puppet tests (Ruby tooling)

## Edge Patterns

- A manifest `depends_on` the classes it `include`s, `require`s, `contain`s, or `inherits` from — already resolved to the defining `.pp` file by the import map's module-layout conventions
- A manifest `depends_on` the Ruby file implementing a custom function or resource type it calls (`lib/puppet/functions/**.rb`, `lib/puppet/type/*.rb`) — also pre-resolved in the import map; do not duplicate these edges
- `template('mod/x.erb')`, `epp('mod/x.epp')`, and `source => 'puppet:///modules/...'` references `depends_on` the `templates/` file — pre-resolved likewise
- Class nodes `configure` the system behavior their resources declare; prefer one summary-worthy edge per real dependency, not one per resource
- Known extractor gap: legacy bareword `contain foo` (no parentheses) parses as loose identifiers and yields no edge. Only if you are certain of the target class from the source may you add the `depends_on` edge yourself — never guess an unresolvable name

## Summary Style

> "Puppet class configuring Apache: installs the package, deploys the virtual host from an EPP template, and notifies the service on config changes."
> "Defined type declaring a service user with home directory, SSH keys, and group membership in one instantiation."
> "Custom Ruby function computing the package version string for the module's manifests."
