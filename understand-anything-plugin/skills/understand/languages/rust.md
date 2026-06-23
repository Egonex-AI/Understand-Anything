# Rust Language Prompt Snippet

## Key Concepts

- **Ownership and Borrowing**: Each value has one owner; references borrow without taking ownership
- **Lifetimes**: Annotations (`'a`) ensuring references remain valid for their required duration
- **Traits and Trait Objects**: Shared behavior definitions; `dyn Trait` for dynamic dispatch
- **Pattern Matching**: Exhaustive `match` expressions deconstructing enums, structs, and tuples
- **Enums with Data**: Algebraic data types — each variant can carry different associated data
- **Result/Option Error Handling**: `Result<T, E>` for fallible ops; `Option<T>` for nullable values
- **Macros**: Declarative (`macro_rules!`) and procedural (derive, attribute, function-like) code generation
- **Async/Await with Tokio**: Zero-cost async using `Future` trait and runtime executors
- **Unsafe Blocks**: Opt-in blocks for raw pointer dereferencing, FFI, and bypassing borrow checker
- **Generics with Trait Bounds**: `<T: Clone + Send>` constraining generic parameters
- **Closures and Fn Traits**: `Fn`, `FnMut`, `FnOnce` determine how closures capture environment

## Import Patterns

- `use crate::module::Item` — import from current crate
- `use std::collections::HashMap` — import from standard library
- `use super::*` — import everything from parent module
- `mod module_name` — declare a submodule (loads from file)

## File Patterns

- `mod.rs` — module barrel file (older convention) or `module_name.rs` (2018+ edition)
- `lib.rs` — library crate root defining the public API
- `main.rs` — binary crate entry point
- `Cargo.toml` — project manifest with dependencies and metadata
- `build.rs` — build script executed before compilation

## Common Frameworks

- **Actix-web** — Actor-based, high-performance web framework
- **Axum** — Ergonomic web framework built on Tower and Hyper
- **Rocket** — Type-safe web framework with declarative routing
- **Diesel** — Safe, composable ORM and query builder
- **Tokio** — Async runtime providing I/O, timers, and task scheduling

## Example Language Notes

> Takes `&self` borrow to read state without transferring ownership; returns
> `Result<T, Error>` for explicit error propagation. The `?` operator propagates
> errors up the call stack concisely, replacing verbose match blocks.
>
> The module system maps to the filesystem: `mod handlers;` loads either
> `handlers.rs` or `handlers/mod.rs`, establishing the module tree at compile time.
