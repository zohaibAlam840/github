/*
 * The narration layer — captions, a visible cursor, and element highlights.
 *
 * Playwright records the viewport and nothing else. It does not draw the
 * mouse pointer, it has no audio, and it clicks instantly. Straight footage
 * of that is unwatchable: things change with no visible cause and no
 * explanation. So everything a viewer needs is drawn INTO the page before
 * recording starts.
 *
 * The overlay lives in a shadow root with a very high z-index so it cannot
 * be styled, overlapped, or broken by the app's own CSS, and so nothing it
 * adds can ever be mistaken for part of the product.
 */

import type { Page } from "playwright";

/** Identifier for the overlay host element, kept out of the app's namespace. */
const HOST_ID = "__i2i_demo_overlay__";

/**
 * Injects the overlay. Safe to call repeatedly — a navigation destroys the
 * old one, and every helper below re-installs it first, so scenarios never
 * have to think about page lifetime.
 */
export async function installOverlay(page: Page): Promise<void> {
  await page.evaluate((hostId) => {
    if (document.getElementById(hostId)) return;

    const host = document.createElement("div");
    host.id = hostId;
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    document.body.appendChild(host);

    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }

        .title {
          position: fixed; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 18px;
          background: #0d1117; color: #fff; opacity: 0;
          transition: opacity .5s ease;
        }
        .title.on { opacity: 1; }
        .title .chapter {
          font-size: 15px; letter-spacing: .18em; text-transform: uppercase;
          color: #7c93f5; font-weight: 600;
        }
        .title h1 { margin: 0; font-size: 46px; font-weight: 650; letter-spacing: -.02em; }
        .title p { margin: 0; font-size: 19px; color: #9aa4b2; max-width: 640px; text-align: center; }

        /* Caption bar. Bottom-anchored so it never covers what it describes. */
        .caption {
          position: fixed; left: 50%; bottom: 44px; transform: translateX(-50%) translateY(14px);
          max-width: 76%; padding: 14px 22px; border-radius: 12px;
          background: rgba(13,17,23,.94); border: 1px solid rgba(255,255,255,.12);
          color: #fff; font-size: 19px; line-height: 1.45; text-align: center;
          box-shadow: 0 10px 40px rgba(0,0,0,.5);
          opacity: 0; transition: opacity .35s ease, transform .35s ease;
        }
        .caption.on { opacity: 1; transform: translateX(-50%) translateY(0); }
        .caption .step {
          display: inline-block; margin-inline-end: 10px; padding: 2px 9px;
          border-radius: 999px; background: #3d5fe0; font-size: 14px; font-weight: 700;
        }

        /* Drawn cursor. Playwright's video has no real pointer. */
        .cursor {
          position: fixed; width: 22px; height: 22px; margin: -3px 0 0 -3px;
          opacity: 0; transition: opacity .3s ease;
        }
        .cursor.on { opacity: 1; }
        .cursor svg { filter: drop-shadow(0 2px 4px rgba(0,0,0,.55)); }

        .ripple {
          position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px;
          border-radius: 50%; border: 3px solid #3d5fe0; opacity: 0;
        }
        .ripple.go { animation: ripple .5s ease-out; }
        @keyframes ripple {
          from { opacity: .9; transform: scale(.35); }
          to   { opacity: 0;  transform: scale(1.5); }
        }

        /* Highlight ring around the element being talked about. */
        .ring {
          position: fixed; border-radius: 10px; opacity: 0;
          border: 3px solid #3d5fe0;
          box-shadow: 0 0 0 9999px rgba(3,6,14,.55);
          transition: opacity .3s ease, top .3s ease, left .3s ease,
                      width .3s ease, height .3s ease;
        }
        .ring.on { opacity: 1; }
      </style>

      <div class="title" id="title">
        <div class="chapter" id="titleChapter"></div>
        <h1 id="titleText"></h1>
        <p id="titleSub"></p>
      </div>
      <div class="ring" id="ring"></div>
      <div class="caption" id="caption"></div>
      <div class="ripple" id="ripple"></div>
      <div class="cursor" id="cursor">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path d="M5 2l14 10-6.2 1.1L15.4 20l-2.6 1-2.6-6.6L5 18.6z"
                fill="#fff" stroke="#0d1117" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
      </div>`;

    (window as any).__i2iDemo = {
      el: (id: string) => root.getElementById(id)!,
    };
  }, HOST_ID);
}

/** Full-screen chapter card. Gives the viewer a beat before anything moves. */
export async function titleCard(
  page: Page,
  chapter: string,
  title: string,
  subtitle = "",
  holdMs = 2600
): Promise<void> {
  await installOverlay(page);
  await page.evaluate(
    ({ chapter, title, subtitle }) => {
      const d = (window as any).__i2iDemo;
      d.el("titleChapter").textContent = chapter;
      d.el("titleText").textContent = title;
      d.el("titleSub").textContent = subtitle;
      d.el("title").classList.add("on");
    },
    { chapter, title, subtitle }
  );
  await page.waitForTimeout(holdMs);
  await page.evaluate(() => (window as any).__i2iDemo.el("title").classList.remove("on"));
  await page.waitForTimeout(600);
}

/**
 * Shows a caption and holds it long enough to read.
 *
 * The hold is derived from length rather than passed in every time: roughly
 * 190ms per word with a 1.8s floor, which is a comfortable reading pace and
 * stops short captions flashing past.
 */
export async function say(page: Page, text: string, step?: number): Promise<void> {
  await installOverlay(page);
  await page.evaluate(
    ({ text, step }) => {
      const cap = (window as any).__i2iDemo.el("caption");
      cap.innerHTML = step ? `<span class="step">${step}</span>${text}` : text;
      cap.classList.add("on");
    },
    { text, step }
  );
  const words = text.trim().split(/\s+/).length;
  await page.waitForTimeout(Math.max(1800, words * 190));
}

/** Clears the caption — use before a navigation so it does not linger. */
export async function clearCaption(page: Page): Promise<void> {
  await page.evaluate(() => {
    const d = (window as any).__i2iDemo;
    if (d) d.el("caption").classList.remove("on");
  }).catch(() => {});
  await page.waitForTimeout(350);
}

/** Rings an element and dims everything else. */
export async function highlight(page: Page, selector: string): Promise<void> {
  await installOverlay(page);
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return;
  await page.evaluate(
    (b) => {
      const ring = (window as any).__i2iDemo.el("ring");
      ring.style.top = `${b.y - 6}px`;
      ring.style.left = `${b.x - 6}px`;
      ring.style.width = `${b.width + 12}px`;
      ring.style.height = `${b.height + 12}px`;
      ring.classList.add("on");
    },
    box
  );
  await page.waitForTimeout(500);
}

export async function clearHighlight(page: Page): Promise<void> {
  await page.evaluate(() => {
    const d = (window as any).__i2iDemo;
    if (d) d.el("ring").classList.remove("on");
  }).catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * Moves the drawn cursor to a point in a visible arc, rather than teleporting.
 *
 * Eye-tracking aside, the reason is simple: a pointer that jumps gives the
 * viewer no chance to follow what is about to be clicked.
 */
export async function moveTo(page: Page, x: number, y: number, steps = 26): Promise<void> {
  await installOverlay(page);
  await page.evaluate(
    async ({ x, y, steps }) => {
      const cur = (window as any).__i2iDemo.el("cursor");
      cur.classList.add("on");
      const from = {
        x: parseFloat(cur.style.left || "0") || window.innerWidth / 2,
        y: parseFloat(cur.style.top || "0") || window.innerHeight / 2,
      };
      for (let i = 1; i <= steps; i++) {
        // Ease-in-out so it accelerates away and settles on arrival.
        const t = i / steps;
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        cur.style.left = `${from.x + (x - from.x) * e}px`;
        cur.style.top = `${from.y + (y - from.y) * e}px`;
        await new Promise((r) => setTimeout(r, 14));
      }
    },
    { x, y, steps }
  );
}

/**
 * Moves to an element, shows a click ripple, then actually clicks it.
 *
 * Always use this instead of locator.click() in a scenario: a real click
 * with no visible pointer looks like the page changed by itself.
 */
export async function click(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`demo: nothing to click for selector ${selector}`);

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await moveTo(page, x, y);
  await page.waitForTimeout(220);

  await page.evaluate(
    ({ x, y }) => {
      const rip = (window as any).__i2iDemo.el("ripple");
      rip.style.left = `${x}px`;
      rip.style.top = `${y}px`;
      rip.classList.remove("go");
      void rip.offsetWidth;   // restart the animation
      rip.classList.add("go");
    },
    { x, y }
  );
  await page.waitForTimeout(160);
  await target.click();
  await page.waitForTimeout(400);
}

/** Types into a field at human speed, with the cursor parked on it. */
export async function type(page: Page, selector: string, text: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    await moveTo(page, box.x + 24, box.y + box.height / 2);
    await page.waitForTimeout(150);
  }
  await target.click();
  await target.fill("");
  await target.type(text, { delay: 65 });
  await page.waitForTimeout(350);
}

/** A still beat. Use after something changes so the viewer can take it in. */
export async function beat(page: Page, ms = 1200): Promise<void> {
  await page.waitForTimeout(ms);
}
