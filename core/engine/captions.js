// One-word captions and white flashes, built from the word timings and the edit plan.
// Loaded as a classic script after story/timing.js and story/plan.js.
(function () {
  const T = window.STORY_TIMING;
  const P = window.STORY_PLAN;
  const tl = gsap.timeline({ paused: true });
  const box = document.getElementById("captions");
  const names = new Set(["i", ...(P.names || []).map((n) => n.toLowerCase())]);
  T.words.forEach((w, i) => {
    const line = T.lines[w.line];
    const bare = w.w.replace(/[.,!]/g, "");
    if (!bare) return;
    const key = bare.replace(/[^A-Za-z]/g, "").toLowerCase();
    const isName = names.has(key) || names.has(key.replace(/s$/, ""));
    const el = document.createElement("span");
    el.className = "word" + (line.big.some((b) => b.toLowerCase() === key) ? " big" : "");
    el.textContent = isName ? bare : bare.toLowerCase();
    box.appendChild(el);
    const next = T.words[i + 1];
    const off = next ? Math.min(next.s, w.e + 0.45) : w.e + 0.5;
    tl.set(el, { opacity: 1 }, w.s);
    tl.fromTo(el, { scale: 0.35 }, { scale: 1, duration: 0.13, ease: "back.out(2.6)" }, w.s);
    tl.set(el, { opacity: 0 }, Math.max(off, w.s + 0.08));
  });
  (P.flashes || []).forEach((t) => {
    tl.set("#flash", { opacity: 0.7 }, t);
    tl.to("#flash", { opacity: 0, duration: 0.22, ease: "power2.out" }, t + 0.001);
  });
  tl.set({}, {}, P.duration);
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
})();
