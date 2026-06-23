# Terraform Language Prompt Snippet

## Key Concepts

- **Declarative Infrastructure**: Define desired state; Terraform computes and applies the diff
- **Providers**: Plugins connecting to cloud APIs (AWS, GCP, Azure, Kubernetes, etc.)
- **Resources**: `resource "type" "name"` blocks declaring infrastructure components
- **Data Sources**: `data "type" "name"` blocks reading existing infrastructure state
- **Variables**: `variable` blocks for parameterizing configurations with defaults and validation
- **Outputs**: `output` blocks exposing values for cross-module references or human consumption
- **Modules**: Reusable, composable infrastructure packages with their own variables and outputs
- **State Management**: `.tfstate` files tracking real-world resource mapping (never commit to git)
- **Workspaces**: Isolated state environments for managing dev/staging/prod from one codebase
- **Plan and Apply**: `terraform plan` previews changes, `terraform apply` executes them

## Notable File Patterns

- `main.tf` — Primary resource definitions
- `variables.tf` — Input variable declarations with types and defaults
- `outputs.tf` — Output value definitions
- `providers.tf` — Provider configuration and version constraints
- `backend.tf` — Remote state backend configuration (S3, GCS, etc.)
- `modules/**/*.tf` — Reusable infrastructure modules
- `*.tfvars` — Variable value files for different environments
- `terraform.lock.hcl` — Provider version lock file

## Edge Patterns

- Terraform files `provisions` the infrastructure resources they define
- Module references create `depends_on` edges between terraform files
- Terraform `deploys` application code by referencing container images or deployment targets
- Variable files `configures` the terraform modules they parameterize

## Summary Style

> "Terraform configuration provisioning N AWS resources including VPC, ECS cluster, and RDS instance."
> "Infrastructure module defining a reusable Kubernetes namespace with RBAC and network policies."
> "Variable definitions for N environment-specific settings (region, instance type, scaling)."
