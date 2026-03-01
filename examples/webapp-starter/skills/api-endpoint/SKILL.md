---
name: api-endpoint
description: Scaffold a REST API endpoint with route, controller, validation, and tests. Use when creating new API endpoints, adding resources, or when asked to build a new backend route.
metadata:
  forged-by: codex-agent
  forged-from: session-2026-02-18
  forged-reason: "Third endpoint scaffolded with identical structure — time to encode the pattern"
  usage-count: "9"
  last-used: "2026-02-26"
---

# API Endpoint Scaffold

Create a new REST API endpoint following project conventions.

## Inputs
- Entity name (singular, e.g., `comment`)
- Fields (name:type pairs, e.g., `body:string, author_id:number`)
- Auth required? (boolean, defaults to `true`)
- Nested under? (optional parent entity, e.g., `post`)

## Steps

1. **Create the route file**
   ```
   src/routes/{entity}.routes.ts
   ```
   - Define CRUD routes: `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`
   - If nested: `GET /{parent}s/:parentId/{entity}s`

2. **Create the controller**
   ```
   src/controllers/{entity}.controller.ts
   ```
   - One method per route
   - All responses use `{ data, error, meta }` shape
   - Handle not-found with 404, validation with 422

3. **Create the validation schema**
   ```
   src/validators/{entity}.validator.ts
   ```
   - Use Zod schemas matching the field definitions
   - Separate schemas for create vs. update (update = partial)

4. **Create the test file**
   ```
   tests/api/{entity}.test.ts
   ```
   - Test each CRUD operation
   - Test validation (bad input returns 422)
   - Test auth (if required: 401 without token)
   - Use test factories for fixtures

5. **Register the route**
   ```
   src/routes/index.ts
   ```
   - Add import + `app.use('/{entity}s', {entity}Routes)`
   - If auth required: add auth middleware

## Conventions
- Route paths are plural (`/comments`, not `/comment`)
- File names are singular (`comment.routes.ts`)
- All endpoints return `{ data, error, meta }`
- `meta` includes pagination for list endpoints
- Auth middleware is applied at the route level, not controller level

## Edge Cases
- **File upload endpoints:** Add `multer` middleware, accept `multipart/form-data`
- **Nested routes:** Parent ID is validated in middleware (404 if parent doesn't exist)
- **Soft delete:** `DELETE` sets `deleted_at` timestamp, doesn't remove the row
