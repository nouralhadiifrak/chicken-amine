/*
 * Spring text: headings (h1–h6) fade in letter by letter on a damped spring.
 * Arabic headings animate word by word so the letters stay joined.
 * Bundled locally, no dependencies. Does nothing when the visitor prefers reduced motion.
 *
 *   SpringText.prepare(el)   split a heading into animation units (hidden until played)
 *   SpringText.play(el)      animate a prepared heading now
 *   SpringText.observe(root) prepare every h1–h6 under root and play each one as it scrolls into view
 */
(function () {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
  // Spring settles in ~0.45 s; the stagger is capped so a whole heading lands in under a second.
  const STIFFNESS = 260;
  const DAMPING = 22;
  const MAX_STAGGER_MS = 420;
  const MAX_STEP_MS = 32;
  const RISE_EM = 0.45;

  let observer = null;

  function prepare(el) {
    if (reduced.matches || !el || el.dataset.stReady === "1") return;
    const text = el.textContent;
    if (!text.trim()) return;
    const byWord = ARABIC.test(text);
    el.setAttribute("aria-label", text.trim());
    const frag = document.createDocumentFragment();
    text.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); return; }
      const word = document.createElement("span");
      word.className = "st-word";
      word.setAttribute("aria-hidden", "true");
      if (byWord) {
        const unit = document.createElement("span");
        unit.className = "st-unit";
        unit.textContent = part;
        word.appendChild(unit);
      } else {
        for (const ch of part) {
          const unit = document.createElement("span");
          unit.className = "st-unit";
          unit.textContent = ch;
          word.appendChild(unit);
        }
      }
      frag.appendChild(word);
    });
    el.textContent = "";
    el.appendChild(frag);
    el.classList.add("st-pending");
    el.dataset.stReady = "1";
  }

  function play(el) {
    if (reduced.matches || !el || el.dataset.stReady !== "1" || el.dataset.stPlayed === "1") return;
    el.dataset.stPlayed = "1";
    const units = Array.from(el.querySelectorAll(".st-unit"));
    const step = Math.min(MAX_STEP_MS, MAX_STAGGER_MS / Math.max(1, units.length - 1));
    const state = units.map((u, i) => ({ u, delay: i * step, x: 0, v: 0, done: false }));
    units.forEach((u) => { u.style.opacity = "0"; u.style.transform = `translateY(${RISE_EM}em)`; });
    el.classList.remove("st-pending");
    let start = null;
    let last = null;

    function frame(now) {
      if (start === null) { start = now; last = now; }
      const dt = Math.min(0.034, (now - last) / 1000);
      last = now;
      let running = false;
      for (const s of state) {
        if (s.done) continue;
        if (now - start < s.delay) { running = true; continue; }
        // Damped spring from 0 to 1.
        const a = STIFFNESS * (1 - s.x) - DAMPING * s.v;
        s.v += a * dt;
        s.x += s.v * dt;
        if (Math.abs(1 - s.x) < 0.002 && Math.abs(s.v) < 0.01) {
          s.done = true;
          s.u.style.opacity = "";
          s.u.style.transform = "";
          continue;
        }
        running = true;
        s.u.style.opacity = String(Math.min(1, Math.max(0, s.x * 1.4)));
        s.u.style.transform = `translateY(${((1 - s.x) * RISE_EM).toFixed(3)}em)`;
      }
      if (running) requestAnimationFrame(frame);
      else el.dataset.stMs = String(Math.round(now - start));
    }
    requestAnimationFrame(frame);
  }

  function observe(root) {
    if (reduced.matches) return;
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          observer.unobserve(e.target);
          play(e.target);
        });
      }, { rootMargin: "0px 0px -8% 0px" });
    }
    (root || document).querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
      if (h.closest("dialog")) return;
      prepare(h);
      // data-st-manual: prepared here, played by the page itself (the hero title plays after the intro).
      if (h.dataset.stPlayed !== "1" && h.dataset.stManual !== "1") observer.observe(h);
    });
  }

  window.SpringText = { prepare, play, observe };
})();
