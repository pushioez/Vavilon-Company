/* ============================================================
   VAVILON — monochrome sci-fi scroll-story.
   Five rendered artifacts (a–e) levitate over a constant fog and
   are flown in/out via CSS 3D transforms, driven by scroll.
   No WebGL — pure DOM. Block 0 = intro loader (kept).
============================================================ */

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

/* ------------------------------------------------------------
   INTRO loader — keep the logo on screen as a REAL loading screen.
   We preload the assets the first view actually needs (logo, the
   mountain backdrop, the first artifact) plus the web fonts, show a
   progress bar, then reveal. A hard timeout guarantees we never hang
   on a slow connection (this was the iPad "loads badly" problem:
   the old code revealed on a fixed timer, before the images were ready).
------------------------------------------------------------ */
const intro = document.getElementById("intro");
const introFill = document.getElementById("introFill");
let revealed = false;
function revealSite() {
  if (revealed) return;
  revealed = true;
  measure();
  update();
  // let the logo's entrance animation breathe for a beat before the wipe
  setTimeout(() => { intro?.classList.add("is-done"); update(); }, prefersReduced ? 60 : 520);
}
(function bootLoader() {
  const assets = ["assets/logo.png", "assets/mountains.jpg", "assets/a.jpg"];
  let loaded = 0;
  const bump = () => {
    loaded++;
    if (introFill) introFill.style.width = Math.round((loaded / assets.length) * 100) + "%";
  };
  const one = (src) => new Promise((res) => {
    const im = new Image();
    im.onload = im.onerror = () => { bump(); res(); };
    im.src = src;
  });
  const fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  const ready = Promise.all([...assets.map(one), fonts]);
  const cap = new Promise((res) => setTimeout(res, prefersReduced ? 400 : 6000));
  Promise.race([ready, cap]).then(revealSite);
})();

/* ------------------------------------------------------------
   ARTIFACT STAGE — scroll-driven enter/exit per block
------------------------------------------------------------ */
const panels = Array.from(document.querySelectorAll("main .panel"));
const arts = Array.from(document.querySelectorAll(".art"));
const railFill = document.getElementById("railFill");
const statusText = document.getElementById("statusText");
const ringImg = document.querySelector(".art--e img");
const STATUS = ["01 · OFFER", "02 · IDEA", "03 · PROCESS", "04 · BUILD", "05 · WORKS", "06 · CONTACT"];

/* cached geometry — measured on load/resize/font-ready instead of every
   scroll frame, so update() never forces a synchronous reflow */
let centers = [];
let maxScroll = 0;
let viewH = 0;   // cached viewport height — frozen against mobile address-bar
let viewW = 0;   // toggles so the scroll math doesn't jump while scrolling
function measure() {
  viewH = window.innerHeight;
  viewW = window.innerWidth;
  centers = panels.map((p) => p.offsetTop + p.offsetHeight / 2);
  maxScroll = document.documentElement.scrollHeight - viewH;
}

/* continuous block position in [0 .. n-1]; integer i = section i centered */
function blockPos() {
  const n = centers.length;
  if (!n) return 0;
  const mid = window.scrollY + viewH / 2;
  if (mid <= centers[0]) return 0;
  if (mid >= centers[n - 1]) return n - 1;
  for (let i = 0; i < n - 1; i++) {
    if (mid >= centers[i] && mid < centers[i + 1]) {
      return i + (mid - centers[i]) / (centers[i + 1] - centers[i]);
    }
  }
  return n - 1;
}

const tY = (v) => `translate3d(0,${v}%,0)`;

/* state for one artifact, given mode ('enter' from below → centered,
   or 'exit' centered → off) and progress t (0..1) */
function roleState(blk, mode, t) {
  switch (blk) {
    case 1: // a.jpg — arctic offer: only exits (scale down + fade)
      if (mode === "enter") return { o: 1, tf: "scale(1)" };
      return { o: 1 - t, tf: `scale(${lerp(1, 0.92, t)})` };
    case 2: // b.jpg — crystal + seal
    case 3: // c.jpg — stone "IP"
      if (mode === "enter") return { o: t, tf: tY(lerp(120, 0, t)) };
      return { o: 1 - t, tf: tY(lerp(0, -130, t)) };
    case 4: // d.jpg — ice cube: enters from below, "dissolves" (scale up + fade) on exit.
      // No blur() here: animating a filter on a full-screen image re-rasterised
      // every scroll frame, which janked this transition on both up- and down-scroll.
      if (mode === "enter") return { o: t, tf: tY(lerp(120, 0, t)) };
      return { o: 1 - t, tf: `scale(${lerp(1, 1.14, t)})` };
    case 5: // e.jpg — metal ring: rises + un-tilts on enter, flies up on exit
      if (mode === "enter") return { o: t, tf: `translate3d(0,${lerp(80, 0, t)}%,0) rotate(${lerp(-15, 0, t)}deg)` };
      return { o: 1 - t, tf: tY(lerp(0, -150, t)) };
    case 6: // a.jpg again — fog crossfades back to arctic
      if (mode === "enter") return { o: t, tf: `scale(${lerp(1.06, 1, t)})` };
      return { o: 1, tf: "scale(1)" };
  }
  return { o: 0, tf: "none" };
}

