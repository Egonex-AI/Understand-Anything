# FastAPI Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when FastAPI is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## FastAPI Project Structure

When analyzing a FastAPI project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `main.py`, `app.py` | Application factory — creates and configures the `FastAPI()` instance | `entry-point`, `config` |
| `*/routers/*.py`, `*/api/*.py` | `APIRouter` modules — group related endpoints by domain | `api-handler`, `routing` |
| `*/schemas.py`, `*/schemas/*.py` | Pydantic request/response models | `type-definition`, `serialization` |
| `*/models.py`, `*/models/*.py` | SQLAlchemy ORM models or other DB models | `data-model` |
| `*/dependencies.py`, `*/deps.py` | `Depends()` provider functions — shared logic injected into routes | `service`, `middleware` |
| `*/crud.py`, `*/repository.py` | Database access layer — CRUD operations | `data-model`, `service` |
| `*/database.py`, `*/db.py` | DB engine, session factory, connection management | `config`, `data-model` |
| `*/config.py`, `*/settings.py` | `pydantic-settings` / `BaseSettings` config classes | `config` |
| `*/middleware.py` | Starlette middleware classes | `middleware` |
| `*/exceptions.py` | Custom exception classes and exception handlers | `utility` |
| `*/security.py`, `*/auth.py` | Auth utilities — JWT decoding, password hashing, OAuth helpers | `service`, `middleware` |
| `*/tasks.py` | Background tasks or Celery task definitions | `service`, `event-handler` |
| `*/tests/*.py`, `test_*.py` | pytest test files | `test` |
| `conftest.py` | pytest fixtures and test configuration | `test`, `config` |

### Edge Patterns to Look For

**Router inclusion chain** — When `app.include_router(some_router, prefix="/api")` appears in `main.py` or a router aggregator, create `imports` + `depends_on` edges from the main app file to each router module. This builds the URL hierarchy graph.

**Dependency injection tree** — When a route function or another `Depends()` provider imports and calls `Depends(some_function)`, create `depends_on` edges from the caller to the dependency provider. Trace these chains — they often span multiple files (e.g., route → auth dependency → DB session dependency).

**Pydantic model inheritance** — When a schema class inherits from another (e.g., `class UserCreate(UserBase)`), create `inherits` edges between the schema class nodes.

**ORM model relationships** — When SQLAlchemy models use `relationship()`, `ForeignKey`, create `depends_on` edges between the model classes.

**CRUD-to-model binding** — When a `crud.py` function takes a model type as an argument or directly references a model class, create `depends_on` edges from the CRUD file to the model file.

### Architectural Layers for FastAPI

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:api` | API Layer | Router files, endpoint functions with `@router.get/post/...` decorators |
| `layer:types` | Types Layer | Pydantic schema files, request/response models |
| `layer:service` | Service Layer | `dependencies.py`, `crud.py`, business logic modules |
| `layer:data` | Data Layer | ORM models, `database.py`, migrations |
| `layer:config` | Config Layer | `main.py` / `app.py` factory, `settings.py`, `config.py` |
| `layer:middleware` | Middleware Layer | `middleware.py`, `security.py`, `auth.py`, exception handlers |
| `layer:test` | Test Layer | `tests/`, `conftest.py` |

### Notable Patterns to Capture in languageLesson

- **Dependency injection as composition**: FastAPI's `Depends()` is a first-class DI system — a route can declare any number of dependencies, each of which can have their own dependencies, forming a tree resolved at request time
- **Pydantic for validation**: Request bodies, query params, and path params are automatically validated by Pydantic — invalid input raises `422 Unprocessable Entity` before your code runs
- **Async endpoints**: `async def` routes run in the event loop; `def` routes run in a threadpool — mixing them incorrectly can cause performance issues
- **Path operation order**: FastAPI matches routes in declaration order; a catch-all route before a specific one will shadow it
