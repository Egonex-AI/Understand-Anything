import type { ApiRequest, ApiContext, ApiResponse, ApiRouter } from "./types"
import { handleServicesRequest } from "./handlers/services"
import { handleGraphQueryRequest } from "./handlers/graph-query"
import { handleGraphRequest } from "./handlers/graph"
import { handleWikiRequest } from "./handlers/wiki"
import { handleSourceRequest } from "./handlers/source"
import { handleBusinessRequest } from "./handlers/business"
import { handleSearchRequest } from "./handlers/search"
import { handleStructureRequest } from "./handlers/structure"
import { handleKnowledgeTraceRequest } from "./handlers/knowledge"

const HANDLERS = [
  handleServicesRequest,
  handleSearchRequest,
  handleKnowledgeTraceRequest,
  handleGraphQueryRequest,
  handleBusinessRequest,
  handleWikiRequest,
  handleSourceRequest,
  handleStructureRequest,
  handleGraphRequest,
]

export function createApiRouter(): ApiRouter {
  return {
    async handle(req: ApiRequest, ctx: ApiContext): Promise<ApiResponse | null> {
      for (const handler of HANDLERS) {
        const res = await handler(req, ctx)
        if (res !== null) return res
      }
      return null
    },
  }
}

export type { ApiRequest, ApiResponse, ApiContext } from "./types"
