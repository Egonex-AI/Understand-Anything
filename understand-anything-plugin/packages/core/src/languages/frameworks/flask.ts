import type { FrameworkConfig } from "../types.js";

export const flaskConfig = {
  id: "flask",
  displayName: "Flask",
  languages: ["python"],
  detectionKeywords: [
    "flask",
    "flask-restful",
    "flask-sqlalchemy",
    "flask-marshmallow",
    "flask-wtf",
  ],
  manifestFiles: [
    "requirements.txt",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "Pipfile",
  ],
  promptSnippetPath: "./frameworks/flask.md",
  entryPoints: ["app.py", "run.py", "wsgi.py"],
  layerHints: {
    blueprints: "api",
    views: "api",
    models: "data",
    forms: "ui",
    templates: "ui",
    extensions: "config",
  },
} satisfies FrameworkConfig;
