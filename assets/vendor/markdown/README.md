# Markdown browser dependencies

- marked 15.0.12: `marked.js`, MIT, see `marked-LICENSE.md`.
- DOMPurify 3.3.3: `purify.js`, Apache-2.0 OR MPL-2.0, see `dompurify-LICENSE`.

Copied from the versioned npm packages on the Instabox development machine. No build step or CDN request is required. `js/emc-markdown.js` applies an explicit tag/attribute allowlist before inserting HTML.
