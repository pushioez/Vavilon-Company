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
function update() {
  const pos = blockPos();
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

  // scroll rail (uses cached maxScroll)
  if (railFill) railFill.style.height = (maxScroll > 0 ? clamp(window.scrollY / maxScroll, 0, 1) * 100 : 0).toFixed(2) + "%";

  // status readout
  const b = clamp(Math.round(pos), 0, STATUS.length - 1);
  if (statusText) statusText.textContent = STATUS[b];
}

let ticking = false;
function onScroll() {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }
}
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
