"use client";
import dynamic from "next/dynamic";
const Preview = dynamic(
  () => import("../../../../src/online/game/three/Preview"),
  { ssr: false },
);
export default Preview;
