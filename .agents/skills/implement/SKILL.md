---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use `tdd` where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use `code-review` to review the work. In YO_crm this is supplemental
to the mandatory roles in `.agents/README.md`.

Prepare a complete reviewable diff. Commit only when the current user request
explicitly authorizes it; otherwise report the uncommitted result.
