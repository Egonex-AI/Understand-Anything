# C# Language Prompt Snippet

## Key Concepts

- **LINQ Queries**: Language-integrated queries using method syntax (`.Where().Select()`) or query syntax
- **Async/Await with Task**: Asynchronous programming model returning `Task<T>` for non-blocking I/O
- **Generics and Constraints**: Type parameters with `where T : class, IDisposable` constraint clauses
- **Properties (get/set)**: First-class property syntax with backing fields, auto-properties, and init-only
- **Delegates and Events**: Type-safe function pointers; events provide publisher-subscriber pattern
- **Attributes**: Metadata annotations (`[HttpGet]`, `[Authorize]`) for declarative configuration
- **Nullable Reference Types**: Compiler-enforced null safety with `?` annotations (C# 8+)
- **Pattern Matching**: `is`, `switch` expressions with type, property, and relational patterns
- **Records and Init-Only Setters**: Immutable reference types with value equality semantics (C# 9+)
- **Dependency Injection (Built-in)**: First-class DI container in ASP.NET Core (`IServiceCollection`)

## Import Patterns

- `using System.Collections.Generic` — import a namespace for unqualified type access
- `using static System.Math` — import static members for direct method access
- `global using` — file-scoped usings applied to the entire project (C# 10)
- `using Alias = Namespace.Type` — type alias for disambiguation

## File Patterns

- `*.csproj` — MSBuild project file defining targets, packages, and build properties
- `*.sln` — Visual Studio solution file grouping multiple projects
- `Program.cs` — application entry point (top-level statements in .NET 6+)
- `Startup.cs` — service and middleware configuration (older ASP.NET Core pattern)
- `appsettings.json` — hierarchical application configuration

## Common Frameworks

- **ASP.NET Core** — Cross-platform web framework for APIs, MVC, and Razor Pages
- **Entity Framework** — ORM with LINQ-to-SQL, migrations, and change tracking
- **Blazor** — Component-based UI framework using C# instead of JavaScript
- **MAUI** — Cross-platform native UI for mobile and desktop applications
- **xUnit** — Modern testing framework with theories, facts, and dependency injection

## Example Language Notes

> Uses LINQ method syntax `.Where().Select()` to compose a query pipeline over the
> collection. LINQ operations are lazily evaluated — the query only executes when
> results are enumerated, allowing efficient composition without intermediate allocations.
>
> The built-in DI container in ASP.NET Core registers services in `Program.cs` and
> resolves them via constructor injection, following the composition root pattern.
