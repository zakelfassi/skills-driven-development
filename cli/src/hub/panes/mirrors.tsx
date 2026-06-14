import { Box, Text } from "ink";
import type { MirrorRow } from "../state.js";

interface MirrorsPaneProps {
  mirrors: MirrorRow[];
  selectedIndex: number;
  actionMessage?: string;
}

const STATUS_ICON: Record<MirrorRow["status"], string> = {
  ok: "✓",
  drift: "!",
  missing: "✗",
  unlinked: "○",
};

const STATUS_COLOR: Record<MirrorRow["status"], string> = {
  ok: "green",
  drift: "yellow",
  missing: "red",
  unlinked: "gray",
};

export function MirrorsPane({ mirrors, selectedIndex, actionMessage }: MirrorsPaneProps) {
  if (mirrors.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color="yellow">No harnesses detected. Run `skdd init` first.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {mirrors.map((mirror, i) => {
        const selected = i === selectedIndex;
        const color = STATUS_COLOR[mirror.status] as Parameters<typeof Text>[0]["color"];
        return (
          <Box key={mirror.harness}>
            <Text color={selected ? "cyan" : undefined}>{selected ? "▶ " : "  "}</Text>
            <Text color={color}>{STATUS_ICON[mirror.status]} </Text>
            <Text bold={selected}>{mirror.label.padEnd(14)}</Text>
            <Text color="gray"> {mirror.target}</Text>
          </Box>
        );
      })}
      {actionMessage && (
        <Box marginTop={1}>
          <Text color="cyan">{actionMessage}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">↑↓ navigate · Enter link/unlink · ✓ok !drift ✗missing ○unlinked</Text>
      </Box>
    </Box>
  );
}
