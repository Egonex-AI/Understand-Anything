import { describe, it, expect } from "vitest"
import { tokenize } from "../search"

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
