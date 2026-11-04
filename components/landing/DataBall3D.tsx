"use client";

/**
 * DATA BALL 3D — the landing signature object: a football made of data
 * cells (three.js vanilla, no R3F). 850 small cells sit on a sphere in a
 * fibonacci layout; each cell's temperature comes from the featured
 * match's real 6x6 score matrix — the probability field is smeared over
 * the sphere with a gaussian kernel around 36 anchor directions (home
 * goals -> polar angle, away goals -> azimuth), so the most likely
 * scores literally glow amber on the ball.
 *
 * Performance budget (hard rules, same as the object it replaces):
 * - pixelRatio capped at min(devicePixelRatio, 2); 1.5 on mobile.
 * - Render loop pauses off-screen (IntersectionObserver) and when the
 *   tab is hidden (visibilitychange).
 * - prefers-reduced-motion: one static frame, no loop, no parallax.
 * - No post-processing; everything disposed on unmount.
 * - WebGL failure -> static 2D heat grid of the same matrix.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { heatStyle } from "../ui";

interface Props {
  /** Raw score probabilities (landing passes 6x6; rows = home goals, cols = away goals). */
  matrix: number[][];
  home?: string;
  away?: string;
}

const CELLS = 850;
const SIGMA = 0.28;

export default function DataBall3D({ matrix, home, away }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || failed) return;
    let cleanup: (() => void) | undefined;
    try {
      cleanup = initScene(mount, matrix);
    } catch {
      setFailed(true);
    }
    return () => cleanup?.();
  }, [matrix, failed]);

  if (failed) return <BallFallback matrix={matrix} home={home} away={away} />;

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full"
      role="img"
      aria-label="A football made of data cells. The brightest cells are the most likely scores."
    />
  );
}

/* ------------------------------------------------------------------ scene */

