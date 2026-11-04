"use client";

/**
 * HERO SCENE — client wrapper for the 3D hero object (the data ball).
 * next/dynamic with ssr:false is only allowed in a Client Component
 * (Next 16 docs), so the lazy three.js load lives here and the page
 * stays a Server Component. The three chunk never enters the first bundle.
 */
import dynamic from "next/dynamic";

const DataBall3D = dynamic(() => import("./DataBall3D"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center">
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
  home?: string;
  away?: string;
}) {
  return <DataBall3D matrix={matrix} home={home} away={away} />;
}
