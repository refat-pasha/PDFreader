export type RecentFile = {
  path: string;
  name: string;
  openedAt: number;
};

const KEY = "pdfreader.recent.v1";
const MAX_RECENT = 8;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function getRecentFiles(): RecentFile[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentFile =>
        Boolean(item && typeof item === "object" && typeof (item as RecentFile).path === "string" && typeof (item as RecentFile).name === "string"))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberRecent(entries: Array<{ path: string; name: string }>): RecentFile[] {
  const current = getRecentFiles();
  const now = Date.now();
  const incoming = entries
    .filter((entry) => entry.path && !entry.path.startsWith("pdfreader://"))
    .map((entry, index) => ({ path: entry.path, name: entry.name, openedAt: now - index }));
  const merged: RecentFile[] = [];
  const seen = new Set<string>();
  for (const entry of [...incoming, ...current]) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    merged.push(entry);
  }
  const next = merged.slice(0, MAX_RECENT);
  try {
    storage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Recent files are a convenience; storage quota should not block opening.
  }
  return next;
}

export function forgetRecentFile(path: string): RecentFile[] {
  const next = getRecentFiles().filter((entry) => entry.path !== path);
  try {
    storage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignore unavailable storage.
  }
  return next;
}

export function clearRecentFiles(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Ignore unavailable storage.
  }
}