/* skip DOM writes when an artifact's state hasn't changed — most frames only
   2 of the 6 layers actually move, the rest are parked */
const lastState = new Map();
function applyState(el, st) {
  const o = st.o.toFixed(3);
  const tf = st.tf;
  const fl = st.fl || "none";
  const prev = lastState.get(el);
  if (prev && prev.o === o && prev.tf === tf && prev.fl === fl) return;
  el.style.opacity = o;
  el.style.transform = tf;
  el.style.filter = fl;
  lastState.set(el, { o, tf, fl });
}

let lastActive = -1;
let renderPos = 0;          // continuously eased block position the scene is drawn at
let lastRailH = "";
let lastStatus = "";

/* draw the whole scene at a given continuous block position (no easing here) */
function render(pos) {
  const i = Math.floor(pos);
  const frac = pos - i;
  const t = smoothstep(0.18, 0.82, frac); // rest at each block, swap mid-way

  // only runs when the active block changes (not every frame):
  // promote just the 2 transitioning layers, and pause the ring when off-screen
  if (i !== lastActive) {
    for (const el of arts) {
      const idx = +el.dataset.block - 1;
      el.style.willChange = (idx === i || idx === i + 1) ? "transform,opacity" : "auto";
    }
    if (ringImg) ringImg.style.animationPlayState = Math.abs(i - 4) <= 1 ? "running" : "paused";
    lastActive = i;
  }

  for (const el of arts) {
    const blk = +el.dataset.block;       // 1..6
    const idx = blk - 1;                  // section index
    let st;
    if (idx === i) st = roleState(blk, "exit", t);        // active → exiting
    else if (idx === i + 1) st = roleState(blk, "enter", t); // incoming
    else if (idx < i) st = roleState(blk, "exit", 1);     // already gone
    else st = roleState(blk, "enter", 0);                 // parked below
    applyState(el, st);
  }

  // scroll rail — tied to the TRUE scroll position (not the eased one) so it
  // stays accurate. Guarded so a cursor-only frame writes nothing.
  const railH = (maxScroll > 0 ? clamp(window.scrollY / maxScroll, 0, 1) * 100 : 0).toFixed(2) + "%";
  if (railFill && railH !== lastRailH) { railFill.style.height = railH; lastRailH = railH; }

  // status readout
  const b = clamp(Math.round(pos), 0, STATUS.length - 1);
  if (statusText && STATUS[b] !== lastStatus) { statusText.textContent = STATUS[b]; lastStatus = STATUS[b]; }
}

/* snap (no animation) — used on load / resize / reveal where we want the scene
   to be instantly correct rather than easing in from a stale position */
function update() { renderPos = blockPos(); render(renderPos); }

/* ------------------------------------------------------------
   SMOOTH RENDER LOOP
   A single rAF drives both the scene easing and the custom cursor. The scene
   eases toward the scroll-derived target with a frame-rate-independent
   half-life, so fast scrolls feel weighty and crossfades stay buttery instead
   of snapping to each frame's raw scroll value. The loop parks itself the
   moment everything has settled, so an idle page costs nothing.
------------------------------------------------------------ */
const SCENE_HALFLIFE = 0.11;   // seconds — the scene's gap to target halves every 110ms
let running = false;
let rafId = 0;
let lastFrame = 0;
const cursor = { active: false, step: () => false };

function loop(now) {
  const dt = lastFrame ? Math.min(now - lastFrame, 50) : 16.7;
  lastFrame = now;
  let busy = false;

  if (prefersReduced) {
    renderPos = blockPos();
  } else {
    const target = blockPos();
    const k = 1 - Math.pow(2, -dt / 1000 / SCENE_HALFLIFE); // frame-rate independent
    renderPos += (target - renderPos) * k;
    if (Math.abs(target - renderPos) > 0.0006) busy = true; else renderPos = target;
  }
  render(renderPos);

  if (cursor.active && cursor.step(dt)) busy = true;

  if (busy) { rafId = requestAnimationFrame(loop); }
  else { running = false; rafId = 0; lastFrame = 0; }
}
function kick() { if (!running) { running = true; lastFrame = 0; rafId = requestAnimationFrame(loop); } }

