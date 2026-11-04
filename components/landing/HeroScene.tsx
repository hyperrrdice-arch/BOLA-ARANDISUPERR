"use client";

/**
 * HERO SCENE — pembungkus client untuk objek 3D hero.
 * next/dynamic dengan ssr:false hanya diizinkan di Client Component
 * (docs Next 16), jadi pemuatan malas three.js tinggal di sini;
 * halaman tetap Server Component. Chunk three tidak masuk bundle awal.
 */
import dynamic from "next/dynamic";

const ScoreMatrix3D = dynamic(() => import("./ScoreMatrix3D"), {
  ssr: false,
  loading: () => (
    <div className="panel-flat absolute inset-0 flex items-center justify-center">
      <div className="mono-loading-bar-container w-44">
        <div className="mono-loading-bar" />
      </div>
    </div>
  ),
});

export default function HeroScene({
  matrix,
  home,
  away,
}: {
  matrix: number[][];
  home: string;
  away: string;
}) {
  return <ScoreMatrix3D matrix={matrix} home={home} away={away} />;
}
