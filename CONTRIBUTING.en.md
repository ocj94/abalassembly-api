🇫🇷 [Version française](CONTRIBUTING.md)

# Contributing

An honest word first: this is essentially a solo-maintained project,
developed alongside [Abalassembly](https://github.com/ocj94/Abalassembly),
not a project with an established team of maintainers. Contributions are
welcome, but expect a personal review pace, not an organization's.

## Reporting a vulnerability

Not here — see [`SECURITY.md`](SECURITY.en.md), which points to the
repository's private form rather than a public issue.

## Getting started

Everything is in the [`README.md`](README.en.md): setup, environment
variables, running locally. Not duplicated here, to avoid two versions
drifting out of sync.

## Before proposing a change

**Run the test suite locally** (`npm test`) — requires a real PostgreSQL
and a real Redis, no mocks. A pull request whose tests don't pass against
real instances won't be merged even if it "looks like" it works.

**If you touch `src/engine.js`**: also run
`node scripts/check-engine-sync.js`. This script compares 13 critical
functions (geometry, move legality) between this file and Abalassembly's
client-side engine, and fails if they diverge. This isn't a formality —
it exists precisely because a gap between the two copies once caused a
real bug ("OPP_DIR", session of 2026-07-19) that wasn't discovered until
months later. It also runs automatically in CI on every push and pull
request; a divergence blocks the merge, not just a warning.

## Style and principles

This repository follows the same principles as Abalassembly: never state
anything without having verified it, never fabricate data or a result to
paper over a gap, document limitations honestly instead of staying silent
about them. The distributed Lab's README section is a concrete example of
this — its "what is NOT verified" part is as carefully written as the rest.

## What genuinely helps

- A fix accompanied by a test that failed before and passes after
- An issue describing a concrete gap between what the code does and what
  the documentation says, rather than a feature request for a backend that
  is deliberately staying dormant
