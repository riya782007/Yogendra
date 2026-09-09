# Why features kept disappearing after a deploy — and how that is now prevented

Owners repeatedly reported that features which worked before a deployment were gone afterwards,
and had to be restored by hand. This is not bad luck: 37 of this repo's commits (and 22 of
aggarwal-jwellers') are "restore …" or "revert …" work. Three concrete mechanisms caused it. Two are now
blocked automatically; the third needs one habit change from whoever clicks deploy.

---

## Mechanism 1 — an edit replaced a whole file with a stub  *(now blocked by CI)*

The worst one, and the most common. An agent asked to change part of a large file wrote out a
**placeholder instead of the real file**.

It really happened. In this repo, commit `fe924b0` gutted four files at once — `lib/content.ts` (-407), `lib/ai/listingAgent.ts` (-313), `app/(admin)/admin/catalogue/page.tsx` (-164) and `app/actions/fixNath.ts` (-125) — and `3e79a82` took 857 lines out of `app/actions/billing.ts`. There is even a commit titled *"fix: restore full billing.ts after accidental corruption"*. In the sibling repo, `lib/supabase/queries.ts` landed on `main` as the single word `PLACEHOLDER`, 1,969 lines deleted, and deployed.

Across this repo and Yogendra there are **13 commits where a source file was replaced by two
lines or fewer**, each followed days later by a `fix: restore …` commit once an owner noticed.
Look for the tell-tale shape in `git log --numstat`: `-1969/+1`, `-857/+1`, `-407/+1`.

Nothing caught these because **nothing ran before a merge**. There was no CI at all.

**Now:** `.github/workflows/ci.yml` runs typecheck, tests and a production build on every pull
request and every push to `main`. A truncated file fails `tsc` in seconds. On top of that,
`tests/no-regressions.test.ts` fails if any tracked file disappears or loses more than 60% of its
lines, and it names the feature that broke. Verified against a real incident: gutting
`lib/content.base.ts` the way `fe924b0` did trips six separate checks.

Note: the full test suite here has 7 failures that predate this workflow, so CI blocks on
typecheck, the regression guard and the production build, and reports the rest without blocking.
Fix those 7 and remove the `continue-on-error` line in `.github/workflows/ci.yml` to make the
whole suite a gate.

If you delete or shrink a file **on purpose**, that is fine — run:

```bash
node scripts/feature-manifest.mjs
git add tests/feature-manifest.json
```

and commit it. The deletion then appears in the diff as a deliberate act instead of a silent loss.

---

## Mechanism 2 — production was running a branch, not `main`  *(needs your habit change)*

This is the one that most looks like "the feature came back and then vanished again".

In Vercel you can **Promote to Production** any preview build. That makes production serve a
*branch*. `main` never receives those commits. The moment anything else merges to `main`, Vercel
deploys `main` — and every fix that only existed on the promoted branch silently disappears.

Both projects are in exactly this state as of 9 Sep 2026:

| Project | Production is running | `main` is at | Risk |
|---|---|---|---|
| aggarwal-jwellers | `vercel-agent/qr-quiet-zone-print-safety` (PR #36) | `c756812` | PR #35 + #36 vanish on the next `main` deploy |
| Yogendra | `cursor/trade-filter-facets-e1b2` (PR #70) | `fc61aa4` | PR #70 (+ #71) vanish on the next `main` deploy |

**The rule: never use "Promote to Production" as the way to ship.** Merge the PR into `main` and
let Vercel deploy `main`. Promote is only for an emergency rollback to a known-good build.

---

## Mechanism 3 — good work stranded on branches that were never merged

There are **33 branches with commits absent from `main`** across the two repos. Some are
superseded and harmless; some contain the only copy of a fix. When someone later "restores" a
feature by hand, they are usually re-implementing work that already exists on a forgotten branch.

Merge it or delete it. A branch that is neither is a feature waiting to be lost.

---

## After every deployment — a 60-second check

1. **Confirm production is `main`.**
   Vercel → the project → **Deployments** → the one badged *Production*. Its **Source** must read
   `main`. If it shows a branch name, production has diverged: merge that branch's PR into `main`.

2. **Confirm `main` contains what production is serving.** With the commit SHA shown in Vercel:

   ```bash
   git fetch origin
   git branch -r --contains <sha> | grep -q 'origin/main' \
     && echo "OK: main contains production" \
     || echo "DIVERGED: production has commits main does not"
   ```

3. **Confirm nothing was gutted.**

   ```bash
   npm ci && npx tsc --noEmit && npm test
   ```

   `tests/no-regressions.test.ts` names any feature that went missing.

4. **Spot-check the three things owners notice first:** POS scan of a real sticker, printing a
   label from *QR & Barcode Labels*, and the storefront search box on a phone.

---

## If a feature has already gone missing

Find when it disappeared, rather than rewriting it from scratch:

```bash
# every commit that touched the file, newest first
git log --oneline --numstat -- path/to/file.ts | head -40

# commits that gutted a file (the -1969/+1 shape)
git log --format='%h %ad %s' --date=short --numstat -- '*.ts' '*.tsx' | \
  awk '/^[0-9]/ { if (($2+0)-($1+0) > 60) print }'

# recover the last good version of one file, without touching anything else
git checkout <good-sha> -- path/to/file.ts
```

Then check whether the work already exists on a branch before rewriting it:

```bash
git log --all --oneline --source -S'someFunctionName' -- path/to/file.ts
```

---

## Recommended one-off settings

- **Branch protection on `main`** (GitHub → Settings → Branches): require the `verify` check to
  pass before merging. This turns CI from advisory into a gate.
- **Delete branches on merge**, so the stranded-branch pile stops growing.
- Keep `tests/no-regressions.test.ts` growing: every time an owner reports a feature lost, add a
  line to its `CONTRACTS` list. That single line stops it ever going missing unnoticed again.
