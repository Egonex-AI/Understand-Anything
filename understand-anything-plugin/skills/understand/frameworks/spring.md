# Spring Boot Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Spring Boot is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Spring Boot Project Structure

When analyzing a Spring Boot project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `*Application.java`, `*Application.kt` | Application entry point — `@SpringBootApplication` class with `main()` method | `entry-point`, `config` |
| `*Controller.java`, `*RestController.java` | REST controllers — handle HTTP requests, delegate to services | `api-handler` |
| `*Service.java` | Service interfaces — define business operation contracts | `service` |
| `*ServiceImpl.java` | Service implementations — contain business logic | `service` |
| `*Repository.java` | Spring Data repositories — data access interfaces extending JpaRepository/CrudRepository | `data-model` |
| `*Entity.java` | JPA entities — map to database tables via `@Entity` annotation | `data-model` |
| `*DTO.java`, `*Request.java`, `*Response.java` | Data transfer objects — request/response payloads | `type-definition` |
| `*Config.java`, `*Configuration.java` | Configuration classes — `@Configuration` beans, security config, web config | `config` |
| `*Filter.java` | Servlet filters — intercept requests before they reach controllers | `middleware` |
| `*Interceptor.java` | Handler interceptors — pre/post processing around controller methods | `middleware` |
| `*Advice.java`, `*ExceptionHandler.java` | Controller advice — global exception handling and response wrapping | `middleware` |
| `*Mapper.java` | Object mappers — convert between entities and DTOs (MapStruct, ModelMapper) | `utility` |
| `application.yml`, `application.properties` | Application configuration — profiles, datasource, server settings | `config` |
| `*Test.java`, `*Tests.java`, `*IT.java` | Unit tests, integration tests | `test` |

### Edge Patterns to Look For

**@Autowired injection** — When a class injects a dependency via `@Autowired`, constructor injection, or `@Inject`, create `depends_on` edges from the consumer to the injected bean. Constructor injection is preferred and most common in modern Spring.

**Controller-Service-Repository chain** — The canonical call chain is `@RestController` -> `@Service` -> `@Repository`. Create `depends_on` edges along this chain to show the layered architecture.

**@Entity relationships** — When entities define `@OneToMany`, `@ManyToOne`, `@OneToOne`, or `@ManyToMany` annotations, create `depends_on` edges between entity classes with descriptions indicating the relationship type and direction.

**@Configuration bean definitions** — When a `@Configuration` class defines `@Bean` methods, create `configures` edges from the configuration class to the types it produces. These beans become available for injection throughout the application.

### Architectural Layers for Spring Boot

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:api` | API Layer | `*Controller.java`, REST endpoints, API documentation |
| `layer:service` | Service Layer | `*Service.java`, `*ServiceImpl.java`, business logic |
| `layer:data` | Data Layer | `*Repository.java`, `*Entity.java`, JPA mappings, database migrations |
| `layer:types` | Types Layer | `*DTO.java`, `*Request.java`, `*Response.java`, shared value objects |
| `layer:config` | Config Layer | `*Configuration.java`, `application.yml`, security config, `*Application.java` |
| `layer:middleware` | Middleware Layer | `*Filter.java`, `*Interceptor.java`, `*Advice.java`, security filters |
| `layer:test` | Test Layer | `*Test.java`, `*Tests.java`, `*IT.java`, test configuration |

### Notable Patterns to Capture in languageLesson

- **Dependency injection via constructor injection**: Spring favors constructor injection over field injection (`@Autowired` on fields) — it makes dependencies explicit, supports immutability, and simplifies testing
- **Layered architecture (Controller -> Service -> Repository)**: Spring Boot applications follow a strict layered pattern where controllers handle HTTP, services contain business logic, and repositories manage persistence
- **Spring Security filter chain**: Security is implemented as a chain of servlet filters — `SecurityFilterChain` beans configure authentication, authorization, CORS, and CSRF protection
- **JPA entity lifecycle**: Entities transition through states (transient, managed, detached, removed) — understanding this lifecycle is essential for tracing data flow through the persistence layer
- **AOP for cross-cutting concerns**: `@Aspect` classes with `@Before`, `@After`, and `@Around` advice inject behavior at join points — used for logging, transactions (`@Transactional`), and caching (`@Cacheable`)
