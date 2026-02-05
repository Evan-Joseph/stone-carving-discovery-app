import { useCallback, useEffect, useState } from "react";
import { addDiscoveredArtifact, readDiscoveredArtifacts } from "@/lib/storage";

export function useDiscovery() {
  const [discoveredIds, setDiscoveredIds] = useState<string[]>([]);

  useEffect(() => {
    setDiscoveredIds(readDiscoveredArtifacts());
  }, []);

  const markDiscovered = useCallback((id: string) => {
    setDiscoveredIds(addDiscoveredArtifact(id));
  }, []);

  return {
    discoveredIds,
    markDiscovered,
    discoveredSet: new Set(discoveredIds)
  };
}