function anchorDir(i: number, rows: number, j: number, cols: number): THREE.Vector3 {
  const theta = 0.35 + (rows > 1 ? i / (rows - 1) : 0) * 1.5; // polar, from +Y
  const phi = ((cols > 1 ? j / (cols - 1) : 0) - 0.5) * 1.9; // azimuth around Y
  return new THREE.Vector3(
    Math.sin(theta) * Math.sin(phi),
    Math.cos(theta),
    Math.sin(theta) * Math.cos(phi),
  );
}

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0b0a08";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "rgba(233, 228, 216, 0.055)";
  ctx.lineWidth = 1;
  const stepX = c.width / 36;
  const stepY = c.height / 18;
  ctx.beginPath();
  for (let x = 0; x <= c.width; x += stepX) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, c.height);
  }
  for (let y = 0; y <= c.height; y += stepY) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(c.width, y + 0.5);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0, "rgba(0, 0, 0, 0.55)");
  g.addColorStop(0.6, "rgba(0, 0, 0, 0.28)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function initScene(mount: HTMLDivElement, matrix: number[][]): () => void {
  const rows = matrix.length;
  const cols = rows > 0 ? (matrix[0]?.length ?? 0) : 0;
  if (rows === 0 || cols === 0) throw new Error("empty matrix");

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0.15, 3.4);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const dprCap = window.innerWidth < 768 ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  mount.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffe9c9, 0.5));
  const key = new THREE.DirectionalLight(0xfff0da, 1.6);
  key.position.set(4, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd9a0, 0.45);
  rim.position.set(-6, 2, -4);
  scene.add(rim);

  const rig = new THREE.Group();
  const spin = new THREE.Group();
  rig.add(spin);
  scene.add(rig);

  /* ---- probability field over the sphere ---- */
  const anchors: { dir: THREE.Vector3; p: number }[] = [];
  let hotDir = new THREE.Vector3(0, 0, 1);
  let hotP = -1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const dir = anchorDir(i, rows, j, cols);
      const p = matrix[i]?.[j] ?? 0;
      anchors.push({ dir, p });
      if (p > hotP) {
        hotP = p;
        hotDir = dir;
      }
    }
  }
  const twoSigma2 = 2 * SIGMA * SIGMA;
  const temperature = (dir: THREE.Vector3): number => {
    let t = 0;
    for (const a of anchors) {
      const dot = Math.min(1, Math.max(-1, dir.dot(a.dir)));
      const ang = Math.acos(dot);
      t += a.p * Math.exp(-(ang * ang) / twoSigma2);
    }
    return t;
  };

  /* ---- fibonacci cells, split cold / hot buckets ---- */
  const golden = Math.PI * (3 - Math.sqrt(5));
  const coldIdx: number[] = [];
  const hotBuckets: number[][] = [[], [], []];
  const temps: number[] = [];
  const dirs: THREE.Vector3[] = [];
  let maxT = 0;
  for (let k = 0; k < CELLS; k++) {
    const y = 1 - (k / (CELLS - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * k;
    const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
    dirs.push(dir);
    const t = temperature(dir);
    temps.push(t);
    if (t > maxT) maxT = t;
  }
  for (let k = 0; k < CELLS; k++) {
    const t = maxT > 0 ? temps[k] / maxT : 0;
    temps[k] = t;
    if (t < 0.5) coldIdx.push(k);
    else if (t < 0.68) hotBuckets[0].push(k);
    else if (t < 0.85) hotBuckets[1].push(k);
    else hotBuckets[2].push(k);
  }

  const cellGeo = new THREE.BoxGeometry(0.085, 0.085, 0.05);
  const dummy = new THREE.Object3D();
  const fillInstances = (mesh: THREE.InstancedMesh, idxs: number[], colorOf: (t: number) => THREE.Color) => {
    idxs.forEach((k, n) => {
      const dir = dirs[k];
      dummy.position.copy(dir).multiplyScalar(1.03);
      dummy.lookAt(dir.clone().multiplyScalar(2));
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      mesh.setColorAt(n, colorOf(temps[k]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    spin.add(mesh);
  };

  const coldMesh = new THREE.InstancedMesh(
    cellGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.35 }),
    Math.max(coldIdx.length, 1),
  );
  const coldLo = new THREE.Color(0x171410);
  const coldHi = new THREE.Color(0x2a2115);
  fillInstances(coldMesh, coldIdx, (t) => coldLo.clone().lerp(coldHi, Math.min(1, t * 2)));

  const hotIntensity = [0.5, 1.0, 1.6];
  const hotShades = [0xb97a28, 0xe08e22, 0xffa02e];
  hotBuckets.forEach((idxs, b) => {
    if (idxs.length === 0) return;
    const mesh = new THREE.InstancedMesh(
      cellGeo,
      new THREE.MeshStandardMaterial({
        color: 0x3a2410,
        emissive: 0xffa02e,
        emissiveIntensity: hotIntensity[b],
        roughness: 0.4,
        metalness: 0.1,
      }),
      idxs.length,
    );
    const shade = new THREE.Color(hotShades[b]);
    fillInstances(mesh, idxs, () => shade.clone());
  });

  /* ---- inner ball + grounding shadow ---- */
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 48, 32),
    new THREE.MeshStandardMaterial({
      map: gridTexture(),
      color: 0xffffff,
      roughness: 0.35,
      metalness: 0.1,
    }),
  );
  spin.add(ball);

  const glow = new THREE.PointLight(0xffa02e, 30, 0, 1.8);
  glow.position.copy(hotDir).multiplyScalar(2.3);
  scene.add(glow);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.45, 40),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.42;
  scene.add(shadow);

  /* ------------------------------------------------------------ lifecycle */

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = new THREE.Clock();
  let raf = 0;
  let running = false;
  let inView = true;
  let tiltX = 0;
  let tiltY = 0;
  let curX = 0;
  let curY = 0;

  const renderFrame = () => {
    const delta = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    spin.rotation.y += delta * 0.096;
    spin.rotation.x = 0.32 + Math.sin(t * 0.4) * 0.08;
    curX += (tiltX - curX) * 0.05;
    curY += (tiltY - curY) * 0.05;
    rig.rotation.x = curX;
    rig.rotation.y = curY;
    renderer.render(scene, camera);
  };
  const loop = () => {
    if (!running) return;
    renderFrame();
    raf = requestAnimationFrame(loop);
  };
  const sync = () => {
    const should = inView && !document.hidden && !reduced;
    if (should && !running) {
      running = true;
      loop();
    } else if (!should && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  };

  const onPointer = (e: PointerEvent) => {
    const r = mount.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    tiltY = ((e.clientX - r.left) / r.width - 0.5) * 0.24;
    tiltX = ((e.clientY - r.top) / r.height - 0.5) * 0.24;
  };
  const onPointerLeave = () => {
    tiltX = 0;
    tiltY = 0;
  };
  if (!reduced) {
    mount.addEventListener("pointermove", onPointer);
    mount.addEventListener("pointerleave", onPointerLeave);
  }

  const resize = () => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (reduced) {
      spin.rotation.x = 0.32;
      renderer.render(scene, camera);
    }
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(mount);

  const io = new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting;
      sync();
    },
    { threshold: 0.05 },
  );
  io.observe(mount);

  const onVisibility = () => sync();
  document.addEventListener("visibilitychange", onVisibility);

  if (reduced) {
    spin.rotation.x = 0.32;
    renderer.render(scene, camera);
  } else {
    sync();
  }

  return () => {
    running = false;
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    mount.removeEventListener("pointermove", onPointer);
    mount.removeEventListener("pointerleave", onPointerLeave);
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.map) std.map.dispose();
        m.dispose();
      }
      const inst = obj as THREE.InstancedMesh;
      if (inst.isInstancedMesh) inst.dispose();
    });
    renderer.dispose();
    renderer.domElement.remove();
  };
}

/* --------------------------------------------------------------- fallback */

function BallFallback({
  matrix,
  home,
  away,
}: {
  matrix: number[][];
  home?: string;
  away?: string;
}) {
  const max = Math.max(...matrix.flat(), 0);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
      <div
        className="grid w-full max-w-sm"
        style={{
          gridTemplateColumns: `repeat(${matrix.length || 1}, minmax(0, 1fr))`,
          gap: 3,
        }}
        role="img"
        aria-label="A football made of data cells. The brightest cells are the most likely scores."
      >
        {matrix.map((row, i) =>
          row.map((v, j) => (
            <div
              key={`${i}-${j}`}
              className="flex aspect-square items-center justify-center rounded-[3px] font-mono text-[10px]"
              style={heatStyle(v, max)}
            >
              {Math.round(v * 100)}
            </div>
          )),
        )}
      </div>
      {home && away && (
        <p className="mt-4 text-[13px] text-mid-gray">
          Score matrix, {home} vs {away}.
        </p>
      )}
    </div>
  );
}
