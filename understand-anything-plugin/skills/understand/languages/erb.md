# ERB Template Language Prompt Snippet

## Key Concepts

- **Output Tags**: `<%= expr %>` evaluates and inserts the result into the rendered text
- **Scriptlet Tags**: `<% %>` runs Ruby control flow (loops, conditionals) without emitting output
- **Comments**: `<%# ... %>` — invisible in the rendered output
- **Whitespace Trim**: `<%-` and `-%>` trim surrounding whitespace so markup stays tidy
- **Renderer-supplied State**: instance variables (`@name`) and helper methods come from whatever renders the template — in Puppet modules, values arrive via `scope()` / the calling manifest; in Rails, via controllers
- **Two Contexts**: `.erb` in a Puppet module's `templates/` is a legacy file-content template rendered by `template()`; in Rails it is the view layer. Read the surrounding project layout to know which you are summarizing

## Notable File Patterns

- `templates/**/*.erb` — Puppet module templates rendered by `template('mod/name.erb')`
- `templates/**/*.html.erb`, `*.text.erb` — HTML vs plain-text output variants
- `app/views/**/*.erb` — Rails view templates

## Edge Patterns

- ERB templates are `depends_on` targets of the code that renders them; in Puppet modules the import map already links `template()` calls to these files — do not duplicate
- Templates `related` to the class, define, or controller whose configuration they render
- Partial patterns (`<%= scope.lookupvar(...) %>`, Rails `render`) point at sibling templates

## Summary Style

Describe what the template renders and which values it interpolates, not the Ruby tag mechanics:

> "ERB template rendering a systemd unit file: ExecStart and Environment lines interpolated from the caller's variables."
> "Plain-text issue banner template with hostname and contact facts."
