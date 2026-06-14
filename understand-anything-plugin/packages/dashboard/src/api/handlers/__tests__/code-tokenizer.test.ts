import { describe, it, expect } from "vitest"
import { codeTokenize } from "../code-tokenizer"

describe("codeTokenize", () => {
  describe("CamelCase splitting", () => {
    it("splits camelCase", () => {
      expect(codeTokenize("getUser")).toEqual(expect.arrayContaining(["get", "user"]))
    })
    it("splits PascalCase", () => {
      expect(codeTokenize("GetUser")).toEqual(expect.arrayContaining(["get", "user"]))
    })
    it("splits consecutive uppercase (HTTPResponse)", () => {
      expect(codeTokenize("HTTPResponse")).toEqual(expect.arrayContaining(["http", "response"]))
    })
    it("splits multi-word camelCase (getUserName)", () => {
      const tokens = codeTokenize("getUserName")
      expect(tokens).toEqual(expect.arrayContaining(["get", "user", "name"]))
    })
  })

  describe("snake_case splitting", () => {
    it("splits snake_case", () => {
      expect(codeTokenize("get_user")).toEqual(expect.arrayContaining(["get", "user"]))
    })
    it("splits UPPER_SNAKE_CASE", () => {
      expect(codeTokenize("GET_USER")).toEqual(expect.arrayContaining(["get", "user"]))
    })
  })

  describe("separator splitting", () => {
    it("splits kebab-case", () => {
      expect(codeTokenize("get-user")).toEqual(expect.arrayContaining(["get", "user"]))
    })
    it("splits dot notation", () => {
      expect(codeTokenize("spring.datasource.url")).toEqual(expect.arrayContaining(["spring", "datasource", "url"]))
    })
    it("splits slash notation", () => {
      expect(codeTokenize("src/main/java")).toEqual(expect.arrayContaining(["src", "main", "java"]))
    })
  })

  describe("number extraction", () => {
    it("extracts multi-digit numbers", () => {
      expect(codeTokenize("v2")).toEqual(expect.arrayContaining(["v2"]))
    })
    it("extracts standalone numbers", () => {
      expect(codeTokenize("123")).toEqual(expect.arrayContaining(["123"]))
    })
    it("filters single-digit numbers", () => {
      const tokens = codeTokenize("a1b")
      expect(tokens).not.toContain("1")
    })
  })

  describe("CJK segmentation", () => {
    it("segments Chinese text", () => {
      const tokens = codeTokenize("用户认证")
      expect(tokens.length).toBeGreaterThan(0)
      expect(tokens.some((t) => /[一-鿿]/.test(t))).toBe(true)
    })
    it("handles mixed Chinese and English", () => {
      const tokens = codeTokenize("UserService 用户服务")
      expect(tokens).toEqual(expect.arrayContaining(["user", "service"]))
      expect(tokens.some((t) => /[一-鿿]/.test(t))).toBe(true)
    })
    it("handles CJK Extension A characters (U+3400-U+4DBF)", () => {
      const tokens = codeTokenize("㐀䶵")
      expect(tokens.some((t) => /[㐀-䶿]/.test(t))).toBe(true)
    })
  })

  describe("edge cases", () => {
    it("returns empty array for empty string", () => {
      expect(codeTokenize("")).toEqual([])
    })
    it("filters single-character tokens", () => {
      const tokens = codeTokenize("a b c")
      expect(tokens).toEqual([])
    })
    it("returns empty for whitespace only", () => {
      expect(codeTokenize("   ")).toEqual([])
    })
  })
})
