import { useEffect, useState } from "react";
import c1 from "@/assets/bg-cosmic-1.webp";
import r1 from "@/assets/bg-robot-1.webp";
import c2 from "@/assets/bg-cosmic-2.webp";
import r2 from "@/assets/bg-robot-2.webp";
import t1 from "@/assets/bg-tech-1.webp";
import c3 from "@/assets/bg-cosmic-3.webp";

const IMAGES = [c1, r1, c2, r2, t1, c3];

export function TechBackground() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % IMAGES.length), 7000);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      {IMAGES.map((src, idx) => (
        <img
          key={src}
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-[2000ms] ease-in-out"
          style={{ opacity: idx === i ? 0.85 : 0 }}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-b from-background/25 via-background/40 to-background/60" />
    </div>
  );
}
