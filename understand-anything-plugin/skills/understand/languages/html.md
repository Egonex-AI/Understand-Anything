# HTML Language Prompt Snippet

## Key Concepts

- **Semantic Elements**: `<main>`, `<nav>`, `<header>`, `<footer>`, `<article>`, `<section>` for meaningful structure
- **Document Structure**: `<!DOCTYPE html>`, `<html>`, `<head>`, `<body>` forming the page skeleton
- **Forms**: `<form>`, `<input>`, `<select>`, `<textarea>` for user data collection with validation attributes
- **Accessibility**: `aria-*` attributes, `role`, `alt` text, and semantic markup for screen readers
- **Meta Tags**: `<meta>` for viewport, charset, description, Open Graph, and SEO metadata
- **Script and Style Loading**: `<script>`, `<link>`, `<style>` for JavaScript and CSS inclusion
- **Data Attributes**: `data-*` custom attributes for storing element-specific data
- **Template Syntax**: Framework-specific templating (`{{ }}` for Jinja/Django, `<%= %>` for ERB)
- **Web Components**: `<template>`, `<slot>`, Custom Elements for encapsulated reusable components

## Notable File Patterns

- `index.html` — Application entry point or SPA shell
- `*.html` / `*.htm` — Static HTML pages
- `templates/**/*.html` — Server-side template files (Django, Jinja2, Go templates)
- `public/index.html` — SPA root document (React, Vue)
- `*.ejs` / `*.hbs` / `*.pug` — Templating engine files

## Edge Patterns

- HTML files `depends_on` JavaScript and CSS files they include via `<script>` and `<link>` tags
- Template HTML files `depends_on` the server-side code that renders them
- HTML entry points are `deploys` targets for build systems and web servers
- HTML files `related` to the components or routes they render

## Summary Style

> "Single-page application shell with viewport meta, CSS reset, and React root mount point."
> "Server-rendered template with navigation, content area, and footer using Django template inheritance."
> "Static landing page with responsive layout, form, and third-party script integrations."
