# Puppet Template (EPP) Language Prompt Snippet

## Key Concepts

- **Typed Parameter List**: `<%- | String $name, Integer $port = 80 | -%>` — an EPP template is a function; every input is declared and type-checked at render time
- **Output Tags**: `<%= expr %>` inserts a value; embedded code is Puppet language, not Ruby
- **Control Flow**: `<% if ... %>` / `<% end %>` using Puppet expressions and facts/variables passed in
- **Template Includes**: `<%- include 'other_template' -%>` composes templates (not resolved by the extractor — note it in the summary when present)
- **Whitespace Trim**: `<%-` and `-%>` trim surrounding whitespace
- **EPP replaces ERB**: modern Puppet templates declare all inputs explicitly instead of reaching into scope — the parameter list is the template's interface

## Notable File Patterns

- `templates/**/*.epp` — Module templates rendered by `epp('mod/name.epp', { ... })` from manifests
- `templates/**.epp` named after the resource they configure (e.g. `nginx.conf.epp`)
- Paired with `.erb` siblings during legacy migration — prefer the EPP when both exist for the same output

## Edge Patterns

- EPP templates are `depends_on` targets of the `epp()` calls that reference them; the import map already links manifest → template — do not duplicate
- Templates `related` to the class or defined type whose file resources they render
- EPP-to-EPP `include` references are not resolved automatically; mention them in the summary rather than inventing edges

## Summary Style

Describe the rendered output and the declared parameters — that is the template's contract:

> "EPP template rendering an nginx server block; takes typed parameters `vhost_name`, `port`, and `docroot`."
> "EPP template generating an ssh_config fragment, looping over a passed array of host entries."
