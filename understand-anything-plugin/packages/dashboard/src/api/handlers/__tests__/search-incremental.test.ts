import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  hasFileChanged,
  createIncrementalState,
  updateIndexIncrementally,
  SearchIndexCache,
} from "../search-incremental"
import type { SearchIndexState, SearchIndexItem } from "../search"

function createMockItem(id: string, name: string): SearchIndexItem {
  return {
    id,
    text: `${name} test content`,
    meta: {
      name,
      type: "function",
      layer: "kg",
      summary: `Summary for ${name}`,
    },
  }
}

function createMockState(items: SearchIndexItem[] = []): SearchIndexState {
  const itemById = new Map<string, SearchIndexItem>()
  for (const item of items) itemById.set(item.id, item)

  return {
    items,
    itemById,
    tokenizedDocs: items.map(i => i.text.split(/\s+/)),
    tokenizedDocSets: items.map(i => new Set(i.text.split(/\s+/))),
    cjkInvertedIndex: new Map(),
    lumo: {} as any,
    edges: [],
    adjacency: new Map(),
    mtimes: {},
  }
}

describe("search-incremental.ts", () => {
  describe("hasFileChanged", () => {
    it("should return true when file does not exist", () => {
      const result = hasFileChanged("/nonexistent/file.json", 0)
      expect(result).toBe(true)
    })

    it("should return false when file has not changed", () => {
      // 使用一个肯定存在的文件
      const result = hasFileChanged("/tmp", Date.now() + 1000000)
      expect(result).toBe(false)
    })
  })

  describe("createIncrementalState", () => {
    it("should create state from index", () => {
      const items = [createMockItem("1", "Test")]
      const index = createMockState(items)

      const result = createIncrementalState(index, "/tmp")

      expect(result.index).toBe(index)
      expect(result.fileMtimes).toBeDefined()
    })

    it("should handle empty index", () => {
      const index = createMockState([])

      const result = createIncrementalState(index, "/tmp")

      expect(result.index).toBe(index)
    })
  })

  describe("updateIndexIncrementally", () => {
    it("should call buildIndex and return new state", () => {
      const oldItems = [createMockItem("1", "Old")]
      const newItems = [createMockItem("1", "New"), createMockItem("2", "New2")]

      const oldState = createIncrementalState(createMockState(oldItems), "/tmp")
      const buildIndex = vi.fn().mockReturnValue(createMockState(newItems))

      const result = updateIndexIncrementally(oldState, buildIndex, "/tmp")

      expect(buildIndex).toHaveBeenCalled()
      expect(result.index.items.length).toBe(2)
      expect(result.index.items[0].meta.name).toBe("New")
    })

    it("should preserve fileMtimes", () => {
      const oldState = createIncrementalState(createMockState([]), "/tmp")
      oldState.fileMtimes.set("test.json", 12345)

      const buildIndex = vi.fn().mockReturnValue(createMockState([]))
      const result = updateIndexIncrementally(oldState, buildIndex, "/tmp")

      expect(result.fileMtimes.get("test.json")).toBe(12345)
    })
  })

  describe("SearchIndexCache", () => {
    it("should cache index and return on subsequent calls", () => {
      const cache = new SearchIndexCache()
      const items = [createMockItem("1", "Test")]
      const buildIndex = vi.fn().mockReturnValue(createMockState(items))

      // 首次调用
      const result1 = cache.get("key", ["/tmp"], buildIndex)
      expect(buildIndex).toHaveBeenCalledTimes(1)
      expect(result1.items.length).toBe(1)

      // 再次调用（应该使用缓存）
      const result2 = cache.get("key", ["/tmp"], buildIndex)
      expect(buildIndex).toHaveBeenCalledTimes(1) // 没有再次调用
      expect(result2).toBe(result1) // 返回同一个引用
    })

    it("should rebuild when file changes", () => {
      const cache = new SearchIndexCache()
      const items1 = [createMockItem("1", "Old")]
      const items2 = [createMockItem("1", "New")]

      const buildIndex = vi.fn()
        .mockReturnValueOnce(createMockState(items1))
        .mockReturnValueOnce(createMockState(items2))

      // 首次调用
      cache.get("key", ["/tmp"], buildIndex)

      // 清除缓存模拟文件变化
      cache.clear()

      // 再次调用
      const result = cache.get("key", ["/tmp"], buildIndex)
      expect(buildIndex).toHaveBeenCalledTimes(2)
      expect(result.items[0].meta.name).toBe("New")
    })

    it("should handle multiple keys", () => {
      const cache = new SearchIndexCache()
      const buildIndex1 = vi.fn().mockReturnValue(createMockState([createMockItem("1", "A")]))
      const buildIndex2 = vi.fn().mockReturnValue(createMockState([createMockItem("2", "B")]))

      const result1 = cache.get("key1", ["/tmp"], buildIndex1)
      const result2 = cache.get("key2", ["/tmp"], buildIndex2)

      expect(result1.items[0].id).toBe("1")
      expect(result2.items[0].id).toBe("2")
    })
  })
})
