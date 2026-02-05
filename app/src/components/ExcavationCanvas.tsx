import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";

export interface ExcavationCanvasHandle {
  revealNow: () => void;
}

interface ExcavationCanvasProps {
  imageUrl: string;
  artifactName: string;
  phase: "ready" | "digging" | "revealed";
  clickTarget: number;
  onTapStep: (step: number) => void;
  onRevealChange: (value: number) => void;
}

interface PreparedImage {
  texture: THREE.CanvasTexture;
  roughnessTexture: THREE.CanvasTexture;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

interface CoverShard {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  active: boolean;
  falling: boolean;
  velocity: THREE.Vector3;
  angular: THREE.Vector3;
  life: number;
}

interface SceneController {
  cleanup: () => void;
  resetCover: () => void;
  releaseAll: () => void;
}

type GyroMode = "unsupported" | "prompt" | "active" | "denied";

type OrientationEventConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = url;
  });
}

function prepareImage(image: HTMLImageElement): PreparedImage {
  const full = document.createElement("canvas");
  full.width = image.naturalWidth || image.width;
  full.height = image.naturalHeight || image.height;
  const fullCtx = full.getContext("2d");
  if (!fullCtx) throw new Error("canvas context unavailable");
  fullCtx.drawImage(image, 0, 0);
  const fullPixels = fullCtx.getImageData(0, 0, full.width, full.height).data;

  let minX = full.width;
  let minY = full.height;
  let maxX = 0;
  let maxY = 0;
  let hasVisible = false;
  for (let y = 0; y < full.height; y += 1) {
    for (let x = 0; x < full.width; x += 1) {
      const alpha = fullPixels[(y * full.width + x) * 4 + 3];
      if (alpha > 10) {
        hasVisible = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!hasVisible) {
    minX = 0;
    minY = 0;
    maxX = full.width - 1;
    maxY = full.height - 1;
  }

  const pad = 8;
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropW = Math.min(full.width - cropX, maxX - minX + 1 + pad * 2);
  const cropH = Math.min(full.height - cropY, maxY - minY + 1 + pad * 2);

  const crop = document.createElement("canvas");
  crop.width = cropW;
  crop.height = cropH;
  const cropCtx = crop.getContext("2d");
  if (!cropCtx) throw new Error("crop context unavailable");
  cropCtx.drawImage(full, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  const cropImage = cropCtx.getImageData(0, 0, cropW, cropH);
  const pixels = cropImage.data;

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = cropW;
  roughCanvas.height = cropH;
  const roughCtx = roughCanvas.getContext("2d");
  if (!roughCtx) throw new Error("roughness context unavailable");
  const roughImage = roughCtx.createImageData(cropW, cropH);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    const lum = (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) / 255;
    const rough = Math.round((0.72 + (1 - lum) * 0.2 + (1 - alpha) * 0.08) * 255);
    roughImage.data[i] = rough;
    roughImage.data[i + 1] = rough;
    roughImage.data[i + 2] = rough;
    roughImage.data[i + 3] = 255;
  }
  roughCtx.putImageData(roughImage, 0, 0);

  const texture = new THREE.CanvasTexture(crop);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const roughnessTexture = new THREE.CanvasTexture(roughCanvas);
  roughnessTexture.minFilter = THREE.LinearFilter;
  roughnessTexture.magFilter = THREE.LinearFilter;
  roughnessTexture.needsUpdate = true;

  return { texture, roughnessTexture, pixels, width: cropW, height: cropH };
}

function sampleAlpha(prepared: PreparedImage, u: number, v: number): number {
  const x = Math.floor(clamp01(u) * (prepared.width - 1));
  const y = Math.floor((1 - clamp01(v)) * (prepared.height - 1));
  return prepared.pixels[(y * prepared.width + x) * 4 + 3] / 255;
}

function sampleLuminance(prepared: PreparedImage, u: number, v: number): number {
  const x = Math.floor(clamp01(u) * (prepared.width - 1));
  const y = Math.floor((1 - clamp01(v)) * (prepared.height - 1));
  const idx = (y * prepared.width + x) * 4;
  const r = prepared.pixels[idx] / 255;
  const g = prepared.pixels[idx + 1] / 255;
  const b = prepared.pixels[idx + 2] / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function applyRelief(geometry: THREE.PlaneGeometry, prepared: PreparedImage): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const alpha = sampleAlpha(prepared, u, v);
    const lum = sampleLuminance(prepared, u, v);
    const lumX = sampleLuminance(prepared, u + 0.003, v);
    const lumY = sampleLuminance(prepared, u, v + 0.003);
    const emboss = (lumX - lum + lumY - lum) * 0.016;
    const grain = Math.sin(u * 39 + v * 21) * 0.0015;
    const relief = (1 - lum) * 0.047 + emboss + grain;
    pos.setZ(i, -0.012 + alpha * relief - (1 - alpha) * 0.008);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createRockTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#836a53");
  gradient.addColorStop(1, "#5f4b38");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const image = ctx.getImageData(0, 0, 256, 256);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 24;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  ctx.putImageData(image, 0, 0);

  for (let i = 0; i < 24; i += 1) {
    ctx.strokeStyle = `rgba(35,25,18,${0.08 + Math.random() * 0.12})`;
    ctx.lineWidth = 1 + Math.random() * 1.4;
    ctx.beginPath();
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 80, y + (Math.random() - 0.5) * 80);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.8, 3.6);
  texture.needsUpdate = true;
  return texture;
}

export const ExcavationCanvas = forwardRef<ExcavationCanvasHandle, ExcavationCanvasProps>(function ExcavationCanvas(
  { imageUrl, artifactName, phase, clickTarget, onTapStep, onRevealChange },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef(phase);
  const clickTargetRef = useRef(clickTarget);
  const tapStepRef = useRef(onTapStep);
  const revealRef = useRef(onRevealChange);
  const pointerTiltRef = useRef(new THREE.Vector2(0, 0));
  const gyroTiltRef = useRef(new THREE.Vector2(0, 0));
  const manualTiltUntilRef = useRef(0);
  const controllerRef = useRef<SceneController | null>(null);
  const gyroCleanupRef = useRef<(() => void) | null>(null);
  const [gyroMode, setGyroMode] = useState<GyroMode>("unsupported");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    clickTargetRef.current = clickTarget;
  }, [clickTarget]);
  useEffect(() => {
    tapStepRef.current = onTapStep;
  }, [onTapStep]);
  useEffect(() => {
    revealRef.current = onRevealChange;
  }, [onRevealChange]);

  useImperativeHandle(
    ref,
    () => ({
      revealNow: () => controllerRef.current?.releaseAll()
    }),
    []
  );

  const enableGyro = useCallback(async (fromUserGesture: boolean) => {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      setGyroMode("unsupported");
      return;
    }

    if (gyroCleanupRef.current) {
      setGyroMode("active");
      return;
    }

    const ctor = window.DeviceOrientationEvent as OrientationEventConstructor;
    if (typeof ctor.requestPermission === "function") {
      if (!fromUserGesture) {
        setGyroMode("prompt");
        return;
      }
      try {
        const permission = await ctor.requestPermission();
        if (permission !== "granted") {
          setGyroMode("denied");
          return;
        }
      } catch {
        setGyroMode("denied");
        return;
      }
    }

    const onOrientation = (event: DeviceOrientationEvent) => {
      if (typeof event.beta !== "number" || typeof event.gamma !== "number") return;
      const beta = THREE.MathUtils.clamp(event.beta, -45, 45);
      const gamma = THREE.MathUtils.clamp(event.gamma, -50, 50);
      gyroTiltRef.current.x = THREE.MathUtils.clamp((-beta / 45) * 0.18, -0.2, 0.2);
      gyroTiltRef.current.y = THREE.MathUtils.clamp((gamma / 50) * 0.24, -0.24, 0.24);
    };

    window.addEventListener("deviceorientation", onOrientation, true);
    gyroCleanupRef.current = () => {
      window.removeEventListener("deviceorientation", onOrientation, true);
      gyroTiltRef.current.set(0, 0);
    };
    setGyroMode("active");
  }, []);

  useEffect(() => {
    void enableGyro(false);
    return () => {
      if (gyroCleanupRef.current) {
        gyroCleanupRef.current();
        gyroCleanupRef.current = null;
      }
    };
  }, [enableGyro]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !imageUrl) return;
    let cancelled = false;

    const init = async () => {
      try {
        const image = await loadImage(imageUrl);
        if (cancelled) return;
        const prepared = prepareImage(image);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(Math.max(220, host.clientWidth), Math.max(280, host.clientHeight));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.03;
        host.innerHTML = "";
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, host.clientWidth / host.clientHeight, 0.1, 20);
        camera.position.set(0, 0, 3.1);
        scene.add(new THREE.HemisphereLight(0xf2e4cf, 0x2f251c, 1));
        const key = new THREE.DirectionalLight(0xfff9ef, 1.18);
        key.position.set(2.2, 2.5, 3.3);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xcbb08e, 0.52);
        rim.position.set(-2.4, -1.2, 1.2);
        scene.add(rim);

        const group = new THREE.Group();
        scene.add(group);

        const aspect = prepared.width / prepared.height;
        let planeW = 1.64;
        let planeH = planeW / aspect;
        if (planeH > 1.92) {
          planeH = 1.92;
          planeW = planeH * aspect;
        }

        const segX = Math.min(260, Math.max(120, Math.round(190 * aspect)));
        const segY = Math.min(320, Math.max(170, Math.round(190 / Math.max(0.5, aspect))));
        const reliefGeo = new THREE.PlaneGeometry(planeW, planeH, segX, segY);
        applyRelief(reliefGeo, prepared);
        const reliefMat = new THREE.MeshPhysicalMaterial({
          map: prepared.texture,
          alphaMap: prepared.texture,
          roughnessMap: prepared.roughnessTexture,
          transparent: true,
          alphaTest: 0.02,
          roughness: 0.84,
          metalness: 0.02,
          clearcoat: 0.05,
          clearcoatRoughness: 0.9
        });
        const reliefMesh = new THREE.Mesh(reliefGeo, reliefMat);
        reliefMesh.position.z = 0.018;
        group.add(reliefMesh);

        const shellGeo = new THREE.PlaneGeometry(planeW, planeH, 1, 1);
        const edgeMat = new THREE.MeshStandardMaterial({
          color: 0x4c3a2a,
          alphaMap: prepared.texture,
          transparent: true,
          alphaTest: 0.02,
          roughness: 1
        });
        for (let i = 0; i < 5; i += 1) {
          const edge = new THREE.Mesh(shellGeo, edgeMat);
          edge.position.z = -0.012 - i * 0.007;
          edge.scale.set(1.003 + i * 0.001, 1.003 + i * 0.001, 1);
          group.add(edge);
        }

        const coverGroup = new THREE.Group();
        coverGroup.position.z = 0.063;
        group.add(coverGroup);

        const rockTexture = createRockTexture();
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        const clock = new THREE.Clock();
        const tmpVec = new THREE.Vector3();

        const shards: CoverShard[] = [];
        let totalShards = 0;
        let releasedShards = 0;
        let clickStep = 0;
        let running = true;

        const updateReveal = () => {
          if (totalShards <= 0) {
            revealRef.current(0);
            return;
          }
          const ratio = (releasedShards / totalShards) * 100;
          revealRef.current(Math.min(100, Math.max(0, ratio)));
        };

        const isCovered = (u: number, v: number) => {
          if (sampleAlpha(prepared, u, v) > 0.02) return true;
          const spread = 0.035;
          const offsets: Array<[number, number]> = [
            [spread, 0],
            [-spread, 0],
            [0, spread],
            [0, -spread],
            [spread, spread],
            [spread, -spread],
            [-spread, spread],
            [-spread, -spread]
          ];
          for (const [dx, dy] of offsets) {
            if (sampleAlpha(prepared, u + dx, v + dy) > 0.02) return true;
          }
          return false;
        };

        const clearShards = () => {
          for (const shard of shards) {
            coverGroup.remove(shard.mesh);
            shard.mesh.geometry.dispose();
            shard.mesh.material.dispose();
          }
          shards.length = 0;
          totalShards = 0;
          releasedShards = 0;
          clickStep = 0;
        };

        const buildCover = () => {
          clearShards();

          const cols = Math.max(18, Math.round(22 * aspect));
          const rows = Math.max(20, Math.round(cols / Math.max(aspect, 0.55)));
          const cellW = planeW / cols;
          const cellH = planeH / rows;

          for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
              const uMid = (col + 0.5) / cols;
              const vMid = 1 - (row + 0.5) / rows;
              if (!isCovered(uMid, vMid)) continue;

              const geo = new THREE.PlaneGeometry(cellW * 1.08, cellH * 1.08, 1, 1);
              const uv = geo.attributes.uv as THREE.BufferAttribute;
              const u0 = col / cols;
              const u1 = (col + 1) / cols;
              const v0 = 1 - (row + 1) / rows;
              const v1 = 1 - row / rows;
              uv.setXY(0, u0, v1);
              uv.setXY(1, u1, v1);
              uv.setXY(2, u0, v0);
              uv.setXY(3, u1, v0);
              uv.needsUpdate = true;

              const mat = new THREE.MeshStandardMaterial({
                map: rockTexture,
                color: new THREE.Color().setHSL(0.08, 0.22, 0.34 + Math.random() * 0.08),
                roughness: 1,
                metalness: 0,
                transparent: true,
                opacity: 0.99
              });
              const mesh = new THREE.Mesh(geo, mat);
              mesh.position.set(
                (col + 0.5) * cellW - planeW / 2 + (Math.random() - 0.5) * cellW * 0.08,
                (rows - row - 0.5) * cellH - planeH / 2 + (Math.random() - 0.5) * cellH * 0.08,
                Math.random() * 0.015
              );
              mesh.rotation.z = (Math.random() - 0.5) * 0.08;
              coverGroup.add(mesh);

              shards.push({
                mesh,
                active: true,
                falling: false,
                velocity: new THREE.Vector3(),
                angular: new THREE.Vector3(),
                life: 0
              });
            }
          }

          totalShards = shards.length;
          updateReveal();
        };

        buildCover();

        const dropPortion = (center?: THREE.Vector2) => {
          if (phaseRef.current !== "digging") return;

          clickStep += 1;
          tapStepRef.current(clickStep);

          const remaining = shards.filter((s) => s.active && !s.falling);
          if (!remaining.length) return;

          const impactCenter =
            center ?? new THREE.Vector2((Math.random() - 0.5) * planeW * 0.8, (Math.random() - 0.5) * planeH * 0.8);
          remaining.sort((a, b) => {
            const da = a.mesh.position.distanceToSquared(new THREE.Vector3(impactCenter.x, impactCenter.y, a.mesh.position.z));
            const db = b.mesh.position.distanceToSquared(new THREE.Vector3(impactCenter.x, impactCenter.y, b.mesh.position.z));
            return da - db;
          });

          const stepsLeft = Math.max(1, clickTargetRef.current - clickStep + 1);
          const minDrop = Math.max(1, Math.ceil(remaining.length / stepsLeft));
          const extra = Math.floor(Math.random() * Math.max(1, Math.round(minDrop * 0.5)));
          const dropCount = Math.min(remaining.length, minDrop + extra);

          for (let i = 0; i < dropCount; i += 1) {
            const shard = remaining[i];
            shard.falling = true;
            tmpVec.set(shard.mesh.position.x - impactCenter.x, shard.mesh.position.y - impactCenter.y, 0);
            if (tmpVec.lengthSq() < 0.0001) {
              tmpVec.set((Math.random() - 0.5) * 0.5, Math.random() * 0.5, 0);
            }
            tmpVec.normalize();
            shard.velocity.set(tmpVec.x * (0.3 + Math.random() * 0.8), 1.2 + Math.random() * 1.5, Math.random() * 0.22);
            shard.angular.set((Math.random() - 0.5) * 6.4, (Math.random() - 0.5) * 6.4, (Math.random() - 0.5) * 6.4);
          }

          if (clickStep >= clickTargetRef.current) {
            for (const shard of shards) {
              if (!shard.active || shard.falling) continue;
              shard.falling = true;
              shard.velocity.set((Math.random() - 0.5) * 1.8, 1.2 + Math.random() * 1.6, Math.random() * 0.3);
              shard.angular.set((Math.random() - 0.5) * 6.8, (Math.random() - 0.5) * 6.8, (Math.random() - 0.5) * 6.8);
            }
          }
        };

        const onPointerDown = (event: PointerEvent) => {
          if (phaseRef.current !== "digging") return;

          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const activeMeshes = shards.filter((s) => s.active && !s.falling).map((s) => s.mesh);
          const hit = raycaster.intersectObjects(activeMeshes, false)[0];
          if (hit) {
            const local = group.worldToLocal(hit.point.clone());
            dropPortion(new THREE.Vector2(local.x, local.y));
          } else {
            dropPortion();
          }
        };

        const onPointerMove = (event: PointerEvent) => {
          const rect = renderer.domElement.getBoundingClientRect();
          const tx = ((event.clientX - rect.left) / rect.width - 0.5) * 0.24;
          const ty = ((event.clientY - rect.top) / rect.height - 0.5) * -0.18;
          pointerTiltRef.current.set(ty, tx);
          manualTiltUntilRef.current = performance.now() + 850;
        };

        renderer.domElement.addEventListener("pointerdown", onPointerDown);
        renderer.domElement.addEventListener("pointermove", onPointerMove);

        const onResize = () => {
          const w = Math.max(220, host.clientWidth);
          const h = Math.max(280, host.clientHeight);
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", onResize);

        const animate = () => {
          if (!running) return;
          const dt = Math.min(0.033, clock.getDelta());
          const useManualTilt = performance.now() < manualTiltUntilRef.current;
          const targetTiltX = useManualTilt ? pointerTiltRef.current.x : gyroTiltRef.current.x;
          const targetTiltY = useManualTilt ? pointerTiltRef.current.y : gyroTiltRef.current.y;
          group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, targetTiltX, 0.11);
          group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, targetTiltY, 0.11);
          group.position.y = Math.sin(clock.elapsedTime * 1.12) * 0.0068;

          for (const shard of shards) {
            if (!shard.active || !shard.falling) continue;
            shard.velocity.y -= 7.2 * dt;
            shard.mesh.position.x += shard.velocity.x * dt;
            shard.mesh.position.y += shard.velocity.y * dt;
            shard.mesh.position.z += shard.velocity.z * dt;
            shard.mesh.rotation.x += shard.angular.x * dt;
            shard.mesh.rotation.y += shard.angular.y * dt;
            shard.mesh.rotation.z += shard.angular.z * dt;
            shard.life += dt;

            if (shard.mesh.position.y < -planeH * 1.4 || shard.life > 2.4) {
              shard.active = false;
              shard.falling = false;
              shard.mesh.visible = false;
              releasedShards += 1;
              updateReveal();
            }
          }

          renderer.render(scene, camera);
          requestAnimationFrame(animate);
        };
        animate();

        controllerRef.current = {
          resetCover: () => {
            buildCover();
          },
          releaseAll: () => {
            for (const shard of shards) {
              if (!shard.active || shard.falling) continue;
              shard.falling = true;
              shard.velocity.set((Math.random() - 0.5) * 1.9, 1.2 + Math.random() * 1.7, Math.random() * 0.32);
              shard.angular.set((Math.random() - 0.5) * 7.0, (Math.random() - 0.5) * 7.0, (Math.random() - 0.5) * 7.0);
            }
          },
          cleanup: () => {
            running = false;
            renderer.domElement.removeEventListener("pointerdown", onPointerDown);
            renderer.domElement.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("resize", onResize);

            clearShards();
            reliefGeo.dispose();
            shellGeo.dispose();
            reliefMat.dispose();
            edgeMat.dispose();
            prepared.texture.dispose();
            prepared.roughnessTexture.dispose();
            rockTexture.dispose();
            renderer.dispose();
          }
        };
      } catch {
        revealRef.current(0);
      }
    };

    void init();

    return () => {
      cancelled = true;
      controllerRef.current?.cleanup();
      controllerRef.current = null;
    };
  }, [artifactName, imageUrl]);

  useEffect(() => {
    if (phase === "ready") controllerRef.current?.resetCover();
    if (phase === "revealed") controllerRef.current?.releaseAll();
  }, [phase, clickTarget]);

  return (
    <div className="excavation-canvas-wrap">
      <div className="excavation-canvas" ref={hostRef} role="img" aria-label={`正在发掘：${artifactName}`} />
      {(gyroMode === "prompt" || gyroMode === "denied") && phase !== "revealed" ? (
        <div className="gyro-overlay">
          <button type="button" className="btn ghost" onClick={() => void enableGyro(true)}>
            {gyroMode === "prompt" ? "启用体感视角" : "重试体感授权"}
          </button>
          <p>{gyroMode === "prompt" ? "手机转动可带来更沉浸的石刻观感。" : "未获得体感权限，已回退为触控视角。"}</p>
        </div>
      ) : null}
      {gyroMode === "active" ? <div className="gyro-badge">体感视角已启用</div> : null}
    </div>
  );
});
