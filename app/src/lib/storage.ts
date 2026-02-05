const DISCOVERED_KEY = "stone-discovered-artifacts";

export function readDiscoveredArtifacts(): string[] {
  const raw = localStorage.getItem(DISCOVERED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addDiscoveredArtifact(id: string): string[] {
  const current = new Set(readDiscoveredArtifacts());
  current.add(id);
  const next = Array.from(current);
  localStorage.setItem(DISCOVERED_KEY, JSON.stringify(next));
  return next;
}
