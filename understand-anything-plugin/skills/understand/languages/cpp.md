# C++ Language Prompt Snippet

## Key Concepts

- **Templates**: Function, class, and variadic templates for generic compile-time polymorphism
- **RAII**: Resource Acquisition Is Initialization — tie resource lifetime to object scope
- **Smart Pointers**: `unique_ptr` (exclusive), `shared_ptr` (reference-counted), `weak_ptr` (non-owning)
- **Move Semantics**: Rvalue references (`&&`) and `std::move` for efficient resource transfer
- **Operator Overloading**: Define custom behavior for operators on user-defined types
- **Virtual Functions and Vtable**: Runtime polymorphism through virtual method dispatch tables
- **Namespaces**: Organize symbols and prevent name collisions across translation units
- **Constexpr**: Compile-time evaluation of functions and variables for zero-runtime-cost computation
- **Lambda Expressions**: Anonymous functions with capture lists for closures
- **STL Containers and Algorithms**: Standard containers (vector, map, set) and generic algorithms
- **Concepts (C++20)**: Named constraints on template parameters replacing SFINAE patterns

## Import Patterns

- `#include <system_header>` — include standard library or system headers
- `#include "local_header.h"` — include project-local header files
- `using namespace std` — bring all names from std into scope (avoid in headers)
- `using std::vector` — selectively bring specific names into scope

## File Patterns

- `.h` / `.hpp` — header files containing declarations, templates, and inline definitions
- `.cpp` / `.cc` — implementation files with function definitions and static data
- `CMakeLists.txt` — CMake build system configuration
- `Makefile` — Make-based build rules and targets
- `main.cpp` — program entry point containing `int main()`

## Common Frameworks

- **Qt** — Cross-platform application framework with signal/slot mechanism
- **Boost** — Extensive collection of peer-reviewed portable libraries
- **Catch2** — Header-only testing framework with BDD-style syntax
- **Google Test** — Testing framework with fixtures, assertions, and mocking
- **gRPC** — High-performance RPC framework for service communication

## Example Language Notes

> Uses `std::unique_ptr<T>` for RAII-based ownership, ensuring deterministic cleanup
> when scope exits. The unique pointer cannot be copied, only moved, making ownership
> transfer explicit and preventing accidental double-free errors.
>
> Header/implementation separation (`.h`/`.cpp`) controls compilation boundaries —
> changes to a `.cpp` file only recompile that translation unit, not all includers.
