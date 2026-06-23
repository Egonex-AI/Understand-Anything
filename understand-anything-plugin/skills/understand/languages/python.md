# Python Language Prompt Snippet

## Key Concepts

- **Decorators**: Functions that wrap other functions or classes using `@decorator` syntax
- **List/Dict Comprehensions**: Concise syntax for creating collections from iterables
- **Generators and Yield**: Lazy iterators using `yield` for memory-efficient data processing
- **Context Managers**: `with` statement for resource management via `__enter__`/`__exit__`
- **Type Hints and Typing Module**: Optional static type annotations for tooling and documentation
- **Dunder Methods**: Special methods like `__init__`, `__repr__`, `__eq__` defining object behavior
- **Metaclasses**: Classes that define how other classes are created (type as default metaclass)
- **Dataclasses**: `@dataclass` decorator auto-generating boilerplate from field annotations
- **Protocols**: Structural subtyping via `typing.Protocol` for duck-type-safe interfaces
- **Descriptors**: Objects defining `__get__`, `__set__`, `__delete__` to customize attribute access
- **Async/Await with Asyncio**: Cooperative concurrency using coroutines and an event loop

## Import Patterns

- `from module import name` — import specific name from module
- `import module` — import entire module, access via `module.name`
- `from package.module import name` — absolute import from nested package
- `from . import relative` — relative import within a package

## File Patterns

- `__init__.py` — package initializer (barrel equivalent), can re-export public API
- `__main__.py` — package entry point when run with `python -m package`
- `conftest.py` — pytest shared fixtures and hooks (auto-discovered)
- `setup.py` / `pyproject.toml` — project configuration and build metadata
- `requirements.txt` — pinned dependency list

## Common Frameworks

- **Django** — Full-stack web framework with ORM, admin, and batteries included
- **FastAPI** — Modern async API framework with automatic OpenAPI docs
- **Flask** — Lightweight WSGI micro-framework for web applications
- **SQLAlchemy** — SQL toolkit and ORM with unit-of-work pattern
- **Celery** — Distributed task queue for background job processing
- **Pydantic** — Data validation and settings management using type annotations

## Example Language Notes

> Uses `@dataclass` decorator to auto-generate `__init__`, `__repr__`, and `__eq__` from
> field annotations. This eliminates boilerplate while keeping the class definition
> readable and the generated methods consistent.
>
> When `__init__.py` re-exports symbols, it acts as the package's public API surface —
> consumers import from the package rather than reaching into internal modules.
