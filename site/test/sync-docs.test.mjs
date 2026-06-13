// Unit tests for site/scripts/sync-docs.mjs link-rewriting logic.
// Run with: node --test site/test/sync-docs.test.mjs

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { rewriteMdLinkTarget, rewriteRelativeLinks } from "../scripts/sync-docs.mjs";

describe("rewriteMdLinkTarget", () => {
  it("rewrites a simple repo-relative path", () => {
    assert.equal(rewriteMdLinkTarget("foo"), "foo/");
  });

  it("rewrites a relative path with leading ./", () => {
    assert.equal(rewriteMdLinkTarget("./foo"), "./foo/");
  });

  it("rewrites a nested relative path", () => {
    assert.equal(rewriteMdLinkTarget("../docs/bar"), "../docs/bar/");
  });

  it("preserves hash fragment in rewritten link", () => {
    assert.equal(rewriteMdLinkTarget("foo", "#section"), "foo/#section");
  });

  it("returns null for https:// URLs", () => {
    assert.equal(rewriteMdLinkTarget("https://example.com/specification"), null);
  });

  it("returns null for http:// URLs", () => {
    assert.equal(rewriteMdLinkTarget("http://example.com/spec"), null);
  });

  it("returns null for mailto: URLs", () => {
    assert.equal(rewriteMdLinkTarget("mailto:user@example.com"), null);
  });

  it("returns null for protocol-relative URLs (//)", () => {
    assert.equal(rewriteMdLinkTarget("//example.com/doc"), null);
  });

  it("returns null for ftp:// URLs", () => {
    assert.equal(rewriteMdLinkTarget("ftp://example.com/file"), null);
  });

  it("returns null for root-absolute paths (/foo.md)", () => {
    assert.equal(rewriteMdLinkTarget("/foo"), null);
  });

  it("returns null for root-absolute nested paths (/docs/bar.md)", () => {
    assert.equal(rewriteMdLinkTarget("/docs/bar"), null);
  });

  it("still rewrites a relative path without leading dot (foo.md)", () => {
    assert.equal(rewriteMdLinkTarget("foo"), "foo/");
  });

  it("still rewrites a relative path with leading dot (./foo.md)", () => {
    assert.equal(rewriteMdLinkTarget("./foo"), "./foo/");
  });
});

describe("rewriteRelativeLinks", () => {
  it("rewrites a repo-relative .md link to a slug", () => {
    const body = "See [foo](./foo.md) for details.";
    assert.equal(rewriteRelativeLinks(body), "See [foo](./foo/) for details.");
  });

  it("rewrites a .md link with a hash fragment", () => {
    const body = "See [section](./docs/bar.md#heading).";
    assert.equal(rewriteRelativeLinks(body), "See [section](./docs/bar/#heading).");
  });

  it("leaves an https:// .md link verbatim", () => {
    const body = "See [spec](https://agentskills.io/specification.md) here.";
    assert.equal(rewriteRelativeLinks(body), body);
  });

  it("leaves an http:// .md link verbatim", () => {
    const body = "Refer to [old](http://example.com/old-doc.md).";
    assert.equal(rewriteRelativeLinks(body), body);
  });

  it("leaves a protocol-relative .md link verbatim", () => {
    const body = "Check [here](//cdn.example.com/readme.md).";
    assert.equal(rewriteRelativeLinks(body), body);
  });

  it("rewrites multiple relative links in a single body", () => {
    const body = "See [a](a.md) and [b](b.md).";
    assert.equal(rewriteRelativeLinks(body), "See [a](a/) and [b](b/).");
  });

  it("rewrites relative links but leaves external links untouched in same body", () => {
    const body =
      "Local: [a](./a.md). External: [spec](https://agentskills.io/spec.md).";
    assert.equal(
      rewriteRelativeLinks(body),
      "Local: [a](./a/). External: [spec](https://agentskills.io/spec.md).",
    );
  });

  it("does not rewrite non-.md links", () => {
    const body = "See [image](./foo.png) and [site](https://example.com).";
    assert.equal(rewriteRelativeLinks(body), body);
  });

  it("leaves a root-absolute .md link verbatim", () => {
    const body = "See [page](/foo.md) here.";
    assert.equal(rewriteRelativeLinks(body), body);
  });

  it("leaves a root-absolute nested .md link verbatim", () => {
    const body = "Read [docs](/docs/bar.md) for details.";
    assert.equal(rewriteRelativeLinks(body), body);
  });

  it("rewrites relative links but leaves root-absolute links untouched in same body", () => {
    const body = "Local: [a](./a.md). Root: [b](/b.md).";
    assert.equal(rewriteRelativeLinks(body), "Local: [a](./a/). Root: [b](/b.md).");
  });
});
