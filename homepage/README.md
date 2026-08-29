# Understand Anything Homepage

Astro site for the Understand Anything project homepage.

## Project Structure

```text
homepage/
├── public/
├── src/
│   ├── components/
│   └── pages/
└── package.json
```

The homepage is published as a static Astro site. Public messaging should use
the Egonex organization identity and link company/product traffic to
`https://egonex.ai` where relevant.

## Commands

Run these from the repository root:

| Command | Action |
| :-- | :-- |
| `pnpm --filter homepage dev` | Start the local dev server |
| `pnpm --filter homepage build` | Build the static site |
| `pnpm --filter homepage preview` | Preview the built site |
