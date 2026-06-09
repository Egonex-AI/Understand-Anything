import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { findGraphFile, projectRootFromGraphFile, graphFilePathSet } from "../utils"
import { readSource } from "../../../source-reader"

export async function handleSourceRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req

  if (pathname !== "/api/source") return null

  const file = searchParams.get("file") ?? ""
  const service = searchParams.get("service")
  const mode = searchParams.get("mode") ?? "wiki"
  const start = searchParams.get("start")
  const end = searchParams.get("end")

  let graphFile = findGraphFile("knowledge-graph.json")
  let baseRoot: string

  if (graphFile) {
    baseRoot = projectRootFromGraphFile(graphFile)
  } else {
    baseRoot = process.env.GRAPH_DIR ?? process.cwd()
  }

  let projectRoot = baseRoot
  if (service) {
    const serviceRoot = path.join(baseRoot, service)
    if (fs.existsSync(path.join(serviceRoot, ".understand-anything"))) {
      projectRoot = serviceRoot
      if (!graphFile) {
        const serviceGraph = path.join(serviceRoot, ".understand-anything", "knowledge-graph.json")
        if (fs.existsSync(serviceGraph)) graphFile = serviceGraph
      }
    }
  }

  if (!graphFile && mode === "graph") {
    return { statusCode: 404, body: { error: "No knowledge graph found" } }
  }

  let kgAllowlist: Set<string> | undefined
  if (mode === "graph") {
    const kgPath = path.join(projectRoot, ".understand-anything", "knowledge-graph.json")
    if (fs.existsSync(kgPath)) {
      kgAllowlist = graphFilePathSet(kgPath, projectRoot)
    }
  }

  const result = readSource({
    projectRoot,
    filePath: file,
    startLine: start,
    endLine: end,
    kgAllowlist,
  })
  return { statusCode: result.statusCode, body: result.payload }
}
