# Contributing to Connect

Thanks for helping. Issues and pull requests are welcome.

## Getting set up
```bash
npm install
npm run dev:all      # embedded Postgres, migrations, seed, http://localhost:3000
```
See "Fork it in under an hour" in the [README](README.md) for details.

## Before you open a pull request
Run the same checks CI runs (`.github/workflows/ci.yml`):
```bash
npm run typecheck
npm run lint
npm test
npm run db:check     # only if you changed prisma/schema.prisma
npm run build
```

## Guidelines
- Keep pull requests small and focused, with a short description of what changed and why.
- Add or update tests in `tests/` for behaviour changes.
- Every user-facing string goes in `src/lib/i18n.ts` in both English and Spanish (a test checks parity).
- Schema changes: edit `prisma/schema.prisma`, then `npm run db:migrate -- --name <change>` and commit the new migration.
- Seed data: real organizations get public facts only (`prisma/seed-data.ts`); demo people must stay fictional and flagged `isDemo`.
- Never commit secrets, `.env` files or local data (`.data/`). Only `.env.example`, with empty values, belongs in git.
- Security problems: please do not open a public issue; see [SECURITY.md](SECURITY.md).

## Licensing your contribution
This project is **dual licensed**: AGPL-3.0 for everyone, plus a commercial license EmpowerTours can sell to anyone unwilling to meet AGPL section 13 (see [NOTICE](NOTICE)). That only works while EmpowerTours holds copyright in the whole work.

So **by submitting a contribution you agree that**:

1. Your contribution is published under AGPL-3.0, like everything else.
2. You grant EmpowerTours S.A.S. de C.V. a perpetual, worldwide, non-exclusive, royalty-free right to license your contribution under other terms, including commercial ones.
3. You keep your copyright. You are not assigning it to us. Your name stays on the commit and the work stays yours.

If that does not sit right with you, say so before sending code and we will talk about it. It is far better to settle it beforehand than after.
