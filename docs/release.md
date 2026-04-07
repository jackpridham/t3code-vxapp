# Release Checklist

This repo now ships the web/server product only. There is no desktop
artifact pipeline in this checkout anymore.

## What the workflow does

- Trigger: push tag matching `v*.*.*`.
- Runs quality gates first: lint, typecheck, test.
- Publishes the CLI package (`apps/server`, npm package `t3`) with OIDC
  trusted publishing.
- Creates a GitHub Release for the tag.

## npm OIDC trusted publishing setup

The workflow publishes the CLI with `bun publish` from `apps/server`
after bumping the package version to the release tag version.

Checklist:

1. Confirm npm org/user owns package `t3`.
2. In npm package settings, configure Trusted Publisher:
   - Provider: GitHub Actions
   - Repository: this repo
   - Workflow file: `.github/workflows/release.yml`
3. Ensure npm account and org policies allow trusted publishing for the package.
4. Create release tag `vX.Y.Z` and push; workflow will:
   - set `apps/server/package.json` version to `X.Y.Z`
   - build web + server
   - run `bun publish --access public`

## Ongoing release checklist

1. Ensure `main` is green in CI.
2. Create release tag: `vX.Y.Z`.
3. Push tag.
4. Verify workflow steps:
   - preflight passes
   - CLI publish passes
   - GitHub Release is created for the tag

## Troubleshooting

- CLI publish fails:
  - Check npm trusted publishing settings for package `t3`.
- Version bump step fails:
  - Check `apps/server/package.json`, `apps/web/package.json`,
    `packages/contracts/package.json`, and `bun.lock` for unexpected edits.
