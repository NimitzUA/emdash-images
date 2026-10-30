# Package repository handover

## Import source

Imported from the `liliiachaika.com` repository, plan 035 (`docs/plans/035-emdash-images-package.md`); the exact source commit is the one named in the new repository's first import commit message. The architect records the merge commit in plan Outcome after merge.

## ADR-0002 in brief

ADR-0002 was accepted on 2026-10-28. The package owns the reusable server side of the image pipeline: the Astro image service, the `/_image` guard wrapper, URL and `srcset` construction, warm-up, backfill, cleanup, and an EmDash native plugin descriptor. Each site keeps its own Astro markup and private-access rules. Options live in site code; the EmDash admin gets no image-pipeline settings.

The package was incubated in the site workspace so changes could share one commit, review, and end-to-end suite. After plan 035 merges, the package moves here in one signed import commit. The package repository is public and MIT licensed. The initial site dependency will use a git tag.

## Dated decisions and plan 034 behavior

- **2026-10-27 — cross-review and request behavior.** The two EmDash sites cross-reviewed their image pipelines. When a page or CDN copy asks for an old content-hash version after a media replacement, a temporary `302` redirects to the current `hash16`; this serves the replacement image instead of a broken or stale version. The redirect is `no-store`, so it cannot be cached as a permanent move, and the new hash URL receives the immutable image cache policy.
- **2026-10-27 — encode limit.** Sharp encodes use the `encodeLimit` option, which defaults to 2. AVIF encodes are CPU and memory heavy; the limit lets two distinct cold-cache requests proceed while keeping a deploy-time warm-up or crawler from exhausting a small production host. Single-flight still shares work for identical cache paths.
- **2026-10-27 — AVIF chroma.** T5 measured 1,027 variants: 4:2:0 saved 1.78% overall (25,310,108 bytes versus 25,767,644 bytes for 4:4:4) and encoded faster (2:04 versus 2:23). At 100% crops the results looked nearly identical, but 4:2:0 left a slight fringe on coloured text at an edge. The owner kept 4:4:4 to preserve that detail; the measured size saving was small.
- **2026-10-28 — package boundary.** The owner chose the public MIT repository `nimitzua/emdash-images`, package name `@nimitzua/emdash-images`, EmDash plugin id `emdash-images`, and version 0.1.0. The plugin uses the `content:afterPublish` hook and declares `content:read`. Options stay in code. The package does not ship markup, private cases, or the custom route used by facadesystems.

- **2026-10-30 — package-only scope.** The owner decided that this repository works on the package and its EmDash plugin only, without depending on any existing site. The facadesystems items below and open items 2 and 3 are out of scope; `docs/ROADMAP.md` carries the current list.

## Facadesystems cross-review notes

The ADR records that both sites had strengths the other lacked, but it does not name those implementation differences. The one documented structural difference is that facadesystems uses a custom image route instead of Astro's `/_image`. Its route contract and the specific pipeline strengths from the cross-review are **to confirm with the facadesystems architect**; do not infer them from this site's plan 034 changes.

## Open items

1. Build the package `Picture` component on `pictureSources`, with both sites' markup in view.
2. Design support for facadesystems' custom image route.
3. Migrate facadesystems to this package.
4. Choose and document a version and release process.
5. Add CI for this repository.

## History retained in the site repository

- Plan 004 — Images: `docs/plans/004-images.md`
- Plan 016 — Media pipeline: `docs/plans/016-media-pipeline.md`
- Plan 025 — Image pipeline fixes: `docs/plans/025-image-pipeline-fixes.md`
- Plan 034 — Image pipeline hardening: `docs/plans/034-image-pipeline-hardening.md`
- Plan 035 — Image pipeline package: `docs/plans/035-emdash-images-package.md`
