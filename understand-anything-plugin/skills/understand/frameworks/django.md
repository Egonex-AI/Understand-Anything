# Django Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Django is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Django Project Structure

When analyzing a Django project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `manage.py` | CLI entry point for dev server, migrations, management commands | `entry-point`, `config` |
| `*/settings.py`, `*/settings/*.py` | Project-wide configuration (DB, installed apps, middleware) | `config` |
| `*/urls.py` | URL routing — maps URL patterns to views | `api-handler`, `routing` |
| `*/views.py`, `*/views/*.py` | Request handlers (function-based or class-based views) | `api-handler`, `controller` |
| `*/models.py`, `*/models/*.py` | ORM models — map to database tables | `data-model` |
| `*/serializers.py` | DRF serializers — convert models to/from JSON | `serialization`, `api-handler` |
| `*/forms.py` | Django forms — validation and rendering logic | `validation`, `ui` |
| `*/admin.py` | Admin site registrations — exposes models in Django admin | `config` |
| `*/signals.py` | Signal handlers — cross-cutting side effects on model events | `event-handler` |
| `*/tasks.py` | Celery async task definitions | `service`, `event-handler` |
| `*/middleware.py`, `*/middleware/*.py` | Request/response middleware classes | `middleware` |
| `*/permissions.py` | DRF permission classes | `middleware`, `validation` |
| `*/filters.py` | DRF filter backends | `utility` |
| `*/migrations/*.py` | Auto-generated schema migrations — do not summarize individually | `config` |
| `*/templates/**/*.html` | Django HTML templates | `ui` |
| `*/templatetags/*.py` | Custom template filters and tags | `utility` |
| `*/management/commands/*.py` | Custom management commands (`./manage.py mycommand`) | `config`, `entry-point` |
| `wsgi.py`, `asgi.py` | WSGI/ASGI server adapter — production entry point | `config`, `entry-point` |
| `*/apps.py` | App configuration and startup hooks (`AppConfig`) | `config` |
| `*/tests.py`, `*/tests/*.py` | Unit and integration tests | `test` |

### Edge Patterns to Look For

**URL routing graph** — Create `calls` edges from `urls.py` nodes to their corresponding view nodes when `path()` or `re_path()` maps a URL pattern to a view function or class. These edges represent the HTTP routing chain.

**Signal wiring** — When `signals.py` uses `post_save.connect(handler, sender=Model)` or `@receiver(post_save, sender=Model)`, create `subscribes` edges from the signal handler function to the model class. Create `publishes` edges from the model to the signal handler to show the trigger direction.

**ORM relationships** — When `models.py` defines `ForeignKey`, `OneToOneField`, or `ManyToManyField`, create `depends_on` edges between the model classes with a description indicating the relationship type and cardinality.

**Serializer-to-model binding** — When a DRF serializer has `model = MyModel` in its `Meta` class, create a `depends_on` edge from the serializer to the model.

**View-to-serializer binding** — When a DRF ViewSet or APIView references a serializer class, create a `depends_on` edge from the view to the serializer.

### Architectural Layers for Django

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:api` | API Layer | `views.py`, `serializers.py`, `urls.py`, DRF ViewSets and APIViews |
| `layer:data` | Data Layer | `models.py`, `migrations/`, database utility files |
| `layer:service` | Service Layer | `signals.py`, `tasks.py`, custom managers, service modules |
| `layer:ui` | UI Layer | `templates/`, `forms.py`, `templatetags/` |
| `layer:middleware` | Middleware Layer | `middleware.py`, `permissions.py`, authentication backends |
| `layer:config` | Config Layer | `settings.py`, `urls.py` (root), `wsgi.py`, `asgi.py`, `apps.py`, `manage.py` |
| `layer:test` | Test Layer | `tests.py`, `tests/` directory, `conftest.py` |

### Notable Patterns to Capture in languageLesson

- **Fat models vs. thin views**: Django encourages business logic in model methods, keeping views thin HTTP adapters
- **Django ORM lazy evaluation**: QuerySets are not evaluated until iterated — chain filters without DB hits
- **Class-based views (CBVs)**: Mixins like `LoginRequiredMixin`, `PermissionRequiredMixin` compose behavior through multiple inheritance
- **Signal anti-patterns**: Signals create invisible coupling; a signal in `signals.py` may be triggered by a `save()` call anywhere in the codebase
- **App isolation**: Each Django app (`INSTALLED_APPS`) should be self-contained with its own models, views, urls, and migrations
