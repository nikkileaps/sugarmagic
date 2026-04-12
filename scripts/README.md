# `scripts`

Project automation scripts that support development, verification, and maintenance.

This directory is for repo-level automation, not canonical product logic.

`scripts/data-prep/` holds the offline generators that rebuild checked-in
language-data snapshots for the sugarlang plugin.

Verification loop:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm verify`
