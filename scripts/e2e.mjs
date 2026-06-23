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

  // ---- Spread slider expands the layout (separates clusters) ----
  // Use a static layout so the bounding box is stable to measure.
  await page.evaluate(() => {
    const sel = document.querySelectorAll(".toolbar-mid select")[0];
    sel.value = "fcose";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(1600);
  const area1 = await page.evaluate(() => {
    const b = window.__cy.elements().boundingBox();
    return b.w * b.h;
  });
  await page.evaluate(() => {
    const sl = document.querySelector(".toolbar-slider");
    sl.value = "4";
    sl.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(1800);
  const area2 = await page.evaluate(() => {
    const b = window.__cy.elements().boundingBox();
    return b.w * b.h;
  });
  assert(area2 > area1 * 1.5, `spread slider expands layout (${Math.round(area1)} -> ${Math.round(area2)} px²)`);
  await page.screenshot({ path: `${SHOT_DIR}/14-spread.png` });

  // ---- cluster grouping into labeled compound boxes ----
  const setGroup = (v) =>
    page.evaluate((val) => {
      const c = [...document.querySelectorAll(".toolbar-mid .toolbar-control")].find(
        (x) => x.querySelector(".toolbar-clabel")?.textContent === "Group",
      );
      const sel = c.querySelector("select");
      sel.value = val;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, v);
  // reset spread to 1× for a representative grouping view
  await page.evaluate(() => {
    const sl = document.querySelector(".toolbar-slider");
    sl.value = "1";
    sl.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(800);
  await setGroup("Genere");
  await sleep(1800);
  const grouped = await page.evaluate(() => ({
    parents: window.__cy.nodes(":parent").length,
    children: window.__cy.nodes(":child").length,
  }));
  assert(grouped.parents === 3, `grouped by Genere → ${grouped.parents} cluster boxes (want 3)`);
  assert(grouped.children > 0, `nodes placed into clusters (${grouped.children})`);
  await page.screenshot({ path: `${SHOT_DIR}/15-group.png` });

  // exported HTML must keep the cluster boxes
  for (const f of await readdir(SHOT_DIR)) {
    if (/-nevergraph\.html$/.test(f)) await unlink(`${SHOT_DIR}/${f}`);
  }
  const c3 = await page.createCDPSession();
  await c3.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SHOT_DIR });
  await page.click(".toolbar-right .btn-accent");
  let exp3 = null;
  for (let i = 0; i < 50 && !exp3; i++) {
    const fs = await readdir(SHOT_DIR);
    exp3 = fs.find((n) => /-nevergraph\.html$/.test(n)) || null;
    if (!exp3) await sleep(150);
  }
  assert(!!exp3, `grouped export produced file: ${exp3}`);
  if (exp3) {
    await sleep(300);
    const vg = await browser.newPage();
    await vg.goto(`file://${SHOT_DIR}/${exp3}`, { waitUntil: "networkidle0" });
    await vg.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0, { timeout: 10000 });
    await sleep(1200);
    const vparents = await vg.evaluate(() => window.__cy.nodes(":parent").length);
    assert(vparents === 3, `exported viewer keeps cluster boxes (parents=${vparents})`);
    await vg.close();
  }

  await setGroup("none");
  await sleep(700);
  const ungrouped = await page.evaluate(() => window.__cy.nodes(":parent").length);
  assert(ungrouped === 0, `ungrouping removes cluster boxes (parents=${ungrouped})`);

  // ---- "Split types by" — node types come from a field, not the collection ----
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.$$eval(
    ".example-card",
    (els, label) => els.find((e) => e.textContent.includes(label)).click(),
    "Neverwas",
  );
  await page.waitForSelector(".wizard", { timeout: 8000 });
  const setSplit = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".coll-card")].find(
      (c) => c.querySelector(".coll-title strong")?.textContent === "storylets",
    );
    const lab = [...card.querySelectorAll(".w-labeled")].find(
      (l) => l.querySelector(".w-label")?.textContent === "Split types by",
    );
    const sel = lab.querySelector("select");
    sel.value = "type";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });
  assert(setSplit, "found and set the storylets 'Split types by' control");
  await sleep(400);
  const wiz = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".coll-card")].find(
      (c) => c.querySelector(".coll-title strong")?.textContent === "storylets",
    );
    const targetOpts = [...card.querySelectorAll(".w-labeled")]
      .filter((l) => l.querySelector(".w-label")?.textContent === "Target type")
      .flatMap((l) => [...l.querySelectorAll("option")].map((o) => o.value));
    const chips = [...card.querySelectorAll(".chip")].map((c) => c.textContent);
    return { targetOpts, chips };
  });
  assert(wiz.targetOpts.includes("zone"), `arc target-type list reflects split types (has 'zone')`);
  assert(!wiz.chips.some((c) => c.startsWith("type (")), `split field removed from category chips`);
  await page.click(".btn-primary");
  await page.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0, { timeout: 10000 });
  const splitTypes = await page.evaluate(() => window.__nevergraph().graph.nodeTypes);
  assert(
    ["end", "list", "zone"].every((t) => splitTypes.includes(t)) &&
      splitTypes.includes("item") &&
      !splitTypes.includes("storylet"),
    `split node types = [${splitTypes.join(",")}]`,
  );
  await page.screenshot({ path: `${SHOT_DIR}/11-split.png` });

  // ---- hover tooltip: wizard-chosen fields + standardised formatting ----
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.$$eval(
    ".example-card",
    (els, label) => els.find((e) => e.textContent.includes(label)).click(),
    "Neverwas",
  );
  await page.waitForSelector(".wizard", { timeout: 8000 });
  const addedHover = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".coll-card")].find(
      (c) => c.querySelector(".coll-title strong")?.textContent === "storylets",
    );
    const sub = [...card.querySelectorAll(".subsection")].find(
      (s) => s.querySelector("h4")?.textContent === "Show on hover",
    );
    const chip = [...sub.querySelectorAll(".chip")].find((b) => b.textContent === "text");
    if (!chip) return false;
    chip.click(); // add the 'text' field to the storylet hover tooltip
    return true;
  });
  assert(addedHover, "added 'text' to storylets 'Show on hover'");
  await page.click(".btn-primary");
  await page.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0, { timeout: 10000 });
  // stabilise positions (default layout is live physics) before hovering
  await page.evaluate(() => {
    const sel = document.querySelectorAll(".toolbar-mid select")[0];
    sel.value = "fcose";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(1300);
  const hoverTarget = await page.evaluate(() => {
    const n = window.__cy
      .nodes()
      .filter((x) => x.data("type") === "storylet")
      .sort((a, b) => b.degree() - a.degree())
      .first();
    const rect = document.querySelector(".cy").getBoundingClientRect();
    const rp = n.renderedPosition();
    const g = window.__nevergraph().graph.nodes.find((x) => x.id === n.id());
    return { x: rect.left + rp.x, y: rect.top + rp.y, label: g.label, textVal: String(g.data.text ?? "").slice(0, 12) };
  });
  await page.mouse.move(hoverTarget.x, hoverTarget.y);
  await sleep(250);
  const tip = await page.evaluate(() => {
    const t = document.querySelector(".cy-tooltip");
    return {
      keys: [...t.querySelectorAll("dt")].map((e) => e.textContent),
      label: t.querySelector(".tip-label")?.textContent ?? "",
      text: t.textContent ?? "",
    };
  });
  assert(tip.keys.includes("text"), `tooltip shows the wizard-chosen field 'text' (keys=[${tip.keys}])`);
  assert(tip.keys.includes("asset"), `tooltip keeps default category field 'asset'`);
  assert(tip.label === hoverTarget.label, `tooltip header shows the node label`);
  assert(!!hoverTarget.textVal && tip.text.includes(hoverTarget.textVal), `tooltip shows the field's value`);
  await page.screenshot({ path: `${SHOT_DIR}/12-tooltip.png` });

  // export and re-open offline: the standalone viewer must use the same fields
  for (const f of await readdir(SHOT_DIR)) {
    if (/-nevergraph\.html$/.test(f)) await unlink(`${SHOT_DIR}/${f}`);
  }
  const client2 = await page.createCDPSession();
  await client2.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SHOT_DIR });
  await page.click(".toolbar-right .btn-accent");
  let exp2 = null;
  for (let i = 0; i < 50 && !exp2; i++) {
    const fs = await readdir(SHOT_DIR);
    exp2 = fs.find((n) => /-nevergraph\.html$/.test(n)) || null;
    if (!exp2) await sleep(150);
  }
  assert(!!exp2, `tooltip export produced file: ${exp2}`);
  if (exp2) {
    await sleep(300);
    const vp = await browser.newPage();
    await vp.goto(`file://${SHOT_DIR}/${exp2}`, { waitUntil: "networkidle0" });
    await vp.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0, { timeout: 10000 });
    await sleep(1300);
    const vt = await vp.evaluate(() => {
      const n = window.__cy.nodes().filter((x) => x.data("type") === "storylet").sort((a, b) => b.degree() - a.degree()).first();
      const rect = document.querySelector(".cy").getBoundingClientRect();
      const rp = n.renderedPosition();
      return { x: rect.left + rp.x, y: rect.top + rp.y };
    });
    await vp.mouse.move(vt.x, vt.y);
    await sleep(250);
    const vkeys = await vp.evaluate(() =>
      [...document.querySelectorAll(".cy-tooltip dt")].map((e) => e.textContent),
    );
    assert(vkeys.includes("text"), `exported viewer tooltip uses the chosen fields (keys=[${vkeys}])`);
    await vp.screenshot({ path: `${SHOT_DIR}/13-tooltip-export.png` });
    await vp.close();
  }

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
