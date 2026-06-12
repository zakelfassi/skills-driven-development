import { Box, Text } from "ink";
import { ALL_HOST_IDS, type McpCellStatus, type McpRow } from "../state.js";

interface McpPaneProps {
  rows: McpRow[];
  selectedIndex: number;
  dryRunOutput?: string;
}

const CELL: Record<McpCellStatus, { char: string; color: string }> = {
  synced: { char: "✓", color: "green" },
  drift: { char: "!", color: "yellow" },
  excluded: { char: "·", color: "gray" },
  unavailable: { char: "—", color: "gray" },
};

const HOST_SHORT: Record<string, string> = {
  "claude-code": "CC",
  "claude-desktop": "CD",
  codex: "CX",
  droid: "DR",
  cursor: "CU",
  opencode: "OC",
  gemini: "GM",
};

export function McpPane({ rows, selectedIndex, dryRunOutput }: McpPaneProps) {
  if (rows.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color="yellow">
          No MCP servers in canonical registry. Run `skdd mcp add &lt;name&gt;` to add one.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header row */}
      <Box>
        <Text>{"".padEnd(20)}</Text>
        {ALL_HOST_IDS.map((h) => (
          <Text key={h} color="gray">
            {" "}
            {HOST_SHORT[h] ?? h.slice(0, 2).toUpperCase()}
          </Text>
        ))}
      </Box>
      {rows.map((row, i) => {
        const selected = i === selectedIndex;
        return (
          <Box key={row.name}>
            <Text color={selected ? "cyan" : undefined}>{selected ? "▶ " : "  "}</Text>
            <Text bold={selected}>{row.name.slice(0, 17).padEnd(17)}</Text>
            {ALL_HOST_IDS.map((h) => {
              const cell = CELL[row.hosts[h]] ?? CELL.unavailable;
              return (
                <Text key={h} color={cell.color as Parameters<typeof Text>[0]["color"]}>
                  {" "}
                  {cell.char}
                </Text>
              );
            })}
          </Box>
        );
      })}
      {dryRunOutput && (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">── dry-run plan ──</Text>
          <Text color="gray">{dryRunOutput}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">
          ↑↓ navigate · s sync · d dry-run · ✓synced !drift ·excluded —unavailable
        </Text>
      </Box>
      <Box>
        <Text color="gray">
          CC=claude-code CD=claude-desktop CX=codex DR=droid CU=cursor OC=opencode GM=gemini
        </Text>
      </Box>
    </Box>
  );
}
