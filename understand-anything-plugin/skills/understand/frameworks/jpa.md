# JPA / Jakarta Persistence Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts for JPA,
> Jakarta/Java Persistence, Hibernate, EclipseLink, and Spring projects.
> Append to the base prompt; these rules apply independently of Spring.

## Entity Roles

- Recognize `@Entity` classes through `javax.persistence` or `jakarta.persistence`
  imports, regardless of the file or class naming convention. Tag them
  `data-model`; preserve their class nodes and source paths.
- Capture explicit `@Table`, `@Id`, and `@EmbeddedId` mappings in summaries when
  present. Do not infer table names or keys that the source does not establish.
- Treat `META-INF/persistence.xml` as persistence configuration, including its
  declared provider and persistence units. It does not imply Spring services,
  controllers, repositories, or dependency injection.

## Entity Relationships

For `@OneToMany`, `@ManyToOne`, `@OneToOne`, and `@ManyToMany`, create a
`depends_on` edge from the class declaring the relationship to the referenced
entity class. Resolve the target from its field/getter type, collection generic
argument, or explicit `targetEntity`, using source and import evidence.

Describe the annotation, source member, and any explicit `mappedBy` or join
mapping. `mappedBy` indicates the inverse side of a mapping; it does not reverse
the declaring class's reference. Emit the reverse relationship only when the
other entity actually declares it. Do not invent entities for unresolved or
external target types.

## Architecture

Group entities and persistence configuration with the existing data/persistence
layer when the source supports one. For EclipseLink or standalone JPA projects,
derive surrounding layers from their own packages and entry points; apply Spring
controller/service/repository conventions only when Spring is independently
present.

Annotation reference: [Jakarta Persistence API](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/onetomany).
