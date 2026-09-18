import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { Artifact } from "@/types/artifact";

interface Hotspot {
  title: string;
  xPercent: number; // 0 - 100%
  yPercent: number; // 0 - 100%
  zoomLevel: number;
  description: string;
}

// Key archaeological highlights for wide relief slabs
const ARTIFACT_HOTSPOTS: Record<string, Hotspot[]> = {
  "artifact-067": [
    {
      title: "庖厨屠牲图",
      xPercent: 12,
      yPercent: 48,
      zoomLevel: 2.6,
      description: "描绘汉代贵族庖厨备宴：悬挂鲜肉、屠宰牛羊、炊烟汲水，是研究汉代饮食礼制的珍贵实证。"
    },
    {
      title: "长袖曼舞与百戏杂技",
      xPercent: 52,
      yPercent: 50,
      zoomLevel: 2.8,
      description: "舞者长袖翻飞、腰肢纤细；右侧杂技艺人倒立顶碗、口吐灵草，伴随建鼓节奏铿锵，极为生动。"
    },
    {
      title: "农耕汲水场景",
      xPercent: 88,
      yPercent: 50,
      zoomLevel: 2.5,
      description: "两汉庄园农耕生产场景：水井辘轳汲水、农人躬身耕作，反映东汉鲁西南庄园经济面貌。"
    }
  ],
  "artifact-068": [
    {
      title: "进贤冠文吏列队",
      xPercent: 18,
      yPercent: 50,
      zoomLevel: 2.6,
      description: "24位文吏头戴进贤冠，手执笏板躬身拱揖，尊卑有序，庄严再现汉代郊迎与朝贺礼节。"
    },
    {
      title: "双辕战车与主客仪仗",
      xPercent: 68,
      yPercent: 50,
      zoomLevel: 2.8,
      description: "主车伞盖高耸，战马扬蹄飞驰，车辕与驭手神态毕现，展现汉代高级官吏出行的威仪车骑。"
    }
  ],
  "artifact-066": [
    {
      title: "永元五年题记",
      xPercent: 18,
      yPercent: 22,
      zoomLevel: 3.0,
      description: "右上方以清晰东汉八分隶书刻‘永元五年三月’（公元93年，汉和帝年号），是断代标准器证据。"
    },
    {
      title: "庑殿高楼与主客拜谒",
      xPercent: 50,
      yPercent: 60,
      zoomLevel: 2.4,
      description: "双重高阙下重楼高耸，宾主阶前肃穆拜谒，具有典型东汉建筑斗拱与仪礼规制。"
    }
  ],
  "artifact-065": [
    {
      title: "六人乘大象",
      xPercent: 48,
      yPercent: 32,
      zoomLevel: 2.5,
      description: "六名异邦或仙人同乘一头巨象徐徐而行，反映东汉丝绸之路交通与祥瑞神灵信仰。"
    },
    {
      title: "九尾开明兽守护",
      xPercent: 50,
      yPercent: 78,
      zoomLevel: 2.6,
      description: "下层神兽人面兽身、生九尾，乃昆仑天门之开明神兽，护卫仙界出入。"
    }
  ]
};

interface StoneInspectModalProps {
  artifact: Artifact;
  onClose: () => void;
}

