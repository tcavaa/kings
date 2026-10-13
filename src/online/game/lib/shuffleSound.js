// The shuffle sound played when a new hand is dealt.
//
// The deal arrives on a socket event, outside any tap, and iOS only lets an
// <audio> element play there once that same element has played inside a tap.
// So one element is built ahead of time and played muted on the player's next
// tap ("primed"); the deal then replays that element instead of a new Audio().

let el = null;
let stage = "idle"; // idle → priming → ready
let playWhenPrimed = false;
let stopListening = null;

function element() {
  if (!el && typeof Audio !== "undefined") {
    el = new Audio("/sounds/shuffle.mp3");
    // Downloaded by the priming play, not on page load.
    el.preload = "none";
    el.volume = 0.5;
  }
  return el;
}

function prime() {
  const a = element();
  if (!a || stage !== "idle") return;
  stage = "priming";
  // Muted until a real play: unmuting here could make the prime audible.
  a.muted = true;
  let p;
  try {
    p = a.play();
  } catch {
    stage = "idle";
    return;
  }
  Promise.resolve(p)
    .then(() => {
      stage = "ready";
      stopListening?.();
      if (playWhenPrimed) {
        // A deal landed while the prime was in flight: let it play out loud.
        playWhenPrimed = false;
        a.currentTime = 0;
        a.muted = false;
        return;
      }
      a.pause();
      a.currentTime = 0;
    })
    .catch(() => {
      // Not allowed yet — the next tap tries again.
      stage = "idle";
    });
}

const GESTURES = ["pointerdown", "keydown", "touchend"];

/**
 * Prime the element on the player's taps until one succeeds. Returns a
 * function that stops listening (safe to call more than once).
 */
export function armShuffleSound() {
  if (typeof window === "undefined" || stage === "ready") return () => {};
  stopListening?.();
  const onGesture = () => prime();
  const stop = () => {
    GESTURES.forEach((type) => window.removeEventListener(type, onGesture, true));
    if (stopListening === stop) stopListening = null;
  };
  GESTURES.forEach((type) => window.addEventListener(type, onGesture, true));
  stopListening = stop;
  return stop;
}

export function playShuffleSound() {
  const a = element();
  if (!a) return;
  if (stage === "priming") {
    playWhenPrimed = true;
    return;
  }
  try {
    a.muted = false;
    a.currentTime = 0;
    Promise.resolve(a.play())
      .then(() => {
        // Played outside a tap, so this browser needs no priming.
        if (stage === "idle") {
          stage = "ready";
          stopListening?.();
        }
      })
      .catch(() => {});
  } catch {
    /* no sound is fine */
  }
}
