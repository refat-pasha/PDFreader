export type Command = {
  id: string;
  label: string;
  shortcut?: string;
  hint?: string;
  run: () => void;
};

export function fuzzyMatch(query: string, value: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return needle.split(/\s+/).every((part) => value.toLowerCase().includes(part));
}

export function filterCommands(commands: Command[], query: string): Command[] {
  return commands.filter((command) =>
    fuzzyMatch(query, `${command.label} ${command.hint ?? ""} ${command.shortcut ?? ""}`),
  );
}

export function shortcutLabel(value: string): string {
  return value
    .replace("Mod", "Ctrl")
    .replaceAll("+", " + ")
    .replace("PageUp", "PgUp")
    .replace("PageDown", "PgDn");
}
