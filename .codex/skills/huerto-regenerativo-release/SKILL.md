---
name: huerto-regenerativo-release
description: Project release workflow for the Huerto Regenerativo SCORE app. Use after making code, data, UI, documentation, or configuration changes in this repository, especially when the user says changes must be pushed to GitHub and deployed to Vercel, or when finishing any implementation that should be visible at the public production URL.
---

# Huerto Regenerativo Release

## Workflow

Before finalizing project changes:

1. Inspect `git status --short --branch` and keep unrelated user changes intact.
2. Run `npm.cmd run build` on Windows PowerShell. If using another shell, run the equivalent `npm run build`.
3. Review the resulting diff for accidental secrets, generated folders, `.vercel/`, `node_modules/`, `.next/`, and database artifacts.
4. Commit the intended project changes with a concise Spanish commit message.
5. Push the current branch to GitHub. If no remote exists, configure or create the GitHub remote before attempting the push.
6. Deploy the same committed state to Vercel production with the linked project, preferring `vercel --prod --yes` or `npx vercel --prod --yes`.
7. Report the commit hash, GitHub push target, Vercel production URL, and verification result.

## Project Notes

- The Vercel project is linked locally as `huerto-regenerativo-score`.
- `.vercel/` is intentionally ignored and must not be committed.
- The public production page should always reflect the latest finished work.
- Use `npm.cmd` in PowerShell because `npm.ps1` may be blocked by the Windows execution policy.
- Keep bibliographic PDFs, SQLite databases, `node_modules/`, `.next/`, and Vercel local metadata out of commits unless the user explicitly asks otherwise.
