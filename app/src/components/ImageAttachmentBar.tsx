import { ChangeEvent, useMemo, useRef, useState } from "react";
import { fileToCompressedImageAttachment, type ImageAttachment } from "@/lib/imageAttachment";

const MAX_IMAGE_BYTES = 1_800_000;

interface ImageAttachmentBarProps {
  value: ImageAttachment | null;
  onChange: (next: ImageAttachment | null) => void;
  disabled?: boolean;
}

function formatKib(bytes: number): string {
  const kib = bytes / 1024;
  return `${Math.max(1, Math.round(kib))}KB`;
}

export function ImageAttachmentBar({ value, onChange, disabled }: ImageAttachmentBarProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const albumInputRef = useRef<HTMLInputElement | null>(null);
  const [errorText, setErrorText] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  const metaText = useMemo(() => {
    if (!value) return "";
    return `${formatKib(value.bytes)} · ${value.width}x${value.height}`;
  }, [value]);

  const onPickImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setErrorText("");
    setIsWorking(true);
    try {
      const packed = await fileToCompressedImageAttachment(file, { maxEdge: 1280, quality: 0.78 });
      if (packed.bytes > MAX_IMAGE_BYTES) {
        setErrorText("图片过大，建议换一张或靠近拍摄。");
        onChange(null);
        return;
      }
      onChange(packed);
    } catch (error) {
      onChange(null);
      setErrorText(error instanceof Error ? error.message : "图片处理失败");
    } finally {
      setIsWorking(false);
    }
  };

  const openPreview = () => {
    if (!value?.dataUrl) return;
    // Best-effort: popup blockers might block this; it is still useful when allowed.
    window.open(value.dataUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="attach-bar" aria-label="图片附件">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPickImage}
        style={{ display: "none" }}
      />
      <input ref={albumInputRef} type="file" accept="image/*" onChange={onPickImage} style={{ display: "none" }} />

      <button
        type="button"
        className="btn ghost btn-small"
        disabled={Boolean(disabled) || isWorking}
        onClick={() => cameraInputRef.current?.click()}
      >
        拍照
      </button>
      <button
        type="button"
        className="btn ghost btn-small"
        disabled={Boolean(disabled) || isWorking}
        onClick={() => albumInputRef.current?.click()}
      >
        相册
      </button>

      {isWorking ? <span className="attach-meta">处理中...</span> : null}

      {value ? (
        <div className="attach-preview" title={`将随提问发送：${value.name} · ${metaText}`}>
          <button type="button" className="attach-preview-button" onClick={openPreview} aria-label="查看大图" disabled={Boolean(disabled)}>
            <img src={value.dataUrl} alt="已选图片预览" />
          </button>
          <div className="attach-chip">
            <span className="attach-chip-label">已添加</span>
            <span className="attach-chip-meta">{metaText}</span>
          </div>
          <button type="button" className="attach-remove" onClick={() => onChange(null)} aria-label="移除图片" disabled={Boolean(disabled)}>
            ×
          </button>
        </div>
      ) : null}

      {errorText ? <span className="attach-error">{errorText}</span> : null}
    </div>
  );
}

