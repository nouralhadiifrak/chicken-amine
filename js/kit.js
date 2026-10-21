/*
 * UI kit (from the AL-OMDA kit): flying emojis, rolling numbers and the cart pop.
 *   Kit.emojiSpree(button, { emoji: "🌮" | ["🌮", "🍟"], onLand })
 *     12 emojis spray out of the button, spin, fall under gravity and fade; the button
 *     squashes, then onLand() runs as the burst peaks (bump the cart there).
 *   Kit.roll(node, 65)  /  Kit.setMoney(node, 65, "DH")
 *     Odometer: changed digits slide out and the new ones roll in with a blur,
 *     upwards when the number grows, downwards when it shrinks.
 *   Kit.bump(node)  scale pop, used on the cart button.
 * All animations use the Web Animations API and are skipped for prefers-reduced-motion.
 * The options pop-up of the kit is built into app.js (sizes, choices and sauces as pills).
 */
window.Kit = (() => {
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || !Element.prototype.animate;
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
    });
    node.append(...children.flat().filter((c) => c != null && c !== false));
    return node;
  };

  // 1. Flying emojis. `emoji` may be a list: each particle picks the next one.
  function emojiSpree(origin, { emoji, src, count = 12, onLand } = {}) {
    if (!origin || !origin.isConnected || reduce()) {
      onLand?.();
      return;
    }
    const list = [].concat(emoji);
    const box = origin.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const gravity = 900; // px/s²

    origin.animate(
      [{ transform: "scale(1)" }, { transform: "scale(0.82)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }],
      { duration: 380, easing: "ease-out" }
    );

    for (let i = 0; i < count; i++) {
      const node = src
        ? el("img", { class: "spree spree--img", src, alt: "", "aria-hidden": "true" })
        : el("span", { class: "spree", "aria-hidden": "true" }, list[i % list.length]);
      node.style.left = `${cx}px`;
      node.style.top = `${cy}px`;
      document.body.append(node);

      // Mostly upward, fanned out to both sides.
      const angle = (-90 + (Math.random() * 2 - 1) * 70) * (Math.PI / 180);
      const speed = 260 + Math.random() * 260; // px/s
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const spin = (Math.random() * 2 - 1) * 540;
      const size = 0.7 + Math.random() * 0.7;
      const duration = 900 + Math.random() * 500;
      const secs = duration / 1000;

      const frames = [];
      for (let f = 0; f <= 10; f++) {
        const p = f / 10;
        const time = secs * p;
        const x = vx * time;
        const y = vy * time + 0.5 * gravity * time * time;
        const grow = p < 0.15 ? 0.3 + (p / 0.15) * 0.7 : 1;
        frames.push({
          transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${spin * p}deg) scale(${size * grow})`,
          opacity: p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3,
          offset: p,
        });
      }
      node
        .animate(frames, { duration, easing: "linear", delay: i * 12, fill: "forwards" })
        .finished.then(() => node.remove());
    }
    if (onLand) setTimeout(onLand, 260);
  }

  // Scale pop, e.g. on the cart button when something lands in it.
  function bump(node) {
    if (!node) return;
    node.classList.remove("bump");
    void node.offsetWidth; // restart the animation
    node.classList.add("bump");
  }

  // 2. Odometer-style number. `from` sets the starting value for a node that was just created.
  function roll(node, value, from) {
    const next = String(value);
    if (from != null && node.dataset.v == null) setDigits(node, String(from));
    const prev = node.dataset.v;
    if (prev === next) return;
    node.dataset.v = next;
    node.setAttribute("aria-label", next);
    const dir = prev == null || reduce() ? 0 : Number(next) >= Number(prev) ? 1 : -1;
    const old = [...node.children].map((c) => c.dataset.ch);
    const cells = [...next].map((ch, i) => {
      const before = old[old.length - next.length + i];
      const cell = el("span", { class: "roll__cell", dataset: { ch } }, el("span", { class: "roll__ch" }, ch));
      if (dir && before !== ch) {
        const delay = (next.length - 1 - i) * 40;
        if (before != null) {
          const out = el("span", { class: "roll__ch roll__ch--out", "aria-hidden": "true" }, before);
          cell.append(out);
          out
            .animate(
              [
                { transform: "translateY(0)", opacity: 1, filter: "blur(0)" },
                { transform: `translateY(${-dir * 100}%)`, opacity: 0, filter: "blur(3px)" },
              ],
              { duration: 320, delay, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
            )
            .finished.then(() => out.remove());
        }
        cell.firstChild.animate(
          [
            { transform: `translateY(${dir * 100}%)`, opacity: 0, filter: "blur(3px)" },
            { transform: "translateY(0)", opacity: 1, filter: "blur(0)" },
          ],
          { duration: 520, delay, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "backwards" }
        );
      }
      return cell;
    });
    node.replaceChildren(...cells);
  }

  function setDigits(node, text) {
    node.dataset.v = text;
    node.replaceChildren(
      ...[...text].map((ch) => el("span", { class: "roll__cell", dataset: { ch } }, el("span", { class: "roll__ch" }, ch)))
    );
  }

  // "65 DH" with a rolling number and a static currency. `node` gets class "money".
  function setMoney(node, amount, currency = "DH", from) {
    node.classList.add("money");
    let num = node.querySelector(".roll");
    let cur = node.querySelector(".money__cur");
    if (!num) {
      num = el("span", { class: "roll" });
      cur = el("span", { class: "money__cur" });
      node.replaceChildren(num, " ", cur);
    }
    cur.textContent = currency;
    roll(num, amount, from);
  }

  return { emojiSpree, bump, roll, setMoney };
})();
