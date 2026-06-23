# Contributing to Understand Anything

Thank you for your interest in contributing to Understand Anything! This document provides guidelines and instructions for contributing to the project.

## 🌟 Ways to Contribute

- **Bug Reports**: Found a bug? Open an issue with detailed reproduction steps
- **Feature Requests**: Have an idea? Share it in the issues section
- **Documentation**: Improve or translate documentation
- **Code**: Fix bugs, add features, or improve performance
- **Testing**: Write tests to improve code coverage

## 🚀 Getting Started

### Prerequisites

- Node.js >= 22 (developed on v24)
- pnpm >= 10 (pinned via `packageManager` field in root `package.json`)
- Git for version control

### Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/Understand-Anything.git
   cd Understand-Anything
   ```

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Build Core Package**
   ```bash
   pnpm --filter @understand-anything/core build
   ```

4. **Run Tests**
   ```bash
   pnpm --filter @understand-anything/core test
   pnpm --filter @understand-anything/skill test
   ```

5. **Start Dashboard (Optional)**
   ```bash
   pnpm dev:dashboard
   ```

## 📝 Development Workflow

### 1. Create a Branch

Create a descriptive branch name:
```bash
git checkout -b feat/my-feature        # For new features
git checkout -b fix/bug-description    # For bug fixes
git checkout -b docs/update-readme     # For documentation
```

### 2. Make Changes

- Write clean, readable code
- Follow existing code style and conventions
- Add tests for new functionality
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run all tests
pnpm --filter @understand-anything/core test
pnpm --filter @understand-anything/skill test

# Run linter
pnpm lint

# Build packages
pnpm build
```

### 4. Commit Your Changes

Write clear, descriptive commit messages:
```bash
git add .
git commit -m "feat: add keyboard shortcuts to dashboard"
```

**Commit Message Convention:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

### 5. Push and Create Pull Request

```bash
git push origin your-branch-name
```

Then open a Pull Request on GitHub with:
- Clear title describing the change
- Detailed description of what changed and why
- Link to related issues (if any)
- Screenshots (for UI changes)

## 🧪 Testing Guidelines

### Writing Tests

- Use Vitest for testing
- Place tests in `__tests__` directories or `*.test.ts` files
- Aim for high test coverage for new features
- Test edge cases and error conditions

Example test structure:
```typescript
import { describe, it, expect } from 'vitest';

describe('MyFeature', () => {
  it('should do something', () => {
    // Arrange
    const input = 'test';

    // Act
    const result = myFunction(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @understand-anything/core test

# Run tests in watch mode
pnpm --filter @understand-anything/core test --watch
```

## 📚 Code Style Guidelines

### TypeScript

- Use TypeScript strict mode
- Define explicit types for function parameters and return values
- Avoid `any` type - use `unknown` if type is truly unknown
- Use interfaces for object shapes
- Use type aliases for unions and complex types

### Formatting

- The project uses ESLint for code quality
- Consistent indentation (2 spaces)
- Use meaningful variable and function names
- Keep functions small and focused

### React/Dashboard

- Use functional components with hooks
- Keep components focused and single-purpose
- Use Zustand for state management
- Follow the existing component structure

### Tech Stack

TypeScript, pnpm workspaces, React 18, Vite, TailwindCSS v4, React Flow, Zustand, web-tree-sitter, Fuse.js, Zod, Dagre

### File Organization

```
understand-anything-plugin/
├── packages/
│   ├── core/              # Core analysis engine
│   │   ├── src/
│   │   └── package.json
│   └── dashboard/         # React dashboard
│       ├── src/
│       │   ├── components/
│       │   ├── utils/
│       │   └── store.ts
│       └── package.json
├── src/                   # Plugin skills implementation
├── agents/                # AI agent prompts
└── skills/                # Skill definitions
```

## 🌍 Translation Guidelines

### Adding a New Language

1. Create `README.{language-code}.md` (e.g., `README.fr-FR.md`)
2. Translate all sections while maintaining formatting
3. Update main `README.md` to include language link
4. Keep technical terms in English where appropriate
5. Ensure all links still work

Example:
```markdown
<a href="README.md">English</a> | <a href="README.fr-FR.md">Français</a>
```

## 🐛 Bug Reports

When reporting bugs, include:

- **Description**: Clear description of the issue
- **Steps to Reproduce**: Detailed steps to reproduce the bug
- **Expected Behavior**: What you expected to happen
- **Actual Behavior**: What actually happened
- **Environment**: OS, Node version, pnpm version
- **Screenshots**: If applicable
- **Error Messages**: Full error output

## 💡 Feature Requests

When requesting features:

- **Use Case**: Describe the problem you're trying to solve
- **Proposed Solution**: How you envision the feature working
- **Alternatives**: Other solutions you've considered
- **Additional Context**: Any other relevant information

## 📋 Pull Request Checklist

Before submitting a PR, ensure:

- [ ] Code follows the project's style guidelines
- [ ] All tests pass (`pnpm test`)
- [ ] New code has test coverage
- [ ] Documentation is updated (if needed)
- [ ] Commit messages follow convention
- [ ] PR description clearly explains changes
- [ ] No console.log or debug code left behind
- [ ] Branch is up to date with main

## 🤝 Code Review Process

1. **Automated Checks**: CI runs tests and linting
2. **Maintainer Review**: Project maintainers review the code
3. **Feedback**: Address any requested changes
4. **Approval**: Once approved, PR will be merged
5. **Cleanup**: Delete your branch after merge

## 📞 Getting Help

- **Issues**: For bugs and feature requests
- **Discussions**: For questions and general discussion
- **Documentation**: Check existing docs first

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🙏 Recognition

Contributors will be recognized in:
- GitHub contributors list
- Release notes (for significant contributions)
- Special mentions for exceptional contributions

---

**Thank you for contributing to Understand Anything! Your contributions help make code understanding accessible to everyone.** 🚀
