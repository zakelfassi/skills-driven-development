// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import rehypeMermaid from "rehype-mermaid";

// Deployed to GitHub Pages under the repo name by default.
// If a custom domain is set up later, swap `site` + `base` accordingly.
export default defineConfig({
  site: "https://zakelfassi.github.io",
  base: "/skills-driven-development",
  markdown: {
    // Render ```mermaid fenced code blocks to inline SVG at build time.
    // `img-svg` emits SVG so the site works without client-side JS.
    rehypePlugins: [[rehypeMermaid, { strategy: "img-svg" }]],
  },
  integrations: [
    starlight({
      title: "Skills-Driven Development",
      description:
        "A methodology where AI agents create, evolve, and share reusable skills as a byproduct of their work. Spec-aligned with agentskills.io/v1.",
      favicon: "/favicon.svg",
      head: [
        // PNG favicon fallback for browsers that don't support SVG favicons
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: "/skills-driven-development/favicon-32.png",
            type: "image/png",
            sizes: "32x32",
          },
        },
        // Apple touch icon
        {
          tag: "link",
          attrs: {
            rel: "apple-touch-icon",
            href: "/skills-driven-development/apple-touch-icon.png",
          },
        },
        // Open Graph image
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content:
              "https://zakelfassi.github.io/skills-driven-development/og-image.png",
          },
        },
        // Twitter card
        {
          tag: "meta",
          attrs: {
            name: "twitter:card",
            content: "summary_large_image",
          },
        },
      ],
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/mark.svg",
        alt: "SkDD logo",
        replacesTitle: false,
      },
      social: {
        github: "https://github.com/zakelfassi/skills-driven-development",
      },
      editLink: {
        // This baseUrl is required for Starlight to enable edit links at all,
        // but our custom components/EditLink.astro override rewrites the href
        // to point at the canonical source under docs/ or colony/ instead of
        // the generated copy under site/src/content/docs/.
        baseUrl:
          "https://github.com/zakelfassi/skills-driven-development/edit/main/site/",
      },
      components: {
        EditLink: "./src/components/EditLink.astro",
      },
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Why SkDD?", link: "/why-skdd/" },
            { label: "Examples gallery", link: "/examples/" },
            { label: "Configuration", link: "/configuration/" },
            { label: "Skill colony concept", link: "/skill-colony/" },
            { label: "Forging skills", link: "/forging-skills/" },
            { label: "Specification alignment", link: "/specification-alignment/" },
          ],
        },
        {
          label: "Hub & global",
          items: [
            { label: "Global colony", link: "/global-colony/" },
            { label: "MCP sync", link: "/mcp-sync/" },
          ],
        },
        {
          label: "Colony lifecycle",
          items: [
            { label: "Discovery", link: "/colony/discovery/" },
            { label: "Evolution", link: "/colony/evolution/" },
          ],
        },
        {
          label: "Harness integrations",
          autogenerate: { directory: "integrations" },
        },
        {
          label: "Specs & manifests",
          items: [
            { label: "Colony v1 schema", link: "/spec/colony-v1/" },
            { label: "Agent Skills v1 snapshot", link: "/spec/agent-skills-v1/" },
            { label: "SchemaStore submission", link: "/schemastore-submission/" },
            { label: "Changelog", link: "/changelog/" },
          ],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
