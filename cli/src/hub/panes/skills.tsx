import { Box, Text } from "ink";
import type { SkillRow } from "../state.js";

interface SkillsPaneProps {
  projectSkills: SkillRow[];
  globalSkills: SkillRow[];
  selectedIndex: number;
  /** Set when a project or global .skills-registry.json could not be loaded. */
  registryError?: string;
}

export function SkillsPane({
  projectSkills,
  globalSkills,
  selectedIndex,
  registryError,
}: SkillsPaneProps) {
  const allSkills = [...projectSkills, ...globalSkills];

  if (registryError) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red" bold>
          Registry error: {registryError}
        </Text>
        <Text color="gray">Fix the malformed .skills-registry.json and press Tab to refresh.</Text>
      </Box>
    );
  }

  if (allSkills.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="yellow">{"No skills found. Run `skdd forge <name>` to create one."}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>
          {projectSkills.length} project · {globalSkills.length} global
        </Text>
      </Box>
      {allSkills.map((skill, i) => (
        <Box key={`${skill.scope}-${skill.name}`}>
          <Text color={i === selectedIndex ? "cyan" : undefined}>
            {i === selectedIndex ? "▶ " : "  "}
          </Text>
          <Text color={skill.scope === "global" ? "magenta" : "green"}>
            {skill.scope === "global" ? "G" : "P"}
          </Text>
          <Text> </Text>
          <Text bold={i === selectedIndex}>{skill.name}</Text>
          <Text color="gray"> — {skill.description}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="gray">↑↓ navigate · P=project G=global</Text>
      </Box>
    </Box>
  );
}
