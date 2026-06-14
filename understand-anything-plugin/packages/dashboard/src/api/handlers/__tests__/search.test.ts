import { describe, it, expect } from "vitest"
import { tokenize, handleSearchRequest } from "../search"
import type { ApiRequest, ApiContext } from "../../types"

function makeReq(params: Record<string, string>): ApiRequest {
  const searchParams = new URLSearchParams(params)
  return {
    pathname: "/api/search",
    searchParams,
    method: "GET",
    url: `/api/search?${searchParams.toString()}`,
    headers: {},
    body: undefined,
  } as ApiRequest
}

const mockCtx = {} as ApiContext

describe("handleSearchRequest", () => {
  it("returns 400 when q is missing", async () => {
    const res = await handleSearchRequest(makeReq({}), mockCtx)
    expect(res?.statusCode).toBe(400)
  })
  it("returns 400 for invalid scope", async () => {
    const res = await handleSearchRequest(makeReq({ q: "test", scope: "invalid" }), mockCtx)
    expect(res?.statusCode).toBe(400)
  })
  it("returns 400 for invalid limit", async () => {
    const res = await handleSearchRequest(makeReq({ q: "test", limit: "0" }), mockCtx)
    expect(res?.statusCode).toBe(400)
  })
  it("returns 400 for limit over 200", async () => {
    const res = await handleSearchRequest(makeReq({ q: "test", limit: "201" }), mockCtx)
    expect(res?.statusCode).toBe(400)
  })
  it("returns 400 for negative offset", async () => {
    const res = await handleSearchRequest(makeReq({ q: "test", offset: "-1" }), mockCtx)
    expect(res?.statusCode).toBe(400)
  })
  it("returns 400 for invalid fusion", async () => {
    const res = await handleSearchRequest(makeReq({ q: "test", fusion: "invalid" }), mockCtx)
    expect(res?.statusCode).toBe(400)
  })
  it("accepts type filter", async () => {
    const res = await handleSearchRequest(makeReq({ q: "user", type: "class" }), mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })
  it("accepts tag filter", async () => {
    const res = await handleSearchRequest(makeReq({ q: "user", tag: "auth" }), mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })
  it("accepts valid scope values", async () => {
    for (const scope of ["all", "kg", "wiki", "domain", "business"]) {
      const res = await handleSearchRequest(makeReq({ q: "test", scope }), mockCtx)
      expect(res?.statusCode).not.toBe(400)
    }
  })
  it("ignores requests for other paths", async () => {
    const searchParams = new URLSearchParams({ q: "test" })
    const req = {
      pathname: "/api/other",
      searchParams,
      method: "GET",
      url: "/api/other?q=test",
      headers: {},
      body: undefined,
    } as ApiRequest
    const res = await handleSearchRequest(req, mockCtx)
    expect(res).toBeNull()
  })
})

describe("search.ts", () => {
  describe("tokenize", () => {
    it("should tokenize English text", () => {
      const result = tokenize("Hello World")
      expect(result).toContain("hello")
      expect(result).toContain("world")
    })

    it("should handle camelCase", () => {
      const result = tokenize("getUserName")
      expect(result).toContain("get")
      expect(result).toContain("user")
      expect(result).toContain("name")
    })

    it("should handle snake_case", () => {
      const result = tokenize("get_user_name")
      expect(result).toContain("get")
      expect(result).toContain("user")
      expect(result).toContain("name")
    })

    it("should handle Chinese text with jieba", () => {
      const result = tokenize("用户管理")
      expect(result.length).toBeGreaterThan(0)
      // jieba should segment Chinese text
      expect(result.some((t) => /[一-鿿]/.test(t))).toBe(true)
    })

    it("should handle Chinese phrases", () => {
      const result = tokenize("订单管理系统")
      expect(result.length).toBeGreaterThan(0)
      // Should contain segmented Chinese words
      expect(result.some((t) => /[一-鿿]/.test(t))).toBe(true)
    })

    it("should handle Chinese with numbers", () => {
      const result = tokenize("订单123管理")
      expect(result).toContain("123")
      expect(result.some((t) => /[一-鿿]/.test(t))).toBe(true)
    })

    it("should handle long Chinese text", () => {
      const result = tokenize("这是一个很长的中文句子用于测试分词效果")
      expect(result.length).toBeGreaterThan(5)
    })

    it("should handle mixed Chinese and English", () => {
      const result = tokenize("getUser用户管理")
      expect(result).toContain("get")
      // jieba segments Chinese text separately
      expect(result.some((t) => /[一-鿿]/.test(t))).toBe(true)
    })

    it("should handle single Chinese character", () => {
      const result = tokenize("用")
      expect(result.length).toBeGreaterThan(0)
    })

    it("should filter short tokens", () => {
      const result = tokenize("a b c")
      expect(result).not.toContain("a")
      expect(result).not.toContain("b")
      expect(result).not.toContain("c")
    })

    it("should handle empty string", () => {
      const result = tokenize("")
      expect(result).toEqual([])
    })

    it("should handle special characters", () => {
      const result = tokenize("user-name_test.file/path")
      expect(result).toContain("user")
      expect(result).toContain("name")
      expect(result).toContain("test")
      expect(result).toContain("file")
      expect(result).toContain("path")
    })

    it("should handle numbers", () => {
      const result = tokenize("test123")
      expect(result).toContain("test123")
    })

    it("should lowercase tokens", () => {
      const result = tokenize("HELLO WORLD")
      expect(result).toContain("hello")
      expect(result).toContain("world")
    })
  })
})
