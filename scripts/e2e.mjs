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
try {
  await waitServer();
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
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
  if (browser) await browser.close();
  server.kill("SIGTERM");
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.m}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