export function StoneInspectModal({ artifact, onClose }: StoneInspectModalProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [filterMode, setFilterMode] = useState<"natural" | "ink_rubbing" | "red_rubbing">("natural");
  const [selectedHotspot, setSelectedHotspot] = useState<Hotspot | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageSrc = artifact.modelImageLarge || artifact.modelImage || artifact.modelImageThumb || "";
  const hotspots = ARTIFACT_HOTSPOTS[artifact.id] || [];

  // Reset or adjust zoom
  const handleZoom = useCallback((delta: number) => {
    setScale((prev) => Math.min(5, Math.max(0.8, prev + delta)));
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setSelectedHotspot(null);
  }, []);

  // Hotspot jump
  const jumpToHotspot = useCallback((spot: Hotspot) => {
    setSelectedHotspot(spot);
    setScale(spot.zoomLevel);
    // Pan image center toward hotspot
    const targetX = -(spot.xPercent - 50) * 8;
    const targetY = -(spot.yPercent - 50) * 4;
    setPosition({ x: targetX, y: targetY });
  }, []);

  // Wheel zoom
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    handleZoom(delta);
  };

  // Pointer drag
  const onPointerDown = (e: PointerEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const onPointerUp = (e: PointerEvent) => {
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // Keyboard escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // CSS Filter styles for rubbing simulation
  const getFilterStyle = () => {
    if (filterMode === "ink_rubbing") {
      // Classical Black & White Ink Rubbing (墨拓)
      return "grayscale(100%) contrast(280%) brightness(92%) invert(10%)";
    }
    if (filterMode === "red_rubbing") {
      // Cinnabar Red Rubbing (朱拓)
      return "grayscale(100%) contrast(220%) sepia(100%) hue-rotate(320deg) saturate(380%)";
    }
    return "none";
  };

  return (
    <div className="stone-inspect-overlay" role="dialog" aria-modal="true" aria-label="石刻微观探照镜">
      {/* Top Toolbar */}
      <header className="stone-inspect-header">
        <div className="inspect-title-group">
          <span className="inspect-badge">显微探照台</span>
          <h2>{artifact.name}</h2>
          <small>{artifact.museum || "汉画像石"}</small>
        </div>

        <div className="inspect-actions">
          {/* Rubbing Mode Switch */}
          <div className="inspect-rubbing-switch" role="radiogroup" aria-label="拓片比对模式">
            <button
              type="button"
              className={filterMode === "natural" ? "active" : ""}
              onClick={() => setFilterMode("natural")}
              title="原石风貌"
            >
              原石
            </button>
            <button
              type="button"
              className={filterMode === "ink_rubbing" ? "active" : ""}
              onClick={() => setFilterMode("ink_rubbing")}
              title="模拟黑白墨拓"
            >
              墨拓
            </button>
            <button
              type="button"
              className={filterMode === "red_rubbing" ? "active" : ""}
              onClick={() => setFilterMode("red_rubbing")}
              title="模拟朱砂朱拓"
            >
              朱拓
            </button>
          </div>

          {/* Zoom controls */}
          <div className="inspect-zoom-controls">
            <button type="button" onClick={() => handleZoom(-0.3)} title="缩小">
              -
            </button>
            <span className="zoom-indicator">{Math.round(scale * 100)}%</span>
            <button type="button" onClick={() => handleZoom(0.3)} title="放大">
              +
            </button>
            <button type="button" onClick={resetView} title="重置视野">
              复位
            </button>
          </div>

          <button type="button" className="btn-close-inspect" onClick={onClose} aria-label="关闭查看器">
            ✕
          </button>
        </div>
      </header>

      {/* Main Interactive Stage */}
      <div
        ref={containerRef}
        className="stone-inspect-stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div
          className="stone-inspect-canvas-wrapper"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? "none" : "transform 0.15s ease-out"
          }}
        >
          <img
            src={imageSrc}
            alt={artifact.name}
            className="stone-inspect-img"
            style={{ filter: getFilterStyle() }}
            draggable={false}
          />

          {/* Hotspot Markers */}
          {hotspots.map((spot, idx) => (
            <button
              key={idx}
              type="button"
              className={`inspect-hotspot-pin ${selectedHotspot?.title === spot.title ? "active" : ""}`}
              style={{
                left: `${spot.xPercent}%`,
                top: `${spot.yPercent}%`
              }}
              onClick={(e) => {
                e.stopPropagation();
                jumpToHotspot(spot);
              }}
              title={spot.title}
            >
              <span className="hotspot-pulse" />
              <span className="hotspot-label">{spot.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Hotspots Quick Drawer (if available) */}
      {hotspots.length > 0 ? (
        <footer className="stone-inspect-footer">
          <div className="hotspots-strip">
            <span className="hotspots-strip-label">考据热点：</span>
            {hotspots.map((spot, idx) => (
              <button
                key={idx}
                type="button"
                className={`hotspot-chip ${selectedHotspot?.title === spot.title ? "active" : ""}`}
                onClick={() => jumpToHotspot(spot)}
              >
                {spot.title}
              </button>
            ))}
          </div>

          {selectedHotspot ? (
            <div className="hotspot-detail-box">
              <h4>{selectedHotspot.title}</h4>
              <p>{selectedHotspot.description}</p>
            </div>
          ) : (
            <div className="hotspot-hint-box">
              <p>可按住鼠标/触控拖拽移动，双指或滚轮缩放；点击上方热点直接定位考据细节。</p>
            </div>
          )}
        </footer>
      ) : (
        <footer className="stone-inspect-footer compact">
          <p>提示：支持滚轮或双指 100%~500% 无级缩放，按住可任意拖拽平移。</p>
        </footer>
      )}
    </div>
  );
}
