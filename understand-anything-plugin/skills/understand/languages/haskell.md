# Haskell Language Prompt Snippet

## Key Concepts

- **Pure Functions and Effects**: Most functions are pure; effects are explicit in types such as `IO`, `ReaderT`, `ExceptT`, or application-specific monad stacks.
- **Algebraic Data Types**: `data` and `newtype` declarations model sum and product types; constructors and record fields are important domain vocabulary.
- **Type Classes and Instances**: `class` defines behavior and `instance` supplies implementations. Instance selection is compile-time wiring, not conventional inheritance.
- **Pattern Matching**: Multiple equations, guards, and `case` expressions jointly define control flow.
- **Higher-Order Composition**: Point-free functions, operators, functor/applicative/monadic combinators, and lenses can encode substantial behavior compactly.
- **Language Extensions**: Pragmas such as `GADTs`, `DataKinds`, and `OverloadedStrings` materially change available syntax and type semantics.

## Import Patterns

- `import Project.Module` imports an internal module by its declared module name.
- `import qualified Data.Text as T` keeps names qualified; calls appear as `T.pack`, `T.unpack`, and similar.
- `import Project.Types (User(..), UserId)` restricts imported symbols and may expose constructors with `(..)`.
- `import Project.Module hiding (name)` imports everything except listed names.

## File Patterns

- `*.cabal`, `cabal.project` — Cabal package/component definitions and source roots.
- `package.yaml` — hpack manifest; `stack.yaml` — Stack resolver/project configuration.
- `app/Main.hs`, `src/Main.hs`, `Main.hs` — common executable entry points.
- `src/` — library modules; `app/` — executables; `test/` — test suites.
- `*Spec.hs`, `*Test.hs` — Hspec/Tasty-style test modules.

## Example Language Notes

> Models capture failures as an algebraic data type and keeps the execution
> boundary in `IO`; pure planning and validation functions remain independently
> testable.

> Defines a type-class capability with production and test instances, making
> dependencies visible in constraints instead of hiding them in global state.
