"use client";

import { BannerPattern } from "./banner-pattern/banner-pattern";

const CORNER_MASK =
  "radial-gradient(ellipse 85% 85% at 100% 100%, #000 0%, #000 38%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0) 80%)";

export function PageBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ WebkitMaskImage: CORNER_MASK, maskImage: CORNER_MASK }}
    >
      <BannerPattern
        colors={["#050a07", "#0e5f45", "#2f9c73", "#00e599", "#d9ffe9", "#0b7d54"]}
        speed={1.1}
        cell={7}
        dotSize={0.14}
        haze={0.1}
        jitter={1}
      />
    </div>
  );
}
