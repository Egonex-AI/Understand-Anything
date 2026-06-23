# Protobuf Language Prompt Snippet

## Key Concepts

- **Message Types**: `message` blocks defining structured data with typed, numbered fields
- **Field Numbers**: Permanent identifiers (1-536870911) — never reuse deleted numbers for backward compatibility
- **Scalar Types**: `int32`, `int64`, `string`, `bytes`, `bool`, `float`, `double`, and more
- **Enums**: Named integer constants for categorical values
- **Services**: `service` blocks defining RPC (Remote Procedure Call) method signatures
- **Oneof**: Mutually exclusive field groups — only one field in the group can be set
- **Repeated Fields**: `repeated` keyword for list/array fields
- **Maps**: `map<key_type, value_type>` for dictionary/hash fields
- **Packages and Imports**: Namespace organization and cross-file references
- **Proto2 vs Proto3**: Proto3 (current) removes required/optional distinction and defaults all fields

## Notable File Patterns

- `*.proto` — Protocol Buffer definition files
- `proto/**/*.proto` — Organized proto definitions by service or domain
- `buf.yaml` / `buf.gen.yaml` — Buf tool configuration for linting and code generation
- `*_pb2.py` / `*.pb.go` / `*_pb.ts` — Generated code (should be excluded from analysis)

## Edge Patterns

- Protobuf files `defines_schema` for the gRPC service handlers that implement the declared RPCs
- Message type references create `related` edges between proto files sharing types
- Proto `import` statements create `depends_on` edges between proto files
- Generated code files are `depends_on` the proto source that produces them

## Summary Style

> "Protocol Buffer definitions for N message types and M RPC services in the user authentication domain."
> "Shared proto types defining common request/response envelopes and error codes."
> "gRPC service definition with N methods for real-time data streaming and batch processing."
