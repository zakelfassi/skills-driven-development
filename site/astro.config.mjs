// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Deployed to GitHub Pages under the repo name by default.
// If a custom domain is set up later, swap `site` + `base` accordingly.
export default defineConfig({
  site: "https://zakelfassi.github.io",
  base: "/skills-driven-development",
  integrations: [
    starlight({
      title: "Skills-Driven Development",
      description:
        "A methodology where AI agents create, evolve, and share reusable skills as a byproduct of their work. Spec-aligned with agentskills.io/v1.",
      logo: {
        src: "./src/assets/logo.svg",
        alt: "SkDD logo",
      },
      social: {
        github: "https://github.com/zakelfassi/skills-driven-development",
      },
      editLink: {
        baseUrl:
          "https://github.com/zakelfassi/skills-driven-development/edit/main/site/",
      },
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Why SkDD?", link: "/why-skdd/" },
            { label: "Configuration", link: "/configuration/" },
            { label: "Skill colony concept", link: "/skill-colony/" },
            { label: "Forging skills", link: "/forging-skills/" },
            { label: "Specification alignment", link: "/specification-alignment/" },
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
          ],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
