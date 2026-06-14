import { Box, Text } from "ink";
import type { DoctorCheck } from "../../commands/doctor.js";

interface DoctorPaneProps {
  checks: DoctorCheck[];
  loading?: boolean;
  actionMessage?: string;
}

const STATUS_ICON: Record<DoctorCheck["status"], string> = {
  ok: "✓",
  warn: "!",
  error: "✗",
};

const STATUS_COLOR: Record<DoctorCheck["status"], string> = {
  ok: "green",
  warn: "yellow",
  error: "red",
};

export function DoctorPane({ checks, loading, actionMessage }: DoctorPaneProps) {
  if (loading) {
    return (
      <Box paddingX={1}>
        <Text color="cyan">Running checks…</Text>
      </Box>
    );
  }

  if (checks.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color="gray">No checks yet. Press r to run doctor.</Text>
      </Box>
    );
  }

  const sections: string[] = [];
  for (const c of checks) {
    if (!sections.includes(c.section)) sections.push(c.section);
  }

  const oks = checks.filter((c) => c.status === "ok").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const errors = checks.filter((c) => c.status === "error").length;

  return (
    <Box flexDirection="column" paddingX={1}>
      {sections.map((section) => (
        <Box key={section} flexDirection="column">
          <Text bold>{section}</Text>
          {checks
            .filter((c) => c.section === section)
            .map((c) => {
              const color = STATUS_COLOR[c.status] as Parameters<typeof Text>[0]["color"];
              return (
                <Box key={`${c.status}:${c.message}`} flexDirection="column">
                  <Box>
                    <Text color={color}>{STATUS_ICON[c.status]} </Text>
                    <Text>{c.message}</Text>
                  </Box>
                  {c.hint && (
                    <Box paddingLeft={2}>
                      <Text color="gray">→ {c.hint}</Text>
                    </Box>
                  )}
                </Box>
              );
            })}
          <Box height={1} />
        </Box>
      ))}
      <Box>
        <Text color={errors > 0 ? "red" : warns > 0 ? "yellow" : "green"}>
          {oks} ok · {warns} warn · {errors} error
        </Text>
      </Box>
      {actionMessage && (
        <Box marginTop={1}>
          <Text color="cyan">{actionMessage}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">r re-check</Text>
      </Box>
    </Box>
  );
}
