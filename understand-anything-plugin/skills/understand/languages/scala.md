# Scala Language Prompt Snippet

## Key Concepts

- **Case Classes**: Immutable data carriers with auto-generated `equals`, `hashCode`, `copy`, and pattern-matching support
- **Pattern Matching**: `match` expressions destructure ADTs exhaustively; the compiler warns on missing cases for sealed hierarchies
- **Traits**: Interface-plus-implementation mixins; stackable behavior via linearization
- **Implicits / Given Instances**: Scala 2 `implicit` / Scala 3 `given`+`using` provide type-class instances and contextual parameters resolved at compile time
- **Type Classes**: Ad-hoc polymorphism via implicit/given instances (e.g. Cats' `Functor`, `Monad`); look for `F[_]` type parameters
- **Higher-Kinded Types**: Abstraction over type constructors (`F[_]`) — the foundation of tagless-final service definitions
- **For-Comprehensions**: Sugar over `flatMap`/`map` chains; the standard way to sequence effects (`IO`, `Future`, `Either`)
- **Effect Systems**: Cats Effect (`IO`, `Resource`, `Fiber`), ZIO, and FS2 model side effects as composable values run at the "end of the world"
- **Companion Objects**: Singleton paired with a class/trait holding factory methods, type-class instances, and ADT constructors
- **Sealed Hierarchies (ADTs)**: `sealed trait` + case classes/objects model closed sums; enums in Scala 3

## Import Patterns

- `import package.ClassName` — import a specific member
- `import package.{A, B}` — selector list importing several members
- `import package._` (Scala 2) / `import package.*` (Scala 3) — wildcard import
- `import package.{Name => Alias}` (Scala 2) / `import package.Name as Alias` (Scala 3) — rename on import
- `import cats.syntax.all._` — syntax-extension imports that enable extension methods (common in Typelevel code)

## File Patterns

- `build.sbt` — sbt build definition; `project/` holds build support code
- `build.sc` / `build.mill` — Mill build definition
- `Main.scala` / `*App.scala` — entry points (`object ... extends IOApp` for Cats Effect, `extends App`/`@main` otherwise)
- `package.scala` — package object holding package-level members (Scala 2 idiom)
- `src/main/scala/` — main source root following sbt conventions
- `src/test/scala/` — test source root; specs conventionally end in `*Spec.scala` / `*Suite.scala`

## Common Frameworks

- **Cats Effect** — pure functional runtime with `IO`, `Resource`, and fiber-based concurrency
- **ZIO** — effect system with typed errors and environment (`ZIO[R, E, A]`)
- **Akka / Pekko** — actor-based concurrency, streaming, and clustering
- **Play Framework** — full-stack MVC web framework
- **http4s** — pure functional HTTP server/client built on Cats Effect and FS2
- **Spark** — distributed data processing; look for `Dataset`/`DataFrame` transformations

## Example Language Notes

> Defines the service as a tagless-final trait `UserRepo[F[_]]` so the same
> business logic runs against `IO` in production and a state monad in tests.
> Given/implicit instances in the companion object wire the production
> implementation.
>
> Uses a sealed trait `Command` with case-class variants matched exhaustively
> in the interpreter — the compiler flags any unhandled command when a new
> variant is added.
