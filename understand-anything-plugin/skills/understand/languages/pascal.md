# Pascal / Delphi Language Prompt Snippet

## Key Concepts

- **Units**: The primary module unit (`unit Foo;`) — file-level container, paired 1:1 with a `.pas` file
- **Interface vs Implementation Sections**: `interface` declares the public API; `implementation` holds the private bodies. Only items declared in `interface` are visible to other units that `uses` this one.
- **Uses Clauses**: `uses A, B, C;` imports other units. There can be one in the interface section (transitively visible) and one in the implementation section (private). Treat both as imports.
- **Classes**: `type TFoo = class(TAncestor) ... end;` — Delphi has single inheritance plus interface implementation. The class declaration appears in a type block.
- **Interfaces**: `type IFoo = interface(IAncestor) ['{GUID}'] ... end;` — abstract contracts, often identified by GUID.
- **Published Properties**: Properties in the `published` visibility section get RTTI generated and are persisted in the paired `.dfm` form file. This is the foundation of Delphi's visual form-design + streaming model.
- **Data Modules**: Special form-like containers that group non-visual components (database connections, datasets, providers). Named `dm*` by convention (e.g. `dmCW2.pas` + `dmCW2.dfm`).
- **Form/DFM Pairing**: Every `Txxx.pas` containing a `TForm`/`TFrame`/`TDataModule` descendant has a matching `Txxx.dfm` text file declaring the design-time component tree. Treat the pair as one logical artifact.
- **RTTI Attributes**: `[MyAttr(42)]` decorate types and methods, similar to .NET attributes or Java annotations.
- **Anonymous Methods**: `procedure of object` (method pointer) and inline `procedure begin ... end` (Delphi 2009+).
- **Initialization / Finalization**: Module-scoped setup/teardown blocks that run at unit load/unload, before/after `main`.
- **With Statement**: `with foo do begin ... end` — opens a scope where `foo`'s members are unqualified. Common in legacy Delphi, often obscures call targets.

## Import Patterns

- `uses A, B, C;` — units listed by bare name; the linker resolves them via search path (current dir, project search paths, library path)
- `uses A.B.C;` — namespaced unit (modern Delphi 2007+)
- Interface-section `uses` is the unit's public dependency
- Implementation-section `uses` is the private dependency
- A `.dpr` (program) file's `uses` lists every unit linked into the executable — the dependency root

## File Patterns

- `*.pas` — Pascal source unit (one unit per file)
- `*.dfm` — Form definition (paired with `.pas`); structured text declaring design-time object tree
- `*.dpr` — Program (project) entry point — like `main.c` for the executable
- `*.dpk` — Package source (DLL-equivalent)
- `*.dproj` / `*.bpg` / `*.groupproj` — IDE project / project-group files
- `*.inc` — Include file (preprocessor-style text inclusion via `{$I file.inc}`)
- `dm*.pas` / `dm*.dfm` — Data modules
- `f*.pas` / `f*.dfm` — Form units (legacy convention; modern code often uses `u*Form.pas`)

## Common Frameworks

- **VCL** (Visual Component Library) — the canonical Delphi UI framework; `Forms`, `Controls`, `Graphics` units
- **FireMonkey (FMX)** — Cross-platform UI framework, replacement for VCL
- **DataSnap** — Multi-tier middleware
- **dbExpress / FireDAC** — Database access layers
- **IndyTCP** / **Synapse** — Networking
- **RX / JEDI / RAID** — Third-party component suites

## Example Language Notes

> Implements a Delphi data module (`TdmCW2 = class(TDataModule)`) that owns the global ADO
> connection plus dozens of TADOQuery / TADOStoredProc components. Form-streaming in the
> paired `.dfm` configures connection strings, parameter lists, and field definitions at
> design time; runtime code typically just opens the dataset.

> The `with FOrderItems do begin … end` block on lines 412–478 obscures the call target —
> every bare identifier resolves against `FOrderItems`'s members first. When tracing
> business logic, mentally prefix each unqualified reference with `FOrderItems.`.

> Uses an interface-section `uses` clause to import VCL controls (`Forms`, `StdCtrls`) —
> these are part of the public API because the form's published properties reference them.
> The implementation-section `uses` imports business-logic units (`dmCW2`, `OrderProcessing`)
> which are private to this form.
