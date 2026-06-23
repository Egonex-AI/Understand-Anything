import type { FrameworkConfig } from "../types.js";

export const fastapiConfig = {
  id: "fastapi",
  displayName: "FastAPI",
  languages: ["python"],
  detectionKeywords: ["fastapi", "uvicorn", "starlette"],
  manifestFiles: [
    "requirements.txt",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "Pipfile",
  ],
  promptSnippetPath: "./frameworks/fastapi.md",
  entryPoints: ["main.py", "app.py"],
  layerHints: {
    routers: "api",
    schemas: "types",
    models: "data",
    dependencies: "service",
    crud: "service",
    api: "api",
  },
} satisfies FrameworkConfig;
