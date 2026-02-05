import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useDiscovery } from "@/lib/useDiscovery";

const HomePage = lazy(() => import("@/pages/HomePage").then((mod) => ({ default: mod.HomePage })));
const ExcavationPage = lazy(() =>
  import("@/pages/ExcavationPage").then((mod) => ({ default: mod.ExcavationPage }))
);
const CollectionPage = lazy(() => import("@/pages/CollectionPage").then((mod) => ({ default: mod.CollectionPage })));
const ArtifactDetailPage = lazy(() =>
  import("@/pages/ArtifactDetailPage").then((mod) => ({ default: mod.ArtifactDetailPage }))
);
const PdfReaderPage = lazy(() => import("@/pages/PdfReaderPage").then((mod) => ({ default: mod.PdfReaderPage })));
const AiGuidePage = lazy(() => import("@/pages/AiGuidePage").then((mod) => ({ default: mod.AiGuidePage })));
const ExhibitHallPage = lazy(() => import("@/pages/ExhibitHallPage").then((mod) => ({ default: mod.ExhibitHallPage })));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then((mod) => ({ default: mod.NotFoundPage })));

function RouteLoading() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>石刻文化发现</h1>
        <p>页面加载中...</p>
      </header>
    </div>
  );
}

export default function App() {
  const { discoveredIds, discoveredSet, markDiscovered } = useDiscovery();

  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<HomePage discoveredCount={discoveredIds.length} />} />
        <Route
          path="/excavate"
          element={<ExcavationPage discoveredSet={discoveredSet} markDiscovered={markDiscovered} />}
        />
        <Route path="/collection" element={<CollectionPage discoveredSet={discoveredSet} />} />
        <Route path="/artifact/:artifactId" element={<ArtifactDetailPage />} />
        <Route path="/pdf-reader" element={<PdfReaderPage />} />
        <Route path="/ai-guide" element={<AiGuidePage />} />
        <Route path="/hall" element={<ExhibitHallPage />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
