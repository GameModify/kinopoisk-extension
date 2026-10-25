# Project map

- Product behavior, installation and developer checks: [README.md](README.md).
- Distributable userscript: [kinopoisk-kinokino.user.js](kinopoisk-kinokino.user.js).
- URL and navigation regression checks: [tests/userscript.test.cjs](tests/userscript.test.cjs).
- Local quality gate: [scripts/verify.cjs](scripts/verify.cjs); CI runs the same gate.
- Work items and unresolved acceptance: GitHub Issues in this repository.

## Applicable workflow

Load only the relevant complete source from [AI Agent Workflow](https://github.com/ArthurKoba/ai-agent-workflow):

- Implementation: [Implementer](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/roles/IMPLEMENTER.md).
- UI: [frontend engineering](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/frontend-engineering/README.md).
- Toolchain and hooks: [project bootstrap](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/project-bootstrap.md).
- Publication: [Git workflow](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/git-workflow.md).
- Independent review: [code review](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/code-review.md).

The installed artifact is plain JavaScript; keep it directly usable in Tampermonkey. Preserve the existing Node/npm toolchain unless migration is explicitly requested. Real browser/Tampermonkey acceptance is separate from the Node DOM harness.
