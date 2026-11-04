# Testing

Run the test commands from the repository root with dependencies installed.

`npm test` runs the Node unit tests, which use fakes for EmDash integrations, and the Astro
component render tests.

`npm run test:e2e` builds and serves the fixture site in `e2e/site/`. It checks that the site
builds and `/posts/hello` renders AVIF and WebP sources for its hero, image block, and gallery.
It requests each generated `/_image` URL and checks the image response and cache, verifies that a
denied storage key reaches the site's handler, then performs a write-mode media backfill and
checks that the page's image URLs are versioned and their variants are immutable. Warm-up must
generate variants once and serve them from cache, and cleanup must find nothing to delete in a
fresh cache.

The harness creates the fixture's SQLite database, upload files, and image cache under
`e2e/site/.data/` for each run. This is generated, disposable test data.

CI runs `npm run test:e2e` after `npm test`. The e2e command is separate from `npm test` and is not
part of `prepublishOnly`, which runs `npm test` and package release verification. A failure that
points into `src/` is a package bug.
