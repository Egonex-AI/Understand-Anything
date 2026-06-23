# Flask Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Flask is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Flask Project Structure

When analyzing a Flask project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `app.py`, `__init__.py` (in app package) | Application factory (`create_app()`) or direct `Flask(__name__)` instance | `entry-point`, `config` |
| `run.py`, `wsgi.py` | Production/dev server entry point | `entry-point`, `config` |
| `*/views.py`, `*/routes.py` | Route handler functions with `@app.route` or `@blueprint.route` | `api-handler`, `routing` |
| `*/blueprints/*.py`, `*/api/*.py` | Blueprint modules — group routes by feature | `api-handler`, `routing` |
| `*/models.py` | SQLAlchemy models or other ORM models | `data-model` |
| `*/forms.py` | WTForms form classes | `validation`, `ui` |
| `*/schemas.py` | Marshmallow serialization schemas | `serialization`, `type-definition` |
| `*/config.py` | Config classes (`DevelopmentConfig`, `ProductionConfig`) | `config` |
| `*/extensions.py` | Flask extension initialization (`db = SQLAlchemy()`, `login_manager = LoginManager()`) | `config`, `singleton` |
| `*/decorators.py` | Custom route decorators (auth guards, rate limiting) | `middleware`, `utility` |
| `*/utils.py`, `*/helpers.py` | Shared utility functions | `utility` |
| `*/templates/**/*.html` | Jinja2 templates | `ui` |
| `*/static/` | CSS, JS, and asset files | `assets` |
| `*/tests/*.py`, `test_*.py` | pytest or unittest test files | `test` |

### Edge Patterns to Look For

**Blueprint registration** — When `app.register_blueprint(bp, url_prefix='/api')` appears in the application factory, create `depends_on` edges from the app factory to each blueprint module.

**Extension coupling** — When a view imports from `extensions.py` (e.g., `from .extensions import db, login_manager`), create `imports` edges to show which views depend on which extensions.

**Before/after request hooks** — When `@app.before_request` or `@blueprint.before_request` decorates a function, create `middleware` edges from those functions to the app/blueprint they attach to.

### Architectural Layers for Flask

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:api` | API Layer | Blueprint route files, view functions |
| `layer:data` | Data Layer | `models.py`, database migration files |
| `layer:service` | Service Layer | Business logic modules, `schemas.py`, service classes |
| `layer:ui` | UI Layer | `templates/`, `forms.py`, `static/` |
| `layer:config` | Config Layer | `app.py` factory, `config.py`, `extensions.py` |
| `layer:middleware` | Middleware Layer | `decorators.py`, before/after request hooks |
| `layer:test` | Test Layer | Test files, `conftest.py` |

### Notable Patterns to Capture in languageLesson

- **Application factory pattern**: `create_app()` functions allow multiple app instances (e.g., for testing) and delay extension initialization — avoids circular imports
- **Blueprint modularity**: Blueprints group related routes, templates, and static files; they are registered on the app with a URL prefix, making them independently testable
- **Flask extension protocol**: Extensions follow `init_app(app)` for lazy initialization — the extension object is created globally but bound to an app instance later
