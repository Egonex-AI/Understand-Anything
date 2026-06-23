# PHP Language Prompt Snippet

## Key Concepts

- **Namespaces**: Organize code and prevent naming collisions using backslash-delimited paths
- **Traits**: Horizontal code reuse mechanism for sharing methods across unrelated classes
- **Type Declarations**: Parameter, return, and property types (scalar, union, intersection types)
- **Attributes (PHP 8+)**: Native metadata annotations replacing docblock-based configuration
- **Enums (PHP 8.1+)**: First-class enumeration types with methods and interface implementation
- **Fibers**: Lightweight cooperative concurrency primitives for non-blocking I/O
- **Closures/Anonymous Functions**: First-class functions with explicit `use` for variable capture
- **Magic Methods**: Special methods like `__construct`, `__get`, `__set`, `__call` for object behavior
- **Dependency Injection**: Constructor injection managed by PSR-11 compatible containers
- **Middleware**: Request/response pipeline pattern central to modern PHP frameworks

## Import Patterns

- `use Namespace\ClassName` — import a class by its fully qualified name
- `use Namespace\ClassName as Alias` — import with an alias to avoid conflicts
- `namespace App\Http\Controllers` — declare the current file's namespace
- `use function Namespace\functionName` — import a namespaced function

## File Patterns

- `composer.json` — dependency management and PSR-4 autoloading configuration
- `index.php` — web application entry point (front controller)
- `artisan` — Laravel CLI entry point for commands and migrations
- `routes/` — route definition files (web.php, api.php in Laravel)
- PSR-4 autoloading maps namespace prefixes to directory paths

## Common Frameworks

- **Laravel** — Full-featured framework with Eloquent ORM, Blade templates, and queues
- **Symfony** — Component-based framework powering many PHP projects and libraries
- **WordPress** — CMS platform with hook-based plugin architecture
- **Slim** — Micro-framework for APIs and small applications
- **CodeIgniter** — Lightweight MVC framework with minimal configuration

## Example Language Notes

> Uses PHP 8 attributes `#[Route('/api/users')]` for declarative route mapping on
> controller methods. Attributes replace the older docblock annotation pattern,
> providing native language support for metadata that tools can reflect upon.
>
> PSR-4 autoloading in `composer.json` maps `App\` to `src/`, so the class
> `App\Http\Controllers\UserController` loads from `src/Http/Controllers/UserController.php`.
