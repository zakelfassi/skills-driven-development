---
name: component-scaffold
description: Create a new React component with co-located test, story, and styles. Use when creating new UI components, when asked to scaffold/generate a component, or when building new pages.
metadata:
  forged-by: claude-agent
  forged-from: session-2026-02-15
  forged-reason: "Scaffolded 4 components in one session — same file structure each time"
  usage-count: "18"
  last-used: "2026-02-27"
---

# Component Scaffold

Create a new React component following project conventions.

## Inputs
- Component name (PascalCase, e.g., `UserCard`)
- Component type: `page` | `feature` | `ui`
- Props (optional: list of prop names + types)

## Steps

1. **Determine the directory**
   - `page` → `src/pages/{ComponentName}/`
   - `feature` → `src/features/{feature-area}/components/{ComponentName}/`
   - `ui` → `src/components/ui/{ComponentName}/`

2. **Create the component file**
   ```
   {dir}/{ComponentName}.tsx
   ```
   - Functional component with TypeScript props interface
   - Export as named export (not default)

3. **Create the test file**
   ```
   {dir}/{ComponentName}.test.tsx
   ```
   - Import from Vitest + Testing Library
   - At minimum: renders without crashing + snapshot

4. **Create the story file**
   ```
   {dir}/{ComponentName}.stories.tsx
   ```
   - Default story + one variant per significant prop

5. **Create the barrel export**
   ```
   {dir}/index.ts
   ```
   - Re-export the component

## Conventions
- All components are functional (no class components)
- Props interfaces are named `{ComponentName}Props`
- Co-locate everything: component, test, story, styles in one directory
- Use Tailwind for styling (no CSS modules — see archived skill `css-module-setup`)

## Edge Cases
- **Component already exists:** Do not overwrite. Ask the user if they want to update or rename.
- **Nested feature components:** Use the feature area as a parent directory (e.g., `features/auth/components/LoginForm/`)
