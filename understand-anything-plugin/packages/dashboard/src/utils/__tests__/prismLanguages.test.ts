import { describe, expect, it } from "vitest";
import { languageForPath } from "../prismLanguages";

describe("languageForPath", () => {
  it("maps common extensions", () => {
    expect(languageForPath("src/App.tsx")).toBe("tsx");
    expect(languageForPath("src/server.mjs")).toBe("javascript");
    expect(languageForPath("com/example/UserService.java")).toBe("java");
    expect(languageForPath("app/models/user.rb")).toBe("ruby");
    expect(languageForPath("public/index.php")).toBe("php");
    expect(languageForPath("scripts/install.sh")).toBe("bash");
    expect(languageForPath("Cargo.toml")).toBe("toml");
    expect(languageForPath("Program.cs")).toBe("csharp");
  });

  it("matches extension-less files by name", () => {
    expect(languageForPath("Dockerfile")).toBe("docker");
    expect(languageForPath("docker/Dockerfile.dev")).toBe("docker");
    expect(languageForPath("Makefile")).toBe("makefile");
    expect(languageForPath("Gemfile")).toBe("ruby");
    expect(languageForPath(".env.local")).toBe("bash");
  });

  it("is case-insensitive and handles Windows separators", () => {
    expect(languageForPath("SRC\\MAIN.PY")).toBe("python");
  });

  it("falls back to text", () => {
    expect(languageForPath(undefined)).toBe("text");
    expect(languageForPath("LICENSE")).toBe("text");
    expect(languageForPath("data.bin")).toBe("text");
  });
});
