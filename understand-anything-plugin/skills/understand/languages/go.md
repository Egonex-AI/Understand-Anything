# Go Language Prompt Snippet

## Key Concepts

- **Goroutines**: Lightweight concurrent functions launched with `go` keyword
- **Channels**: Typed conduits for communication and synchronization between goroutines
- **Interfaces**: Implicitly satisfied contracts — no `implements` keyword needed
- **Struct Embedding**: Composition mechanism providing field and method promotion
- **Error Handling**: Explicit error return values (`error` interface) instead of exceptions
- **Defer/Panic/Recover**: Deferred cleanup, unrecoverable errors, and recovery mechanism
- **Slices vs Arrays**: Arrays are fixed-size values; slices are dynamic views backed by arrays
- **Pointers**: Explicit pointer types for pass-by-reference semantics (no pointer arithmetic)
- **Context Propagation**: `context.Context` carries deadlines, cancellation, and request-scoped values
- **Init Functions**: Package-level `init()` runs automatically before `main()` for setup

## Import Patterns

- `import "package"` — single package import
- `import alias "package"` — aliased import to avoid name conflicts
- `import ( ... )` — grouped import block (standard library, then external, then internal)
- `import _ "package"` — blank import for side effects only (e.g., driver registration)

## File Patterns

- `*_test.go` — test files in the same package (or `_test` package for black-box tests)
- `cmd/` — directory containing main packages (binary entry points)
- `internal/` — packages only importable by parent module (enforced by compiler)
- `pkg/` — public library packages (convention, not enforced)
- `go.mod` — module definition with dependency versions
- `go.sum` — cryptographic checksums for dependencies

## Common Frameworks

- **Gin** — High-performance HTTP framework with middleware support
- **Echo** — Minimalist web framework with built-in middleware
- **Fiber** — Express-inspired framework built on fasthttp
- **Chi** — Lightweight, composable HTTP router
- **GORM** — ORM library with associations, hooks, and migrations

## Example Language Notes

> Implements `io.Reader` interface implicitly — no explicit declaration needed, just
> matching method signatures. This enables any type with a `Read([]byte) (int, error)`
> method to be used wherever `io.Reader` is expected.
>
> The `internal/` directory enforces encapsulation at the compiler level, preventing
> external packages from importing implementation details — stronger than naming convention.
