import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Actor } from "./actors";
import { ASSETS, loadGLB, WORLD_SCALE } from "./room";

// A small turntable of the player's 3D look for the profile form: the seated
// body for the chosen gender, with the uploaded head when there is one.
export default function CharacterPreview({ gender, head, onError }) {
  const host = useRef(null);
  const view = useRef(null);
  useEffect(() => {
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff3e0, 0x6a5040, 2.2));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
    key.position.set(1.5, 3, 3);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    camera.position.set(0, 1.75, 2.6);
    camera.lookAt(0, 1.55, 0);
    // The club armchair, so the seated pose reads.
    loadGLB(`${ASSETS}/room.glb`)
      .then((gltf) => {
        const chair = gltf.scene.getObjectByName("chair_left")?.clone();
        if (!chair || !view.current) return;
        chair.position.set(0, 0, 0);
        chair.rotation.set(0, 0, 0);
        chair.scale.setScalar(WORLD_SCALE);
        view.current.turntable.add(chair);
      })
      .catch(() => {});
    const turntable = new THREE.Group();
    scene.add(turntable);
    const actor = new Actor(
      turntable,
      { position: [0, 0, 0], rotation: 0, slot: 0 },
      { seat: 0 },
      { gender, head },
      (msg) => view.current?.onError?.(msg),
    );
    view.current = { actor, turntable, onError };
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      // Sized by CSS: an inline canvas width would feed back into the layout.
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let before = performance.now(),
      time = 0;
    renderer.setAnimationLoop((now) => {
      const dt = Math.min((now - before) / 1000, 0.05);
      before = now;
      time += dt;
      if (!still) turntable.rotation.y = Math.sin(time * 0.5) * 0.6;
      actor.update(time, still ? 0 : dt, {
        active: false,
        count: 0,
        lookAt: camera.position,
      });
      renderer.render(scene, camera);
    });
    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      actor.destroy();
      renderer.dispose();
      renderer.domElement.remove();
      view.current = null;
    };
    // The look changes below; the scene is built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!view.current) return;
    view.current.onError = onError;
    view.current.actor.setLook({ gender, head });
  }, [gender, head, onError]);
  return (
    <div
      ref={host}
      className="k-character-preview"
      role="img"
      aria-label={`3D პერსონაჟი — ${gender === "female" ? "ქალი" : "კაცი"}${head ? ", ატვირთული სახით" : ""}`}
    />
  );
}
