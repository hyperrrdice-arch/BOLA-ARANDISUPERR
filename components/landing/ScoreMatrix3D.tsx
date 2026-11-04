"use client";

/**
 * SCORE MATRIX 3D — objek tanda tangan landing: matriks probabilitas skor
 * sebuah laga dibentuk jadi balok kaca 3D (three VANILLA, bukan R3F).
 *
 * Anggaran performa (wajib, bukan hiasan):
 * - pixelRatio dibatasi min(devicePixelRatio, 2); seluler 1.5.
 * - Loop render berhenti saat elemen di luar viewport (IntersectionObserver)
 *   dan saat tab tersembunyi (visibilitychange).
 * - prefers-reduced-motion: satu frame statis, tanpa loop, tanpa paralaks.
 * - Tanpa post-processing; geometri/material/renderer di-dispose saat unmount.
 * - WebGL gagal → fallback heatmap 2D statis dari matriks yang sama.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { heatStyle, MicroLabel } from "../ui";

interface Props {
  /** Matriks 6x6 ternormalisasi 0..1 (baris = gol kandang, kolom = gol tandang). */
  matrix: number[][];
  home: string;
  away: string;
}

export default function ScoreMatrix3D({ matrix, home, away }: Props) {
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

  if (failed) return <MatrixFallback matrix={matrix} home={home} away={away} />;

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full"
      role="img"
      aria-label={`Visualisasi 3D matriks skor ${home} melawan ${away}`}
    />
  );
}

/* ------------------------------------------------------------------ scene */

function initScene(mount: HTMLDivElement, matrix: number[][]): () => void {
  const size = matrix.length;
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(6.6, 6.4, 8.8);
  camera.lookAt(0, 0.6, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const dprCap = window.innerWidth < 768 ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  mount.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffe9c9, 0.55));
  const sun = new THREE.DirectionalLight(0xfff0da, 1.5);
  sun.position.set(5, 9, 4);
  scene.add(sun);

  const rig = new THREE.Group();
  const spin = new THREE.Group();
  rig.add(spin);
  scene.add(rig);

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(size + 0.7, 0.14, size + 0.7),
    new THREE.MeshStandardMaterial({ color: 0x151310, roughness: 0.9, metalness: 0.05 }),
  );
  slab.position.y = -0.07;
  spin.add(slab);

  const grid = new THREE.GridHelper(size, size, 0x3a352b, 0x26231e);
  grid.position.y = 0.012;
  const gridMat = grid.material as THREE.LineBasicMaterial;
  gridMat.transparent = true;
  gridMat.opacity = 0.5;
  spin.add(grid);

  // Dua sel tertinggi berpendar amber; sisanya kaca gelap.
  const flat = matrix
    .flatMap((row, i) => row.map((v, j) => ({ v, i, j })))
    .sort((a, b) => b.v - a.v);
  const hot = new Set(flat.slice(0, 2).map(({ i, j }) => `${i}:${j}`));

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2a251c,
    roughness: 0.28,
    metalness: 0.15,
    transparent: true,
    opacity: 0.94,
  });
  const hotMat = new THREE.MeshStandardMaterial({
    color: 0x4a2c07,
    emissive: 0xffa02e,
    emissiveIntensity: 1.15,
    roughness: 0.4,
    metalness: 0.05,
  });

  const center = (size - 1) / 2;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const v = matrix[i]?.[j] ?? 0;
      const h = 0.12 + v * 3.1;
      const geo = new THREE.BoxGeometry(0.8, h, 0.8);
      const bar = new THREE.Mesh(geo, hot.has(`${i}:${j}`) ? hotMat : glassMat);
      bar.position.set(j - center, h / 2 + 0.01, i - center);
      spin.add(bar);
    }
  }

  const top = flat[0];
  if (top) {
    const glow = new THREE.PointLight(0xffa02e, 26, 0, 1.8);
    glow.position.set(top.j - center, 3.6, top.i - center);
    spin.add(glow);
  }

  /* ------------------------------------------------------------ loop hidup */

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
    spin.rotation.y += delta * 0.12;
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
    tiltY = ((e.clientX - r.left) / r.width - 0.5) * 0.22;
    tiltX = ((e.clientY - r.top) / r.height - 0.5) * 0.12;
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
    if (reduced) renderer.render(scene, camera);
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
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    renderer.dispose();
    renderer.domElement.remove();
  };
}

/* --------------------------------------------------------------- fallback */

function MatrixFallback({
  matrix,
  home,
  away,
}: {
  matrix: number[][];
  home: string;
  away: string;
}) {
  return (
    <div className="panel-flat absolute inset-0 flex flex-col p-4">
      <MicroLabel>
        Matriks skor — {home} vs {away}
      </MicroLabel>
      <div
        className="mt-3 grid flex-1"
        style={{
          gridTemplateColumns: `repeat(${matrix.length}, minmax(0, 1fr))`,
          gap: 3,
        }}
      >
        {matrix.map((row, i) =>
          row.map((v, j) => (
            <div
              key={`${i}-${j}`}
              className="flex items-center justify-center rounded-[2px] font-mono text-[10px]"
              style={heatStyle(v, 1)}
            >
              {Math.round(v * 100)}
            </div>
          )),
        )}
      </div>
      <p className="mt-3 font-mono text-[10px] leading-relaxed text-faint">
        BARIS: GOL {home.toUpperCase()} · KOLOM: GOL {away.toUpperCase()} · ANGKA:
        PANAS RELATIF KE SEL TERTINGGI
      </p>
    </div>
  );
}
