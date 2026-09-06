# Upstream engineering skills snapshot

- Source: `https://github.com/mattpocock/skills`
- Installer: `skills@1.5.23`
- Target requested: Codex, project scope, copy mode
- Upstream HEAD observed during installation on 2026-09-06:
  `3cca18b368ae95cdbdebbff572ccafa662551015`
- Upstream baseline hashes recorded by the installer: `skills-lock.json`

`skills-lock.json` version 1 does not pin a Git ref, and its hashes describe the
downloaded upstream baseline before YO_crm adaptations. Treat the observed
commit and lock as review evidence, not as an exact restore guarantee. Exact
restoration comes from the repository revision that versions `.agents/skills/`.
For an update or reinstall, compare the new upstream diff and computed hashes
before accepting it. Keep the six `yoleotard-*` directories outside the
upstream lock.

The copied upstream files are intentionally adapted for YO_crm where generic
behavior conflicted with project contracts: `ask-matt`, `code-review`,
`domain-modeling`, `implement`, `improve-codebase-architecture`, `prototype`,
`resolving-merge-conflicts`, `setup-matt-pocock-skills`, `to-spec`,
`to-tickets`, `triage`, `wayfinder` and `wizard`. The adaptations
prevent automatic commits or broad staging, support worktree review, use Codex
invocation syntax, keep ADRs in `docs/decisions/`, and preserve the five project
review roles. These exact adapted files are part of the normal Git snapshot;
after an upstream update, inspect each listed directory and reapply or
consciously revise its repository diff before accepting the update.
