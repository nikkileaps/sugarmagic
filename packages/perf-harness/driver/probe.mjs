// Scratch probe: connect, run a step, dump DOM, HARD EXIT. One at a time.
import { chromium } from "playwright-core";

const PORT = process.env.PORT ?? "9223";
const STEP = process.env.STEP ?? "landing";
const wd = setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, Number(process.env.WD_MS ?? 25000));

function summarize() {
  const txt = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 600);
  const clickable = [...document.querySelectorAll("button,[role=button],[role=option],[role=menuitem],a,li")]
    .map((b) => (b.textContent || "").trim())
    .filter(Boolean)
    .slice(0, 40);
  const canvases = document.querySelectorAll("canvas").length;
  return { canvases, txt, clickable };
}

try {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const pages = b.contexts()[0].pages();
  const match = process.env.MATCH ?? "5173";
  const page = pages.find((p) => p.url().includes(match)) ?? pages[0];
  await page.waitForTimeout(800);

  if (STEP === "capture") {
    const res = await page.evaluate(async () => {
      if (typeof globalThis.__smperfRun !== "function") return { error: "__smperfRun missing" };
      return await globalThis.__smperfRun();
    });
    console.log(res?.table ? "\n" + res.table : JSON.stringify(res));
  } else if (STEP === "click") {
    const label = process.env.LABEL ?? "";
    const clicked = await page.evaluate((needle) => {
      const el = [...document.querySelectorAll("button,[role=button],[role=option],[role=menuitem],a,li")]
        .find((b) => (b.textContent || "").toLowerCase().includes(needle.toLowerCase()));
      if (el) { el.click(); return (el.textContent || "").trim(); }
      return null;
    }, label);
    await page.waitForTimeout(1800);
    console.log(JSON.stringify({ clicked, ...(await page.evaluate(summarize)) }));
  } else {
    console.log(JSON.stringify(await page.evaluate(summarize)));
  }
  clearTimeout(wd);
  process.exit(0);
} catch (e) {
  console.log("ERR: " + e.message.split("\n")[0]);
  process.exit(1);
}