function onScroll() { kick(); }
function onResize() {
  // Only re-measure on a real width change (orientation / window resize).
  // Mobile browsers fire resize with a *height-only* change every time the
  // address bar shows/hides during scroll; re-measuring there recomputed the
  // whole scene mid-scroll and made it lurch sideways — so we skip it.
  if (window.innerWidth === viewW) return;
  measure();
  update();
}
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onResize, { passive: true });
arts.forEach((el) => { const img = el.querySelector("img"); if (img && !img.complete) img.addEventListener("load", () => { measure(); update(); }); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); update(); });
measure();
update();

/* ------------------------------------------------------------
   DESIGNER CURSOR — a trailing outline ring + a crisp dot, painted with
   mix-blend-mode:difference so they stay visible over light snow and dark fog
   alike. Fine-pointer (mouse) devices only; touch keeps its native behaviour
   and never pays for this. The ring is eased inside the shared loop above.
------------------------------------------------------------ */
(function customCursor() {
  if (!window.matchMedia || !window.matchMedia("(hover:hover) and (pointer:fine)").matches) return;

  const dot = document.createElement("div"); dot.className = "cursor cursor--dot";
  const ring = document.createElement("div"); ring.className = "cursor cursor--ring";
  document.body.append(ring, dot);
  const root = document.documentElement;
  root.classList.add("has-cursor");

  let mx = window.innerWidth / 2, my = window.innerHeight / 2; // pointer target
  let rx = mx, ry = my;                                        // eased ring
  const RING_HALFLIFE = 0.05;                                  // 50ms — snappier than the scene
  const place = (el, x, y) => { el.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`; };

  cursor.active = true;
  cursor.step = (dt) => {
    const k = prefersReduced ? 1 : 1 - Math.pow(2, -dt / 1000 / RING_HALFLIFE);
    rx += (mx - rx) * k; ry += (my - ry) * k;
    place(ring, rx, ry);
    return Math.abs(mx - rx) > 0.2 || Math.abs(my - ry) > 0.2;
  };

  window.addEventListener("mousemove", (e) => {
    mx = e.clientX; my = e.clientY;
    place(dot, mx, my);                       // dot is instant; ring trails
    if (!root.classList.contains("cursor-on")) root.classList.add("cursor-on");
    kick();
  }, { passive: true });

  // hide when the pointer leaves the window; mousemove re-shows it
  window.addEventListener("mouseout", (e) => { if (!e.relatedTarget) root.classList.remove("cursor-on"); });
  window.addEventListener("blur", () => root.classList.remove("cursor-on"));

  // grow + fill the ring over interactive targets
  const HOT = "a, button, [role='button']";
  document.addEventListener("mouseover", (e) => {
    if (e.target.closest && e.target.closest(HOT)) root.classList.add("cursor-hot");
  });
  document.addEventListener("mouseout", (e) => {
    const to = e.relatedTarget;
    if (e.target.closest && e.target.closest(HOT) && !(to && to.closest && to.closest(HOT)))
      root.classList.remove("cursor-hot");
  });

  // quick press feedback
  window.addEventListener("mousedown", () => root.classList.add("cursor-down"));
  window.addEventListener("mouseup", () => root.classList.remove("cursor-down"));
})();

/* ------------------------------------------------------------
   CONTENT reveal — fade each block in when it becomes active
------------------------------------------------------------ */
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) en.target.classList.add("is-active"); });
}, { threshold: 0.45 });
panels.forEach((p) => io.observe(p));

/* ------------------------------------------------------------
   Ambient sound (synthesized arctic wind) — toggle
------------------------------------------------------------ */
const soundBtn = document.getElementById("soundBtn");
const soundLabel = document.getElementById("soundLabel");
let actx, noiseNode, gain, on = false;
soundBtn?.addEventListener("click", () => {
  on = !on;
  soundBtn.classList.toggle("is-on", on);
  soundBtn.setAttribute("aria-pressed", String(on));
  soundLabel.textContent = on ? "Sound: ON" : "Sound: OFF";
  if (on) startWind(); else stopWind();
});
function startWind() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const bufSize = 2 * actx.sampleRate;
    const buffer = actx.createBuffer(1, bufSize, actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    noiseNode = actx.createBufferSource();
    noiseNode.buffer = buffer; noiseNode.loop = true;
    const lp = actx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 480; lp.Q.value = 0.6;
    const lfo = actx.createOscillator(); lfo.frequency.value = 0.12;
    const lfoGain = actx.createGain(); lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(lp.frequency);
    gain = actx.createGain(); gain.gain.value = 0;
    noiseNode.connect(lp).connect(gain).connect(actx.destination);
    noiseNode.start(); lfo.start();
    gain.gain.linearRampToValueAtTime(0.1, actx.currentTime + 1.2);
  } catch (e) {}
}
function stopWind() {
  if (gain && actx) {
    gain.gain.linearRampToValueAtTime(0, actx.currentTime + 0.6);
    setTimeout(() => { try { noiseNode.stop(); } catch (e) {} }, 700);
  }
}
