# Colony

> How skills grow from project-local patterns into shared, evolving capabilities.

## Contents

- [Discovery](discovery.md) — How agents find the right skill for the task
- [Evolution](evolution.md) — How skills improve through use
- [../docs/skill-colony.md](../docs/skill-colony.md) — The full skill colony concept

## The Colony in One Diagram

```
                    ┌─────────────┐
                    │  Agent works │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Pattern      │
                    │ recognized?  │
                    └──────┬──────┘
                     yes   │   no
              ┌────────────┤   └──→ continue working
              │            │
       ┌──────▼──────┐  ┌─▼──────────┐
       │ Skill exists?│  │ Forge new  │
       └──────┬──────┘  │ skill      │
        yes   │   no    └─────┬──────┘
              │               │
       ┌──────▼──────┐  ┌────▼───────┐
       │ Use skill   │  │ Register   │
       │ (update if  │  │ in colony  │
       │ edge case)  │  └────────────┘
       └─────────────┘
```

## Getting Started

1. Copy `skillforge/SKILL.md` into your project
2. Create `.skills-registry.md` (empty table)
3. Work normally — forge skills when patterns emerge
4. Review the registry periodically (weekly or monthly)
