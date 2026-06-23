# Ruby on Rails Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Rails is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Rails Project Structure

When analyzing a Ruby on Rails project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `config.ru` | Rack entry point — boots the Rails application for the web server | `entry-point` |
| `config/application.rb` | Application configuration — sets up Rails, loads gems, configures middleware | `entry-point`, `config` |
| `app/controllers/*_controller.rb` | Controllers — handle HTTP requests, orchestrate models, render responses | `api-handler` |
| `app/controllers/concerns/*.rb` | Controller concerns — shared controller behavior via mixins | `middleware`, `utility` |
| `app/models/*.rb` | ActiveRecord models — map to database tables, contain validations and associations | `data-model` |
| `app/models/concerns/*.rb` | Model concerns — shared model behavior via mixins | `utility` |
| `app/views/**/*.erb`, `app/views/**/*.haml` | View templates — HTML rendering with embedded Ruby | `ui` |
| `app/helpers/*_helper.rb` | View helpers — utility methods available in templates | `utility` |
| `app/mailers/*_mailer.rb` | Action Mailer classes — send email notifications | `service` |
| `app/jobs/*_job.rb` | Active Job classes — background job processing | `service` |
| `app/channels/*_channel.rb` | Action Cable channels — WebSocket communication | `service` |
| `app/serializers/*_serializer.rb` | API serializers — JSON response formatting (ActiveModelSerializers, Blueprinter) | `api-handler`, `utility` |
| `app/services/*.rb` | Service objects — encapsulate complex business logic | `service` |
| `db/migrate/*.rb` | Database migrations — schema changes versioned by timestamp | `config`, `data-model` |
| `db/schema.rb`, `db/structure.sql` | Generated schema snapshot — current database structure | `data-model`, `config` |
| `config/routes.rb` | Route definitions — maps URLs to controller actions | `routing`, `config` |
| `config/initializers/*.rb` | Initializers — run once at boot to configure gems and services | `config` |
| `lib/**/*.rb` | Library code — custom classes, Rake tasks, extensions | `utility`, `service` |
| `spec/**/*_spec.rb`, `test/**/*_test.rb` | RSpec or Minitest test files | `test` |

### Edge Patterns to Look For

**Route-to-controller mapping** — When `config/routes.rb` defines `resources :users` or `get '/foo', to: 'bar#baz'`, create `configures` edges from the routes file to the corresponding controller. RESTful resources generate a full set of action mappings.

**ActiveRecord associations** — When models define `has_many`, `belongs_to`, `has_one`, or `has_and_belongs_to_many`, create `depends_on` edges between model files with descriptions indicating the association type and direction.

**Controller-to-model** — When a controller calls model methods (`User.find`, `@post.save`), create `depends_on` edges from the controller to the model. Controllers are the primary consumers of model data.

**Callbacks** — When models or controllers use `before_action`, `after_save`, `before_validation`, or similar callbacks, note these as middleware-like edges. Callbacks create implicit execution paths that are not visible from the call site.

### Architectural Layers for Rails

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:api` | API Layer | `app/controllers/`, `app/serializers/`, API-specific controllers |
| `layer:data` | Data Layer | `app/models/`, `db/migrate/`, `db/schema.rb` |
| `layer:ui` | UI Layer | `app/views/`, `app/helpers/`, `app/assets/`, `app/javascript/` |
| `layer:service` | Service Layer | `app/mailers/`, `app/jobs/`, `app/channels/`, `app/services/`, `lib/` |
| `layer:config` | Config Layer | `config/routes.rb`, `config/initializers/`, `config/application.rb`, `config.ru` |
| `layer:middleware` | Middleware Layer | `app/middleware/`, controller concerns, Rack middleware |
| `layer:test` | Test Layer | `spec/`, `test/`, `*.spec.rb`, `*_test.rb` |

### Notable Patterns to Capture in languageLesson

- **Convention over configuration**: Rails derives routing, table names, and file locations from naming conventions — `UsersController` maps to `users_controller.rb`, handles `/users`, and queries the `users` table
- **ActiveRecord pattern**: Models are database wrappers — each model class maps to a table, instances map to rows, and attributes map to columns with automatic type coercion
- **Concerns for shared behavior**: `ActiveSupport::Concern` modules are mixins included in models or controllers to share validations, scopes, callbacks, and methods across classes
- **Strong parameters for mass-assignment protection**: `params.require(:user).permit(:name, :email)` whitelists attributes — controllers must explicitly declare which fields can be set from user input
- **RESTful resource routing**: `resources :posts` generates seven standard CRUD routes — Rails strongly encourages RESTful design where each controller maps to a resource
- **Callbacks and observers**: `before_save`, `after_create`, and similar callbacks inject logic into the object lifecycle — they create invisible execution paths that can be difficult to trace
