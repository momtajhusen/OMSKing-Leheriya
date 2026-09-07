# GitHub Branch & Commit Strategy — OMSKing

## 1. Branches

```
main (protected, GitHub)
  ▲
  │ only via PR from develop + Phase release tags
  │
develop (default branch, GitHub)
  ▲
  │ PRs from feature/*, hotfix/*
  │
  ├── feature/phase-2-auth-rbac
  ├── feature/phase-3-products-sku
  ├── feature/bulk-awb-upload
  │
hotfix/* (off main, merged into both develop + main)
  └── hotfix/invoice-sequence-gap-20250917
```

### Rules

- **`main` = production-ready code.** Never push directly. Protected: 1 reviewer approval + status checks pass.
- **`develop` = integration branch.** All features target this. Merge to `main` only when a phase is complete and signed off.
- **`feature/<short-description>`** = branched off `develop`, PR back into `develop`.
- **`hotfix/<description>-<date>`** = branched off `main` for urgent live issues, PR opened in parallel to `main` AND `develop` (cherry-pick or double-merge so fix isn't lost).
- **Phase 0 commit is the first commit.** It has no parent feature branch — it lands directly on `develop` → tagged `v0.1.0` → merged to `main` as the empty-skeleton baseline.

---

## 2. Branch Naming

Pattern: `feature/<kebab-case-slug>`
- Good: `feature/phase-2-auth-rbac`, `feature/order-status-optimization`, `feature/delhivery-courier-api`
- Bad: `phase2`, `mybranch`, `fix-stuff`, `john-branch`

Pattern for fixes that are mid-feature: include issue or order number if relevant:
- `hotfix/rto-status-calculation-20250917`

---

## 3. Commit Messages — Conventional Commits

Format:
```
<type>(<optional-scope>): <subject in imperative mood, lower-case, max 72 chars>

<BLANK LINE>

<optional longer body, wrapped at 72 chars, explaining WHY not WHAT.>
Wrap at 72 cols. Use bullets if needed.

Refs: #<issue-number>
BREAKING CHANGE: <what breaks + migration path>  (only if applicable)
```

### Types

| Type | When |
|------|------|
| `feat` | New user-facing feature / module / API endpoint. Increment MINOR version. |
| `fix` | Bug fix — runtime bug, route fix, security fix. Increment PATCH version. |
| `refactor` | Behavior-preserving code change (rename, extract fn, move file, simplify). |
| `perf` | Performance optimization (faster query, better index, reduced memory). |
| `docs` | Docs only: README, docs/*.md, code comments. |
| `chore` | Build/release/tooling changes: bump deps, add turbo task, edit .github/ workflows, format code. |
| `style` | Formatting only: indentation, semicolons, import order. No logic change. |
| `test` | Adding/updating tests. Not used before Phase 1 of a module typically. |
| `revert` | `git revert` of a prior commit. Include the sha reverted. |

### Scopes (optional, recommended)

Match the module names: `feat(orders): …`, `fix(inventory): …`, `refactor(rbac): …`, `docs(api): …`, `chore(turbo): …`

### Subject Rules

- Imperative mood: `feat(orders): add csv export for orders` ✓ (NOT `added` / `adds`)
- No trailing period
- Max 72 chars
- Lower-case after the `:`

### Examples

```
feat: phase 0 - architecture and foundation setup

feat(auth): implement login endpoint with access+refresh tokens
fix(orders): prevent duplicate channelOrderId across tenants by scoping unique index
refactor(inventory): extract double-entry ledger book() into a service
perf(order-list): add compound index on (tenantId, status, orderDate)
docs(readme): add production deployment checklist
chore(deps): bump mongoose to 8.5
```

### Phase 0 commit

Exactly one squash commit on develop:
```
feat: phase 0 - architecture and foundation setup
```

---

## 4. Pull Request Workflow

1. Open a **draft PR** from `feature/…` → `develop` **early** (so CI runs and reviewers can see progress).
2. Fill the PR description template:
   - **What changed** (summary)
   - **Why** (user story / ticket reference)
   - **Screenshots / Postman runs** for UI or API changes
   - **Risk areas** (what a reviewer must double-check)
   - **Checklist:**
     - [ ] I have read the RBAC doc and all new routes have permission middleware
     - [ ] All new queries are scoped by tenantId (no cross-tenant leak)
     - [ ] All docs in docs/ are updated if conventions changed
     - [ ] Commits follow Conventional Commits
3. Squash-merge into develop after 1 approval. Keep the squash commit subject following the conventional commit format.
4. **Do NOT rebase / squash other people's feature branches** without coordination.

---

## 5. Tagging & Releases

- Phase 0 complete → `git tag v0.1.0` on `main` (architecture baseline).
- Each Phase end → bump MINOR. Phase 1 done = `v0.2.0`, Phase 2 = `v0.3.0`, … Phase 12 = `v0.13.0`.
- Go-live → `v1.0.0`.
- Hotfix on live → PATCH. `v1.0.1`, `v1.0.2`.

Semantic Versioning **after v1.0.0**:
- MAJOR = breaking API changes
- MINOR = new feature, backward-compatible
- PATCH = bug fix, backward-compatible

---

## 6. GitHub Repo Setup Checklist (Day 1)

- [ ] Private repo: `codersalpha/omsking` (or the Leheriya org)
- [ ] `develop` as default branch
- [ ] Branch protection rules:
  - **main:** require PR, 1 approval, status checks pass, no direct push
  - **develop:** require PR, 1 approval (can be self for solo mode while team is small — but NEVER direct push)
- [ ] Protected tags: `v*`
- [ ] `.github/CODEOWNERS` → you (the owner) + tech lead for everything under `apps/backend/src/routes/v1/auth`, `docs/03-MULTI-TENANCY.md`, `docs/04-RBAC-BLUEPRINT.md` (security-sensitive files)
- [ ] GitHub Actions for CI (Phase 1+):
  - On PR: `pnpm install`, `pnpm turbo run build lint`
  - On push to `main`: deploy backend → Railway/Render/Ec2; deploy admin → Vercel/Netlify/S3 (deferred to Phase 12)
- [ ] Dependabot configured: weekly PRs for minor/patch, immediate for security (review, don't auto-merge).
