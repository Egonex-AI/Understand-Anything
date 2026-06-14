import MiniSearch from "minisearch"
import { codeTokenize } from "./code-tokenizer"

export interface FunctionEntry {
  name: string
  startLine: number
  endLine: number
  params?: Array<{ name: string; type: string }>
  returnType?: string
  annotations?: Array<{ name: string; arguments?: Record<string, string> }>
}

export interface ClassEntry {
  name: string
  startLine: number
  endLine: number
  kind?: string
  methods?: string[]
  properties?: string[]
  annotations?: Array<{ name: string; arguments?: Record<string, string> }>
  interfaces?: string[]
  superclasses?: string[]
  typedProperties?: Array<{ name: string; type: string }>
}

export interface FileStructure {
  language: string
  fileCategory?: string
  totalLines: number
  functions: FunctionEntry[]
  classes: ClassEntry[]
  imports: Array<{ name: string; line?: number }>
  exports: Array<{ name: string; line?: number; isDefault?: boolean }>
}

export type StructuralAnalysis = Record<string, FileStructure>

interface StructureDoc {
  id: string
  name: string
  annotations: string
  paramTypes: string
  returnType: string
  content: string
  type: string
  service: string
  filePath: string
  startLine: number
  endLine: number
}

export interface StructureSearchResult {
  id: string
  name: string
  type: string
  service: string
  filePath: string
  lineRange: [number, number]
  summary: string
  score: number
  annotations?: string
  paramTypes?: string
  returnType?: string
  sectionKey?: string
}

export interface StructureSearchOptions {
  q?: string
  annotation?: string
  paramType?: string
  returnType?: string
  iface?: string
  propertyType?: string
  symbol?: string
  pathPattern?: string
  sectionKey?: string
  sectionValue?: string
  limit?: number
  offset?: number
}

export interface StructureSearchResponse {
  results: StructureSearchResult[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  facets?: Record<string, Record<string, number>>
}

const MINI_SEARCH_OPTIONS = {
  fields: ["name", "annotations", "paramTypes", "returnType", "content"],
  storeFields: ["name", "type", "service", "filePath", "startLine", "endLine", "annotations", "paramTypes", "returnType"],
  tokenize: codeTokenize,
}

const SEARCH_BOOST = {
  name: 3,
  annotations: 2.5,
  paramTypes: 2,
  returnType: 1.5,
  content: 1,
}

export class StructureIndex {
  private service: string
  private miniSearch: MiniSearch
  private docs: StructureDoc[]

  constructor(service: string, data: StructuralAnalysis) {
    this.service = service
    this.docs = this.buildDocs(service, data)
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
    if (this.docs.length > 0) {
      this.miniSearch.addAll(this.docs)
    }
  }

  private buildDocs(service: string, data: StructuralAnalysis): StructureDoc[] {
    const docs: StructureDoc[] = []
    for (const [filePath, fileData] of Object.entries(data)) {
      const functions = Array.isArray(fileData.functions) ? fileData.functions : []
      const classes = Array.isArray(fileData.classes) ? fileData.classes : []

      for (const fn of functions) {
        const annotationNames = (fn.annotations ?? []).map((a) => a.name).join(" ")
        const paramTypes = (fn.params ?? []).map((p) => p.type).join(" ")
        docs.push({
          id: `${service}::${filePath}::${fn.name}`,
          name: fn.name,
          annotations: annotationNames,
          paramTypes,
          returnType: fn.returnType ?? "",
          content: `${service} ${fn.name} ${annotationNames} ${paramTypes} ${fn.returnType ?? ""}`,
          type: "function",
          service,
          filePath,
          startLine: fn.startLine,
          endLine: fn.endLine,
        })
      }

      for (const cls of classes) {
        const annotationNames = (cls.annotations ?? []).map((a) => a.name).join(" ")
        const interfaceNames = (cls.interfaces ?? []).join(" ")
        const propertyTypes = (cls.typedProperties ?? []).map((p) => p.type).join(" ")
        docs.push({
          id: `${service}::${filePath}::${cls.name}`,
          name: cls.name,
          annotations: annotationNames,
          paramTypes: propertyTypes,
          returnType: interfaceNames,
          content: `${service} ${cls.name} ${annotationNames} ${interfaceNames} ${propertyTypes}`,
          type: cls.kind ?? "class",
          service,
          filePath,
          startLine: cls.startLine,
          endLine: cls.endLine,
        })
      }
    }
    return docs
  }

  search(opts: StructureSearchOptions): StructureSearchResponse {
    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0

    const filter = (doc: Record<string, unknown>): boolean => {
      if (opts.annotation && !(doc.annotations as string ?? "").includes(opts.annotation)) return false
      if (opts.paramType && !(doc.paramTypes as string ?? "").includes(opts.paramType)) return false
      if (opts.returnType && doc.returnType !== opts.returnType) return false
      if (opts.iface && !(doc.returnType as string ?? "").includes(opts.iface)) return false
      if (opts.propertyType && !(doc.paramTypes as string ?? "").includes(opts.propertyType)) return false
      if (opts.pathPattern && !(doc.filePath as string ?? "").toLowerCase().includes(opts.pathPattern.toLowerCase())) return false
      if (opts.sectionKey && !(doc.name as string ?? "").toLowerCase().includes(opts.sectionKey.toLowerCase())) return false
      if (opts.sectionValue && !(doc.content as string ?? "").toLowerCase().includes(opts.sectionValue.toLowerCase())) return false
      return true
    }

    let miniResults: Array<{ id: string; score: number; [key: string]: unknown }>

    if (opts.q) {
      miniResults = this.miniSearch.search(opts.q, {
        filter,
        boost: SEARCH_BOOST,
        prefix: true,
        fuzzy: 0.2,
      })
    } else {
      miniResults = this.docs
        .filter((doc) => filter(doc as Record<string, unknown>))
        .map((doc) => ({ id: doc.id, score: 0, ...doc }))
    }

    let filtered = miniResults
    if (opts.symbol) {
      const symbolLower = opts.symbol.toLowerCase()
      filtered = filtered.filter((r) => (r.name as string).toLowerCase().includes(symbolLower))
    }

    const total = filtered.length
    const paged = filtered.slice(offset, offset + limit)

    const results: StructureSearchResult[] = paged.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      type: r.type as string,
      service: r.service as string,
      filePath: r.filePath as string,
      lineRange: [r.startLine as number, r.endLine as number],
      summary: `${r.type} ${(r.name as string)} in ${r.filePath as string}`,
      score: r.score,
      annotations: r.annotations as string | undefined,
      paramTypes: r.paramTypes as string | undefined,
      returnType: r.returnType as string | undefined,
    }))

    return {
      results,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      facets: this.computeFacets(filtered),
    }
  }

  private computeFacets(results: Array<Record<string, unknown>>): Record<string, Record<string, number>> {
    const facets: Record<string, Record<string, number>> = {}
    for (const r of results) {
      for (const key of ["type", "service"]) {
        const val = r[key] as string
        if (!val) continue
        facets[key] ??= {}
        facets[key][val] = (facets[key][val] ?? 0) + 1
      }
    }
    return facets
  }
}
