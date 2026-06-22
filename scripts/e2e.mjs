/* Headless end-to-end check of the built app. Drives the real UI in Chromium,
 * asserts the graph renders for both datasets, exercises a few interactions,
 * and writes screenshots. Run after `pnpm run build`.                        */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readdir, unlink } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const PORT = 5180;
const URL = `http://localhost:${PORT}/`;
const SHOT_DIR = process.env.SHOT_DIR || "/tmp/shots";
const CHROME = "/usr/bin/chromium";

const results = [];
const fail = (m) => {
  console.error("ASSERT FAIL:", m);
  results.push({ ok: false, m });
};
const ok = (m) => results.push({ ok: true, m });
const assert = (cond, m) => (cond ? ok(m) : fail(m));

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error("preview server did not start");
}

const server = spawn(
  "node_modules/.bin/vite",
  ["preview", "--port", String(PORT), "--strictPort"],
  { stdio: "ignore" },
);

let browser;
const pageErrors = [];
try {
  await waitServer();
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));

  // ---- landing ----
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.screenshot({ path: `${SHOT_DIR}/01-landing.png` });
  assert(await page.$(".dropzone"), "landing renders dropzone");

  // ---- load Neverwas example ----
  await page.$$eval(
    ".example-card",
    (els, label) => {
      const el = els.find((e) => e.textContent.includes(label));
      if (!el) throw new Error("example not found: " + label);
      el.click();
    },
    "Neverwas",
  );
  await page.waitForSelector(".wizard", { timeout: 8000 });
  await sleep(300);
  await page.screenshot({ path: `${SHOT_DIR}/02-wizard.png` });
  const previewText = await page.$eval(".preview-stats", (e) => e.textContent);
  assert(/8\s*nodes/.test(previewText) && /5\s*edges/.test(previewText), `wizard preview: ${previewText.trim()}`);

  // ---- build graph ----
  await page.click(".btn-primary");
  await page.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0, { timeout: 10000 });
  await sleep(900);
  await page.screenshot({ path: `${SHOT_DIR}/03-neverwas-graph.png` });
  const nw = await page.evaluate(() => ({
    n: window.__cy.nodes().length,
    e: window.__cy.edges().length,
    report: window.__nevergraph().graph.report,
  }));
  assert(nw.n === 8, `neverwas nodes = ${nw.n} (want 8)`);
  assert(nw.e === 5, `neverwas edges = ${nw.e} (want 5)`);
  assert(nw.report.danglingRefs.length === 0, `neverwas dangling = ${nw.report.danglingRefs.length}`);

  // ---- stabilise with a static layout before position-sensitive checks ----
  // (default layout is now live physics, where nodes keep drifting).
  await page.evaluate(() => {
    const sel = document.querySelectorAll(".toolbar-mid select")[0];
    sel.value = "fcose";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(1300);

  // ---- click a node -> detail panel ----
  const pos = await page.evaluate(() => {
    const n = window.__cy.nodes().sort((a, b) => b.degree() - a.degree()).first();
    const rp = n.renderedPosition();
    const rect = document.querySelector(".cy").getBoundingClientRect();
    return { x: rect.left + rp.x, y: rect.top + rp.y };
  });
  await page.mouse.click(pos.x, pos.y);
  await sleep(300);
  const detailTitle = await page.$eval(".detail-title", (e) => e.textContent).catch(() => "");
  assert(!!detailTitle, `detail panel shows title: "${detailTitle}"`);
  await page.screenshot({ path: `${SHOT_DIR}/04-detail.png` });

  // ---- hierarchy layout ----
  await page.evaluate(() => {
    const sel = document.querySelectorAll(".toolbar-mid select")[0];
    sel.value = "dagre";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(800);
  await page.screenshot({ path: `${SHOT_DIR}/05-dagre.png` });

  // ---- colour by a facet ----
  await page.evaluate(() => {
    const sel = document.querySelectorAll(".toolbar-mid select")[1];
    sel.value = "asset";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(300);
  const legendText = await page.$eval(".legend", (e) => e.textContent);
  assert(/asset/i.test(legendText), `legend reflects colour-by asset`);
  await page.screenshot({ path: `${SHOT_DIR}/06-colorby.png` });

  // ---- independent shape + pattern channels (colour stays = asset) ----
  await page.evaluate(() => {
    const sels = document.querySelectorAll(".toolbar-mid select");
    sels[2].value = "type"; // Shape
    sels[2].dispatchEvent(new Event("change", { bubbles: true }));
    sels[3].value = "type"; // Pattern
    sels[3].dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(400);
  const enc = await page.evaluate(() => {
    const ns = window.__cy.nodes();
    const byShape = {};
    ns.forEach((n) => {
      (byShape[n.data("shape")] ??= new Set()).add(n.data("color"));
    });
    return {
      shapes: new Set(ns.map((n) => n.data("shape"))).size,
      allPatterned: ns.every((n) =>
        (n.data("pattern") || "").startsWith("data:image/svg"),
      ),
      maxColoursPerShape: Math.max(...Object.values(byShape).map((s) => s.size)),
    };
  });
  assert(enc.shapes === 2, `shape-by type → ${enc.shapes} distinct shapes`);
  assert(enc.allPatterned, `pattern-by type → every node textured`);
  assert(enc.maxColoursPerShape >= 2, `colour independent of shape (one shape spans ${enc.maxColoursPerShape} colours)`);
  await page.screenshot({ path: `${SHOT_DIR}/06b-channels.png` });

  // ---- filter: hide first node type ----
  const beforeHidden = await page.evaluate(() => window.__cy.elements(".hidden").length);
  await page.evaluate(() => {
    const cb = document.querySelector(".filter-panel .toggle-row input");
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(300);
  const afterHidden = await page.evaluate(() => window.__cy.elements(".hidden").length);
  assert(afterHidden > beforeHidden, `filter hides elements (${beforeHidden} -> ${afterHidden})`);
  await page.screenshot({ path: `${SHOT_DIR}/07-filtered.png` });

  // ---- export standalone HTML and re-open it offline (file://) ----
  for (const f of await readdir(SHOT_DIR)) {
    if (/-nevergraph\.html$/.test(f)) await unlink(`${SHOT_DIR}/${f}`);
  }
  const client = await page.createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SHOT_DIR });
  await page.click(".toolbar-right .btn-accent");
  let exported = null;
  for (let i = 0; i < 50 && !exported; i++) {
    const files = await readdir(SHOT_DIR);
    exported = files.find((n) => /-nevergraph\.html$/.test(n)) || null;
    if (!exported) await sleep(150);
  }
  assert(!!exported, `export produced file: ${exported}`);
  if (exported) {
    await sleep(300); // let the file flush
    const vpage = await browser.newPage();
    const vErrors = [];
    vpage.on("pageerror", (e) => vErrors.push(String(e)));
    vpage.on("console", (m) => m.type() === "error" && vErrors.push(m.text()));
    await vpage.goto(`file://${SHOT_DIR}/${exported}`, { waitUntil: "networkidle0" });
    await vpage.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0, { timeout: 10000 });
    await sleep(700);
    const vn = await vpage.evaluate(() => window.__cy.nodes().length);
    assert(vn === 8, `exported viewer renders ${vn} nodes offline (want 8)`);
    await vpage.screenshot({ path: `${SHOT_DIR}/09-exported.png` });
    assert(vErrors.length === 0, `exported viewer: no errors (${vErrors.length}): ${vErrors.slice(0, 2).join(" | ")}`);
    await vpage.close();
  }

  // ---- live physics: dragging a node should push its neighbours ----
  await page.evaluate(() => {
    const sel = document.querySelectorAll(".toolbar-mid select")[0];
    sel.value = "physics";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(2400); // let the simulation settle
  const drag = await page.evaluate(() => {
    const A = window.__cy.nodes(":visible").sort((a, b) => b.degree() - a.degree()).first();
    const B = A.neighborhood("node:visible").first();
    const rect = document.querySelector(".cy").getBoundingClientRect();
    const rp = A.renderedPosition();
    return {
      ax: rect.left + rp.x,
      ay: rect.top + rp.y,
      aId: A.id(),
      bId: B.id(),
      aBefore: { ...A.position() },
      bBefore: { ...B.position() },
      ok: A.nonempty() && B.nonempty(),
    };
  });
  assert(drag.ok, "found a node with a visible neighbour for the physics test");
  if (drag.ok) {
    // Hover (no drag) must NOT move neighbours — the wobble regression.
    await page.mouse.move(drag.ax, drag.ay);
    await sleep(900);
    const hoverDrift = await page.evaluate((bId, before) => {
      const p = window.__cy.getElementById(bId).position();
      return Math.hypot(p.x - before.x, p.y - before.y);
    }, drag.bId, drag.bBefore);
    assert(hoverDrift < 5, `no wobble on hover (neighbour drifted ${hoverDrift.toFixed(1)}px)`);
    await page.mouse.move(5, 5); // move off the node before dragging
    // Grab A and hold it far away; while held, the edge force should pull B.
    await page.mouse.move(drag.ax, drag.ay);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(drag.ax + i * 22, drag.ay - i * 14);
      await sleep(25);
    }
    await sleep(700); // hold — let physics relax neighbours toward A
    const held = await page.evaluate((aId, bId) => ({
      a: { ...window.__cy.getElementById(aId).position() },
      b: { ...window.__cy.getElementById(bId).position() },
    }), drag.aId, drag.bId);
    await page.mouse.up();
    const aMoved = Math.hypot(held.a.x - drag.aBefore.x, held.a.y - drag.aBefore.y);
    const bMoved = Math.hypot(held.b.x - drag.bBefore.x, held.b.y - drag.bBefore.y);
    assert(aMoved > 20, `dragged node moved (${aMoved.toFixed(1)}px — confirms grab)`);
    assert(bMoved > 8, `neighbour bounced via physics while held (${bMoved.toFixed(1)}px)`);
    await page.screenshot({ path: `${SHOT_DIR}/10-physics.png` });
  }

  // ---- LARP dataset ----
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.$$eval(
    ".example-card",
    (els, label) => els.find((e) => e.textContent.includes(label)).click(),
    "LARP",
  );
  await page.waitForSelector(".wizard", { timeout: 8000 });
  await page.click(".btn-primary");
  await page.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0, { timeout: 10000 });
  await sleep(1200);
  const larp = await page.evaluate(() => ({
    n: window.__cy.nodes().length,
    e: window.__cy.edges().length,
  }));
  assert(larp.n === 90, `larp nodes = ${larp.n} (want 90)`);
  assert(larp.e > 0, `larp edges = ${larp.e}`);
  await page.screenshot({ path: `${SHOT_DIR}/08-larp.png` });

  assert(pageErrors.length === 0, `no page errors (${pageErrors.length}): ${pageErrors.slice(0, 3).join(" | ")}`);
} catch (err) {
  fail(`exception: ${err.stack || err}`);
} finally {
  if (pageErrors.length) console.error("PAGE ERRORS:\n" + pageErrors.join("\n"));
  if (browser) await browser.close();
  server.kill("SIGTERM");
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.m}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
