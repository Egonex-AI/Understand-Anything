# Puppet Module Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when a Puppet module is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Puppet Module Anatomy

When analyzing a Puppet module (or control repo), apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `manifests/site.pp` | Compilation entry point — node definitions selecting classes per certname | `entry-point` |
| `manifests/init.pp` | The module's main class, named after the module | `service` |
| `manifests/**/*.pp` | Classes and defined types — the module's configuration logic | `service` |
| `lib/puppet/functions/**/*.rb` | Custom functions — namespaced by directory, called from manifests | `utility` |
| `lib/puppet/type/*.rb` | Custom resource types — Ruby property/parameter declarations | `service` |
| `lib/puppet/provider/**/*.rb` | Type providers — the actual system manipulation per platform | `service` |
| `templates/*.epp`, `templates/*.erb` | Rendered file bodies referenced by `epp()` / `template()` | `config` |
| `hiera.yaml`, `data/**/*.yaml` | Hiera bindings and configuration data | `data`, `config` |
| `metadata.json` | Module identity, version, dependencies, supported platforms | `config` |
| `Puppetfile` | r10k/g10k module pinning in a control repo | `config` |
| `spec/classes/*_spec.rb`, `spec/defines/*.rb` | rspec-puppet tests | `test` |

### Edge Patterns to Look For

**Autoloading is the routing table** — class `profile::web` must live at `profile/manifests/web.pp` and defined types follow the same rule. The import map already resolves `include`/`require`/`contain`/`inherits`, custom function and type names, and `template()`/`epp()`/`puppet:///` references through these conventions. Do not duplicate those edges; add only semantic edges the script cannot see.

**Roles + profiles composition** — the community-standard layering: `site.pp` assigns a role class to nodes; role classes just `include` profile classes; profile classes configure and `include` upstream service modules. Describe this composition in summaries (`role → profile → module`) rather than treating each class in isolation.

**Inheritance vs containment** — `inherits base` is class inheritance (older style, prefer warning); `include` adds classes without ordering, `contain` nests them for relationship arrows. All three arrive as manifest → manifest `depends_on` edges already.

**Notify chains** — `->` only orders, `~>` refreshes only on change; treat a chain as one flow in the summary instead of one edge per resource.

### Architectural Layers for Puppet

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:service` | Service Layer | `manifests/`, `lib/puppet/type/`, `lib/puppet/provider/` |
| `layer:utility` | Utility Layer | `lib/puppet/functions/` |
| `layer:config` | Config Layer | `templates/`, `metadata.json`, `Puppetfile` |
| `layer:data` | Data Layer | `data/`, `hiera.yaml` |
| `layer:test` | Test Layer | `spec/` |

### Notable Patterns to Capture in languageLesson

- **Autoload-by-path**: Puppet finds a class's file from its name — module name is the namespace root and `manifests/init.pp` is the module class itself; moving a `.pp` file silently changes its public name
- **Hiera data binding**: class parameters without defaults can be satisfied entirely from YAML data — the value is invisible at every call site, so a manifest with few literals is not "empty"
- **Classes are singletons, defines instantiate N times**: including the same class twice is a no-op; each defined-type title is a separate resource scope
- **Virtual (`@`) and exported (`@@`) resources**: declared without being applied; collected later by `realize`/collectors, exported ones across nodes via storeconfigs — the `@` prefix is part of the extracted resource name
- **`node` definitions are selectors, not types**: they match certnames/Facter expressions in `site.pp`; they are not autoloadable and never import targets
- **The Ruby half is first-class**: `lib/puppet/functions/*.rb` and `lib/puppet/type/*.rb` are what custom functions and resource types actually are; manifests reference them by bare name and the import map links the two halves
