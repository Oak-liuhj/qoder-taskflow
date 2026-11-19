# Source import

Imported on 2026-11-19 from `https://github.com/Oak-liuhj/dsh-taskflow.git`.

- Source branch: `codex/qoder-marketplace`.
- Source base commit: `862b118fde0d851d84f091d8d1ada7194500ef96`.
- Import includes the source branch's staged Qoder adaptation changes, not just the base commit.
- All 119 tracked source files were copied or verified byte-for-byte before the repository documentation adjustments below. The destination's identical Apache-2.0 LICENSE and initial Git history were preserved.
- The original working tree and index remain untouched. Git history, dependencies, `.local` investigation files, user data, credentials and generated `dist` artifacts are not part of this import.

The root READMEs add a Qoder entry section while retaining upstream documentation. The Qoder README distinguishes GitHub source delivery from marketplace publication. Shared source, package name and DSH checks remain available to preserve the imported build and regression coverage.

Build the Qoder package with `npm ci --ignore-scripts` followed by `npm run build:qoder`. See `qoder/README.md` for installation and current host limitations. Earlier acceptance records describe their original runs; they do not establish new host features or marketplace publication.

Validation in this destination checkout: `npm run check` passed all 89 tests and 12 host version boundary checks; `npm run check:package` passed production package installation and the packed AgentLoop fixture; `npm run check:hosts` passed exact host baselines 0.2.1-rc.3, 0.2.2-rc.2 and 0.2.2-rc.3. Qoder tests build the plugin ZIP as part of the suite. These automated checks do not expand the documented real-host acceptance scope.
