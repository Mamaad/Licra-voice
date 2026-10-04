import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const root = new URL("../..", import.meta.url).pathname.replace(/\/$/, ""),
  temp = mkdtempSync(join(tmpdir(), "licra-ui-")),
  base = 27438;
const out = join(root, "docs/screenshots/core");
mkdirSync(out, { recursive: true });
const ip = Object.values(networkInterfaces())
  .flat()
  .find((x) => x.family === "IPv4" && !x.internal)?.address;
const config = join(temp, "config.toml");
writeFileSync(
  config,
  `[server]\nname="Home Server"\nbind="127.0.0.1"\nbase_port=${base}\nmax_clients=20\n[database]\npath="${temp}/test.db"\n[livekit]\ninternal_port=${base + 3}\npublic_ip="${ip}"\n[security]\nhandshake_rate_limit=100\n`,
);
const tone = Buffer.alloc(44 + 96000);
Buffer.from(
  "524946462477010057415645666d7420100000000100010080bb000000770100020010006461746100770100",
  "hex",
).copy(tone);
for (let i = 0; i < 48000; i++)
  tone.writeInt16LE(
    Math.round(Math.sin((2 * Math.PI * 440 * i) / 48000) * 8000),
    44 + i * 2,
  );
const tonePath = join(temp, "tone.wav");
writeFileSync(tonePath, tone);
const children = [];
let browser;
function child(command, args, cwd = root) {
  const p = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  children.push(p);
  p.stdout.on("data", () => {});
  p.stderr.on("data", () => {});
  return p;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ready(url) {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw Error("Startup failed: " + url);
}
async function fits(page) {
  const result = await page.evaluate(() => {
    const bar = document.querySelector(".audio-bar").getBoundingClientRect(),
      dialog = document.querySelector("dialog[open]")?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      barBottom: bar.bottom,
      barTop: bar.top,
      height: innerHeight,
      dialog: dialog
        ? {
            left: dialog.left,
            right: dialog.right,
            top: dialog.top,
            bottom: dialog.bottom,
          }
        : null,
      width: innerWidth,
    };
  });
  assert(!result.overflow, JSON.stringify(result));
  assert(
    result.barBottom <= result.height && result.barTop > 0,
    JSON.stringify(result),
  );
  if (result.dialog)
    assert(
      result.dialog.left >= 0 &&
        result.dialog.right <= result.width &&
        result.dialog.top >= 0 &&
        result.dialog.bottom <= result.height,
      JSON.stringify(result),
    );
}
try {
  execFileSync(join(root, "bin/licra-server"), [
    "--config",
    config,
    "init-config",
  ]);
  child(join(root, "bin/livekit-server"), [
    "--config",
    join(temp, "livekit.yaml"),
  ]);
  await ready(`http://127.0.0.1:${base + 3}`);
  child(join(root, "bin/licra-server"), ["--config", config]);
  await ready(`http://127.0.0.1:${base}/health`);
  const token = execFileSync(
    join(root, "bin/licra-server"),
    ["--config", config, "admin-token"],
    { encoding: "utf8" },
  ).trim();
  child(
    process.execPath,
    [
      join(root, "client/node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "1420",
      "--strictPort",
    ],
    join(root, "client"),
  );
  await ready("http://localhost:1420/tests/ui.html");
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${tonePath}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:1420/tests/ui.html");
  await page.waitForFunction(() => !!window.ui);
  await page.getByRole("heading", { name: "Connecter à un serveur" }).waitFor();
  await fits(page);
  await page.screenshot({ path: join(out, "connection-1440.png") });
  await page.locator(".connection-form input").nth(0).fill(`127.0.0.1:${base}`);
  await page.locator(".connection-form input").nth(1).fill("Thomas");
  await page
    .locator(".connection-form")
    .getByRole("button", { name: "Connexion", exact: true })
    .click();
  await page.waitForFunction(() =>
    ["connected", "failed"].includes(window.ui.store.getState().status),
  );
  assert.equal(
    await page.evaluate(() => window.ui.store.getState().status),
    "connected",
    await page.evaluate(() => window.ui.store.getState().error),
  );
  await page.evaluate(
    (token) => window.ui.control.request("CLAIM_OWNER", { token }),
    token,
  );
  await page.waitForFunction(
    () => !!window.ui.store.getState().permissions["server.edit"],
  );
  // Verify styled dialogs and persistent favourites through the actual application.
  await page
    .locator(".global-nav")
    .getByRole("button", { name: "Connexion", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enregistrer dans les favoris" })
    .click();
  await page
    .getByRole("dialog", { name: "Nom du serveur favori" })
    .getByRole("textbox")
    .fill("Home Server");
  await page.getByRole("button", { name: "Valider" }).click();
  await page
    .locator(".server-list-item")
    .getByRole("button", { name: /^Home Server/ })
    .click();
  // Real channel CRUD and role permissions; production server on 64738 is untouched.
  for (const name of ["Chill", "Gaming", "Development"])
    await page.evaluate(
      (name) =>
        window.ui.control.request("CREATE_CHANNEL", {
          name,
          parent_id: null,
          description: "Un espace pour discuter entre amis.",
          audio_profile: "standard",
          max_users: 20,
          sort_order: 2,
          is_permanent: true,
        }),
      name,
    );
  const guestContext = await browser.newContext({
      viewport: { width: 1100, height: 760 },
      permissions: ["microphone"],
    }),
    guest = await guestContext.newPage();
  await guest.goto("http://localhost:1420/tests/ui.html");
  await guest.waitForFunction(() => !!window.ui);
  await guest.evaluate(
    (address) => window.ui.control.connect(address, "Alice"),
    `127.0.0.1:${base}`,
  );
  const channel = await page.evaluate(
    () =>
      window.ui.store.getState().channels.find((c) => c.name === "Lobby")?.id ??
      window.ui.store.getState().channels[0].id,
  );
  await page.evaluate(
    (id) =>
      window.ui.control.request("JOIN_CHANNEL", {
        channel_id: id,
        password: "",
      }),
    channel,
  );
  await guest.evaluate(
    (id) =>
      window.ui.control.request("JOIN_CHANNEL", {
        channel_id: id,
        password: "",
      }),
    channel,
  );
  await page.waitForFunction(
    () =>
      window.ui.store.getState().users.filter((u) => u.channel_id).length === 2,
  );
  await page.waitForFunction(
    () =>
      window.ui.store.getState().microphoneLevel > 0.001 &&
      window.ui.store.getState().talking.length > 0,
  );
  await sleep(500);
  await fits(page);
  await page.screenshot({ path: join(out, "channel-1440.png") });
  await page
    .locator(".member-list .user-row")
    .filter({ hasText: "Alice" })
    .click({ button: "right" });
  await page.locator(".context-volume input").fill("150");
  assert.equal(
    await page.evaluate(
      () => Object.values(window.ui.store.getState().volumes)[0],
    ),
    150,
  );
  await page.screenshot({ path: join(out, "context-1440.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("slider", { name: "Volume général" }).fill("75");
  assert.equal(
    await page.evaluate(() => window.ui.store.getState().masterVolume),
    75,
  );
  await page
    .getByRole("button", { name: "Paramètres audio", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Paramètres de Licra" }).waitFor();
  await page.getByLabel("Transmission").selectOption("activation");
  await page.getByRole("slider", { name: /Seuil d’activation/ }).fill("-35");
  assert(
    Math.abs(
      (await page.evaluate(
        () => 20 * Math.log10(window.ui.store.getState().settings.threshold),
      )) + 35,
    ) < 0.1,
  );
  await fits(page);
  await page.screenshot({ path: join(out, "audio-1440.png") });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Paramètres du serveur", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.evaluate(async () => {
    try {
      await window.ui.control.request("EDIT_SERVER", { name: "" });
    } catch (error) {
      window.ui.control.report(error);
    }
  });
  await page.locator(".modal-error").waitFor();
  await fits(page);
  await page
    .locator(".modal-error")
    .getByRole("button", { name: "Fermer le message" })
    .click();
  await page.screenshot({ path: join(out, "server-1440.png") });
  await page
    .locator(".admin-nav")
    .getByRole("button", { name: "Rôles", exact: true })
    .click();
  await page
    .locator(".role-list")
    .getByRole("button", { name: "Moderator", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Rechercher une permission" })
    .fill("parler");
  await page
    .locator(".permission-selector")
    .getByRole("button", { name: "Refuser" })
    .click();
  await page
    .locator(".role-detail-heading")
    .getByRole("button", { name: "Enregistrer" })
    .click();
  await page.waitForFunction(
    () =>
      window.ui.store.getState().roles.find((r) => r.id === "Moderator")
        .permissions["voice.speak"] === "DENY",
  );
  await page
    .getByRole("textbox", { name: "Rechercher une permission" })
    .fill("");
  await fits(page);
  await page.screenshot({ path: join(out, "permissions-1440.png") });
  for (const [width, height] of [
    [1000, 720],
    [1100, 760],
    [1920, 1080],
    [3840, 2160],
  ]) {
    await page.setViewportSize({ width, height });
    await fits(page);
    const overflow = await page
      .locator(".role-detail")
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    assert(!overflow, `Permissions overflow ${width}`);
    await page.screenshot({ path: join(out, `permissions-${width}.png`) });
  }
  await page.keyboard.press("Escape");
  for (const [width, height] of [
    [1000, 720],
    [1100, 760],
    [1920, 1080],
    [3840, 2160],
  ]) {
    await page.setViewportSize({ width, height });
    await fits(page);
    await page.screenshot({ path: join(out, `channel-${width}.png`) });
  }
  assert.equal(
    await guest
      .getByRole("button", { name: "Paramètres du serveur", exact: true })
      .count(),
    0,
  );
  await guest
    .locator(".member-list .user-row")
    .filter({ hasText: "Thomas" })
    .click({ button: "right" });
  assert.equal(
    await guest.getByRole("button", { name: "Bannir", exact: true }).count(),
    0,
  );
  assert.equal(
    await guest
      .getByRole("button", { name: "Expulser du serveur", exact: true })
      .count(),
    0,
  );
  await guest.keyboard.press("Escape");
  await page.getByRole("button", { name: "Mettre à jour Licra" }).click();
  await page.getByRole("dialog", { name: "Mise à jour de Licra" }).waitFor();
  await page.getByText(/est à jour/).waitFor();
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  assert.equal(await page.locator(".error-banner").count(), 0);
  console.log(
    "CORE UI checks passed: real identity handshake, channel CRUD, roles, favourites, context volume, master volume, activation threshold, guest permissions, updater, 1000/1100/1440/1920/3840 layouts.",
  );
} finally {
  await browser?.close();
  for (const p of children.reverse()) {
    p.kill("SIGTERM");
  }
  await sleep(300);
  rmSync(temp, { recursive: true, force: true });
}
