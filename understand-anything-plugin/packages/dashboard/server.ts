import express from "express"
import cors from "cors"
import { WikiDataService } from "./wiki-api"
import { createApiRouter } from "./src/api/index"
import { resolveProjectRoot } from "./src/api/utils"
import { warmupSearchIndex } from "./src/api/handlers/search"

export interface ServerOptions {
  projectRoot?: string
  port?: number
}

export function createApp(opts: ServerOptions = {}) {
  const projectRoot = opts.projectRoot ?? resolveProjectRoot()
  let wikiService: WikiDataService | null = null
  const getWikiService = () => {
    if (!wikiService) wikiService = new WikiDataService(projectRoot)
    return wikiService
  }
  const router = createApiRouter()
  const app = express()
  const allowedOrigins = process.env.CORS_ORIGINS?.split(",").map(s => s.trim()) ?? []
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) { callback(null, true); return }
      try {
        const { hostname } = new URL(origin)
        if (hostname === "localhost" || hostname === "127.0.0.1" || allowedOrigins.includes(origin)) {
          callback(null, true)
        } else {
          callback(null, false)
        }
      } catch {
        callback(null, false)
      }
    },
  }))
  app.use(async (req, res, next) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1`)
      const apiRes = await router.handle(
        { pathname: url.pathname, searchParams: url.searchParams },
        { getWikiService },
      )
      if (apiRes === null) { next(); return }
      res.status(apiRes.statusCode)
      if (apiRes.headers) {
        for (const [k, v] of Object.entries(apiRes.headers)) res.setHeader(k, v)
      }
      res.json(apiRes.body)
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: "Internal server error" })
    }
  })
  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3001)
  const host = process.env.HOST ?? "0.0.0.0"
  const app = createApp()
  app.listen(port, host, () => {
    console.log(`\n  API Server: http://${host}:${port}/\n`)
    warmupSearchIndex()
  })
}
