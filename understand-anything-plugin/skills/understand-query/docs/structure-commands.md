# Structure Commands

Query function signatures, class annotations, parameter types, return types, interface implementations, and source code from the `structural-analysis.json` pre-computed index.

---

## `structure` — Code Structure: Signatures, Annotations, Types

Complements the KG (which has names/summaries but not full type info).

**When to use `structure` instead of KG:**
- "Find all `@MoaProvider` annotated classes" → `structure --annotation MoaProvider`
- "Which methods accept a `UserDTO` parameter?" → `structure --param-type UserDTO`
- "What does this method return?" → `structure --file ServiceImpl.java`
- "Which classes implement `IOrderService`?" → `structure --interface IOrderService`
- "Find all definitions of `createOrder` across the codebase" → `structure --symbol createOrder`
- "Show me the source code of `createOrder`" → `structure --symbol createOrder --source`

**Flags (search mode):**

| Flag | Type | Description |
|------|------|-------------|
| `--service NAME` | string | Target service (required) |
| `--q QUERY` | string | Fuzzy search across name, annotations, paramTypes, returnType, content |
| `--annotation NAME` | string | Filter by annotation (e.g. `@Service`, `@MoaProvider`) |
| `--param-type TYPE` | string | Filter by function parameter type |
| `--return-type TYPE` | string | Filter by function return type |
| `--interface NAME` | string | Filter by implemented interface |
| `--property-type TYPE` | string | Filter by class property/field type |
| `--section-key NAME` | string | Filter by section name substring (function/class name) |
| `--section-value TEXT` | string | Filter by section content substring |
| `--path PATTERN` | string | Filter by file path substring |
| `--symbol NAME` | string | Cross-file symbol search (post-filter by name) |
| `--limit N` | int | Max results (default: 50) |
| `--offset N` | int | Pagination offset (default: 0) |

**Flags (file/chain mode):**

| Flag | Type | Description |
|------|------|-------------|
| `--file PATH` | string | Get structure for a specific file (exact or suffix match) |
| `--start N` | int | Start line for `--file --source` (1-based) |
| `--end N` | int | End line for `--file --source` (1-based) |
| `--files` | boolean | List all indexed file paths |
| `--chain CLASS` | string | Traverse inheritance chain for a class name |
| `--direction DIR` | string | Chain direction: `up` (superclasses) or `down` (subclasses, default: `up`) |
| `--implementors IFACE` | string | Find all classes implementing an interface |
| `--source` | boolean | Include source code. With `--symbol`: returns source per matched symbol. With `--file`: appends `sourceContent` to the file structure response. |

---

### Cross-file symbol search

Find all functions/classes matching a name across all indexed files:

```bash
python ua_query.py structure --service S --symbol createOrder
python ua_query.py structure --service S --symbol OrderService --limit 10
```

Returns structural detail per match: `filePath`, `name`, `kind`, `lineRange`, `match`.

### Symbol search with source code

Find the symbol AND read its implementation in one call:

```bash
python ua_query.py structure --service S --symbol createOrder --source
python ua_query.py structure --service S --symbol GiftHallDao --source --limit 3
```

With `--source`, uses the server-side `/api/structure/symbol-source` endpoint to return both structural metadata and the actual source code for each matched symbol. This is the most efficient way to locate and read a specific method or class when you know its name.

---

### File lookup

Get full structural detail for a specific file:

```bash
python ua_query.py structure --service S --file src/main/.../UserService.java
# Suffix match works:
python ua_query.py structure --service S --file UserService.java
```

### Annotation search

Find classes/functions by annotation:

```bash
python ua_query.py structure --service S --annotation MoaProvider
python ua_query.py structure --service S --annotation MoaProvider --path order/
```

### Type-based search

Find functions by param or return type:

```bash
python ua_query.py structure --service S --param-type OrderDTO
python ua_query.py structure --service S --return-type UserDTO
```

### Interface search

Find implementing classes:

```bash
python ua_query.py structure --service S --interface Serializable
```

### Property type search

Find classes with specific dependency types:

```bash
python ua_query.py structure --service S --property-type UserRepository
```

### Fuzzy search (new)

Full-text fuzzy search across name, annotations, param types, return type:

```bash
python ua_query.py structure --service S --q "getUser"
python ua_query.py structure --service S --q "Service" --annotation @Service
python ua_query.py structure --service S --q "Order" --path order/ --limit 10 --offset 20
```

### Section key/value filtering (new)

Filter by section name or content substring:

```bash
python ua_query.py structure --service S --section-key "getUser"
python ua_query.py structure --service S --section-value "UserService"
```

### List all indexed files

```bash
python ua_query.py structure --service S --files
```

---

### Inheritance chain

Trace superclass hierarchy (up) or all descendants (down):

```bash
python ua_query.py structure --service S --chain VipUserEntity --direction up
python ua_query.py structure --service S --chain BaseEntity --direction down
```

### Interface implementors

Find all classes implementing a given interface:

```bash
python ua_query.py structure --service S --implementors IUserService
```

---

## Flags Reference

| Flag | Required | Description |
|------|----------|-------------|
| `--service` | Yes | Service name |
| `--symbol NAME` | No | Search for a function or class by name across all indexed files |
| `--source` | No | With `--symbol`: include actual source code for each matched symbol |
| `--file PATH` | No | Get structure for a file (exact or suffix match) |
| `--files` | No | List all indexed file paths |
| `--annotation NAME` | No | Search by annotation name |
| `--param-type TYPE` | No | Search by function parameter type |
| `--return-type TYPE` | No | Search by function return type |
| `--interface NAME` | No | Search by implemented interface |
| `--property-type TYPE` | No | Search by class property type |
| `--path PATTERN` | No | Filter results by path substring |
| `--q QUERY` | No | Fuzzy search across name, annotations, paramTypes, returnType, content |
| `--section-key NAME` | No | Filter by section name substring (function/class name) |
| `--section-value TEXT` | No | Filter by section content substring |
| `--limit N` | No | Max results (default 50) |
| `--offset N` | No | Pagination offset (default 0) |
| `--start N` | No | Start line for `--file --source` (1-based) |
| `--end N` | No | End line for `--file --source` (1-based) |
| `--chain CLASS` | No | Traverse inheritance chain for a class |
| `--direction up\|down` | No | Chain direction (default: up) |
| `--implementors IFACE` | No | Find all classes implementing an interface |

---

## typeRef auto-resolution

When searching by `paramType`, `returnType`, `propertyType` or `interface`, results automatically include a `typeRef` field pointing to where the referenced type is defined:

```json
{
  "filePath": "svc/src/.../OrderService.java",
  "name": "createOrder",
  "kind": "function",
  "match": { "returnType": "OrderDTO" },
  "typeRef": { "name": "OrderDTO", "filePath": "svc/src/.../OrderDTO.java", "lineRange": [5, 30] }
}
```

No extra call needed to locate the type's definition — `typeRef.filePath` tells you directly.

---

## Disambiguation for duplicate names

All results include `filePath` — Java package paths are embedded (e.g., `com/example/user/UserService.java` vs `com/example/order/UserService.java`). Use `--path` to narrow scope.
