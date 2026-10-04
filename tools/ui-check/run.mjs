import { checkYouTube } from "./youtube.mjs";
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
} from "node:fs";
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
  p.logs = "";
  p.stderr.on("data", (value) => {
    p.logs = (
      p.logs +
      value
        .toString()
        .split("\n")
        .filter(
          (line) =>
            line.length < 2000 &&
            !line.includes("token") &&
            !line.includes("sdps"),
        )
        .join("\n") +
      "\n"
    ).slice(-30000);
  });
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
      "--auto-select-desktop-capture-source=Entire screen",
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
  await guest.waitForFunction(async () => {
    const s = await window.ui.voice.voiceDiagnostics();
    return s.connected && !!s.codec;
  });
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
  assert.equal(
    await page.getByRole("textbox", { name: "Rechercher un membre" }).count(),
    0,
  );
  assert.equal(await page.locator(".core-logo strong").textContent(), "Licra");
  assert.equal(await page.locator(".sidebar-version").count(), 0);
  const namedRow = (name) =>
    page.locator(".channel-row").filter({
      has: page.locator(".channel-label strong", {
        hasText: new RegExp(`^${name}$`),
      }),
    });
  const chill = await page.evaluate(
    () =>
      window.ui.store.getState().channels.find((c) => c.name === "Chill").id,
  );
  await page
    .locator(".member-list .user-row")
    .filter({ hasText: "Alice" })
    .dragTo(namedRow("Chill"));
  await page.waitForFunction(
    (id) =>
      window.ui.store.getState().users.find((u) => u.nickname === "Alice")
        .channel_id === id,
    chill,
  );
  await guest.waitForFunction(async () => {
    const s = await window.ui.voice.voiceDiagnostics();
    return s.connected && !!s.codec;
  });
  await page
    .locator(".channel-tree .user-row")
    .filter({ hasText: "Alice" })
    .dragTo(page.locator(".channel-row.selected"));
  await page.waitForFunction(
    (id) =>
      window.ui.store.getState().users.find((u) => u.nickname === "Alice")
        .channel_id === id,
    channel,
  );
  await guest.waitForFunction(async () => {
    const s = await window.ui.voice.voiceDiagnostics();
    return s.connected && !!s.codec;
  });
  await guest
    .locator(".channel-tree .user-row")
    .filter({ hasText: "Alice" })
    .dragTo(
      guest.locator(".channel-row").filter({
        has: guest.locator(".channel-label strong", { hasText: /^Chill$/ }),
      }),
    );
  await guest.waitForFunction(
    (id) =>
      window.ui.store.getState().users.find((u) => u.nickname === "Alice")
        .channel_id === id,
    chill,
  );
  await guest.waitForFunction(async () => {
    const s = await window.ui.voice.voiceDiagnostics();
    return s.connected && !!s.codec;
  });
  await guest.evaluate(
    (id) =>
      window.ui.control.request("JOIN_CHANNEL", {
        channel_id: id,
        password: "",
      }),
    channel,
  );
  await guest.waitForFunction(async () => {
    const s = await window.ui.voice.voiceDiagnostics();
    return s.connected && !!s.codec;
  });
  const rejoinsBeforeOrder = await page.evaluate(
    () =>
      window.ui.events.filter((type) => type === "VOICE_REJOIN_REQUIRED")
        .length,
  );
  await namedRow("Development")
    .locator(".channel-label")
    .dragTo(namedRow("Chill"), { targetPosition: { x: 100, y: 3 } });
  await page.waitForFunction(() => {
    const s = window.ui.store.getState(),
      a = s.channels.find((c) => c.name === "Development"),
      b = s.channels.find((c) => c.name === "Chill");
    return a.parent_id === b.parent_id && a.sort_order < b.sort_order;
  });
  assert.equal(
    await page.evaluate(
      () =>
        window.ui.events.filter((type) => type === "VOICE_REJOIN_REQUIRED")
          .length,
    ),
    rejoinsBeforeOrder,
  );
  await namedRow("Development")
    .locator(".channel-label")
    .dragTo(namedRow("Chill"));
  await page.waitForFunction(() => {
    const s = window.ui.store.getState();
    return (
      s.channels.find((c) => c.name === "Development").parent_id ===
      s.channels.find((c) => c.name === "Chill").id
    );
  });
  // Cycles and guests must be rejected before sending any update.
  await namedRow("Chill")
    .locator(".channel-label")
    .dragTo(namedRow("Development"));
  assert.equal(
    await page.evaluate(
      () =>
        window.ui.store.getState().channels.find((c) => c.name === "Chill")
          .parent_id,
    ),
    null,
  );
  assert.equal(
    await guest.locator(".channel-label[draggable=true]").count(),
    0,
  );
  await page.getByRole("button", { name: /Connecté/ }).click();
  const statistics = page.getByRole("dialog", { name: "Statistiques vocales" });
  await statistics.waitFor();
  await page.waitForFunction(() => {
    const d = document.querySelector(
      'dialog[aria-label="Statistiques vocales"]',
    );
    return (
      !!d &&
      Array.from(d.querySelectorAll(".info-grid div")).some(
        (el) =>
          el.textContent.includes("Paquets reçus") &&
          !el.textContent.includes("Non mesuré"),
      )
    );
  });
  await sleep(1200);
  await fits(page);
  await page.screenshot({ path: join(out, "voice-statistics-1440.png") });
  await page.keyboard.press("Escape");
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
  // Production chat modules with authenticated SQLite/WebSocket and two identities.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(
    (id) => window.ui.store.getState().set({ selected: id }),
    channel,
  );
  await guest.evaluate(
    (id) => window.ui.store.getState().set({ selected: id }),
    channel,
  );
  await page
    .getByRole("textbox", { name: "Message au salon" })
    .fill(
      "Bonjour 😀\n<script>window.chatXSS=true</script> https://example.com",
    );
  await page.getByRole("textbox", { name: "Message au salon" }).press("Enter");
  await guest.getByText(/Bonjour 😀/).waitFor();
  assert.equal(await guest.evaluate(() => window.chatXSS), undefined);
  assert.equal(
    await page.evaluate(() =>
      window.ui.chatUI.safeChatURL("javascript:alert(1)"),
    ),
    null,
  );
  assert.equal(
    await page.evaluate(() =>
      window.ui.chatUI.safeChatURL("file:///C:/Windows"),
    ),
    null,
  );
  await page.locator(".chat-message").first().click({ button: "right" });
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message au salon" })
    .fill("Message édité");
  await page.getByRole("textbox", { name: "Message au salon" }).press("Enter");
  await guest.getByText("Message édité", { exact: true }).waitFor();
  await guest.locator(".chat-message").first().click({ button: "right" });
  await guest.getByRole("button", { name: "Répondre", exact: true }).click();
  await guest
    .getByRole("textbox", { name: "Message au salon" })
    .fill("Réponse au message");
  await guest.getByRole("textbox", { name: "Message au salon" }).press("Enter");
  await page.getByText("Réponse au message", { exact: true }).waitFor();
  await page.locator(".chat-message").first().click({ button: "right" });
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Confirmer l’action" })
    .getByRole("button", { name: "Confirmer", exact: true })
    .click();
  await guest
    .locator(".deleted-message")
    .getByText("Message supprimé", { exact: true })
    .waitFor();
  const alice = await guest.evaluate(
    () =>
      window.ui.store.getState().users.find((u) => u.nickname === "Alice")
        .fingerprint,
  );
  await page.evaluate((fp) => window.ui.chat.openPrivate(fp, "Alice"), alice);
  await page
    .getByRole("textbox", { name: "Message privé" })
    .fill("MP persistant");
  await page.getByRole("textbox", { name: "Message privé" }).press("Enter");
  await guest.waitForFunction(() =>
    window.ui.chat.useChat
      .getState()
      .threads.some((t) => !t.channel_id && t.unread > 0),
  );
  await guest.getByRole("button", { name: /Thomas.*1/ }).click();
  await guest.getByText("MP persistant", { exact: true }).waitFor();
  await page.screenshot({ path: join(out, "chat-private-1440.png") });
  await page
    .getByRole("button", { name: "Fermer les messages privés" })
    .click();
  await guest
    .getByRole("button", { name: "Fermer les messages privés" })
    .click();
  await guest.evaluate(() => window.ui.control.disconnect());
  await page.waitForFunction(
    () => !window.ui.store.getState().users.some((u) => u.nickname === "Alice"),
  );
  await page.evaluate((fp) => window.ui.chat.openPrivate(fp, "Alice"), alice);
  await page
    .getByRole("textbox", { name: "Message privé" })
    .fill("MP reçu après reconnexion");
  await page.getByRole("textbox", { name: "Message privé" }).press("Enter");
  await guest.evaluate(
    (address) => window.ui.control.connect(address, "Alice"),
    `127.0.0.1:${base}`,
  );
  await guest.waitForFunction(() =>
    window.ui.chat.useChat
      .getState()
      .threads.some((t) => !t.channel_id && t.unread > 0),
  );
  await guest.locator(".private-inbox button").first().click();
  await guest.getByText("MP reçu après reconnexion", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Fermer les messages privés" })
    .click();
  await guest
    .getByRole("button", { name: "Fermer les messages privés" })
    .click();
  await guest.evaluate(
    (id) =>
      window.ui.control.request("JOIN_CHANNEL", {
        channel_id: id,
        password: "",
      }),
    channel,
  );
  await guest.evaluate(
    (id) => window.ui.store.getState().set({ selected: id }),
    channel,
  );
  await page.getByRole("button", { name: "Partager l’écran" }).click();
  await page.waitForFunction(
    () =>
      window.ui.screen.useScreens.getState().sharing ||
      window.ui.screen.useScreens.getState().error,
  );
  assert.equal(
    await page.evaluate(() => window.ui.screen.useScreens.getState().sharing),
    true,
    await page.evaluate(() => window.ui.screen.useScreens.getState().error),
  );
  await guest.waitForFunction(() =>
    window.ui.screen.useScreens.getState().tracks.some((t) => !t.local),
  );
  const viewers = [];
  let viewerTransport,
    viewerNetwork = true;
  for (const nickname of ["Charlie", "Dora"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1100, height: 760 },
      permissions: ["microphone"],
    });
    const viewer = await ctx.newPage();
    if (nickname === "Dora")
      await viewer.routeWebSocket("**/ws", (route) => {
        if (!viewerNetwork) {
          void route.close({ code: 1013, reason: "Offline transport" });
          return;
        }
        viewerTransport = { client: route, server: route.connectToServer() };
      });
    await viewer.goto("http://localhost:1420/tests/ui.html");
    await viewer.waitForFunction(() => !!window.ui);
    await viewer.evaluate(
      ({ address, nickname }) => window.ui.control.connect(address, nickname),
      { address: `127.0.0.1:${base}`, nickname },
    );
    await viewer.evaluate(
      (id) =>
        window.ui.control.request("JOIN_CHANNEL", {
          channel_id: id,
          password: "",
        }),
      channel,
    );
    await viewer.evaluate(
      (id) => window.ui.store.getState().set({ selected: id }),
      channel,
    );
    viewers.push(viewer);
  }
  for (const viewer of viewers)
    await viewer.waitForFunction(
      () => window.ui.screen.useScreens.getState().tracks.length === 1,
    );
  await guest.getByRole("button", { name: "Partager l’écran" }).click();
  await page.waitForFunction(
    () => window.ui.screen.useScreens.getState().tracks.length === 2,
  );
  for (const viewer of viewers)
    await viewer.waitForFunction(
      () => window.ui.screen.useScreens.getState().tracks.length === 2,
    );
  await guest.waitForFunction(
    () => window.ui.screen.useScreens.getState().tracks.length === 2,
  );
  assert(
    await page.evaluate(async () => {
      const d = await window.ui.screen.screenDiagnostics();
      return d.tracks.some((t) => t.layers?.length > 1);
    }),
  );
  await page
    .locator(".screen-tile")
    .first()
    .getByRole("button", { name: "Focus / épingler" })
    .click();
  assert.equal(await page.locator(".screen-tile.focused").count(), 1);
  await page
    .locator(".screen-tile.focused")
    .getByRole("button", { name: "Plein écran" })
    .click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page
    .getByRole("button", { name: "Quitter le plein écran", exact: true })
    .click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page
    .locator(".screen-tile.focused")
    .getByRole("button", { name: "Grille", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message au salon" })
    .fill("Chat pendant le partage");
  await page.getByRole("textbox", { name: "Message au salon" }).press("Enter");
  await guest.getByText("Chat pendant le partage", { exact: true }).waitFor();
  await page.waitForFunction(async () => {
    const d = await window.ui.voice.voiceDiagnostics();
    return d.connected && d.packets_received > 0;
  });
  await page.screenshot({ path: join(out, "screens-chat-1440.png") });
  const sfup = children.find((p) => p.spawnfile.endsWith("/livekit-server"));
  const cpu = () => {
    const text = readFileSync(`/proc/${sfup.pid}/stat`, "utf8")
      .split(") ")[1]
      .split(" ");
    return (
      (Number(text[11]) + Number(text[12])) /
      Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }))
    );
  };
  const rss = () =>
    Number(
      readFileSync(`/proc/${sfup.pid}/status`, "utf8").match(
        /VmRSS:\s+(\d+)/,
      )[1],
    ) * 1024;
  const cdp = await browser.newBrowserCDPSession();
  const browserCPU = async () => {
    const p = await cdp.send("SystemInfo.getProcessInfo");
    return p.processInfo.reduce((sum, p) => sum + p.cpuTime, 0);
  };
  const bytes = async (p) =>
    p.evaluate(async () => {
      const d = await window.ui.screen.screenDiagnostics();
      let sent = 0,
        received = 0;
      const encodings = [];
      for (const t of d.tracks) {
        if (t.layers) encodings.push(...t.layers);
        for (const r of t.stats) {
          sent += r.bytesSent ?? 0;
          received += r.bytesReceived ?? 0;
        }
      }
      return { sent, received, encodings, tracks: d.tracks };
    });

  for (const viewer of viewers) {
    await viewer.locator(".screen-tile video").first().scrollIntoViewIfNeeded();
    await viewer.waitForFunction(() =>
      [...document.querySelectorAll(".screen-tile video")].every(
        (v) => v.readyState >= 2 && v.videoWidth > 0,
      ),
    );
  }
  await page.waitForFunction(async () => {
    const d = await window.ui.screen.screenDiagnostics();
    return d.tracks.some(
      (t) => t.layers?.length > 1 && t.layers.some((e) => e.active === false),
    );
  });
  const dynacastSmallView = await page.evaluate(() =>
    window.ui.screen.screenDiagnostics(),
  );
  await sleep(2000);
  const multiStart = cpu(),
    multiAt = performance.now(),
    multiBytes = await Promise.all([page, guest, ...viewers].map(bytes));
  await sleep(4000);
  const multiElapsed = (performance.now() - multiAt) / 1000,
    multiEnd = await Promise.all([page, guest, ...viewers].map(bytes));
  const multiBench = {
    publishers: 2,
    viewers: 2,
    small_view_encodings: dynacastSmallView.tracks
      .filter((t) => t.layers)
      .map((t) => t.layers),
    sfu_cpu_percent: ((cpu() - multiStart) / multiElapsed) * 100,
    sfu_rss_bytes: rss(),
    publisher_upload_bps: multiEnd
      .slice(0, 2)
      .map((v, i) => ((v.sent - multiBytes[i].sent) * 8) / multiElapsed),
    viewer_download_bps: multiEnd
      .slice(2)
      .map(
        (v, i) =>
          ((v.received - multiBytes[i + 2].received) * 8) / multiElapsed,
      ),
    passed: true,
  };
  assert(multiBench.viewer_download_bps.every((n) => n > 0));

  await page
    .getByRole("button", { name: "Arrêter le partage", exact: true })
    .click();
  await page.waitForFunction(
    () => !window.ui.screen.useScreens.getState().busy,
  );
  await page.evaluate(async () => {
    const original = navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices.getDisplayMedia = () => {
      throw new DOMException("Picker cancelled", "NotAllowedError");
    };
    try {
      await window.ui.screen.startScreen(
        { quality: "auto", fps: 30, content: "auto" },
        window.location.origin,
      );
    } finally {
      navigator.mediaDevices.getDisplayMedia = original;
    }
  });
  assert.equal(
    await page.evaluate(() => window.ui.screen.useScreens.getState().busy),
    false,
  );
  await page.waitForFunction(() =>
    window.ui.screen.useScreens.getState().tracks.some((t) => !t.local),
  );
  await guest
    .getByRole("button", { name: "Arrêter le partage", exact: true })
    .click();
  await page.waitForFunction(
    () => !window.ui.screen.useScreens.getState().sharing,
  );
  const benchmarks = [];
  for (const [quality, fps] of [
    ["1080p", 30],
    ["1080p", 60],
    ["1440p", 30],
    ["1440p", 60],
    ["source", 30],
  ].filter(
    ([quality]) =>
      !process.env.LICRA_SCREEN_PROFILE ||
      quality === process.env.LICRA_SCREEN_PROFILE,
  )) {
    await page
      .getByRole("combobox", { name: "Qualité écran" })
      .selectOption(quality);
    await page
      .getByRole("combobox", { name: "FPS écran" })
      .selectOption(String(fps));
    await page.getByRole("button", { name: "Partager l’écran" }).click();
    await page.waitForFunction(
      () =>
        window.ui.screen.useScreens.getState().sharing ||
        window.ui.screen.useScreens.getState().error,
    );
    console.log("Starting benchmark", quality, fps);
    assert.equal(
      await page.evaluate(() => window.ui.screen.useScreens.getState().sharing),
      true,
      await page.evaluate(() => window.ui.screen.useScreens.getState().error),
    );
    for (const viewer of [guest, ...viewers])
      await viewer.waitForFunction(() =>
        window.ui.screen.useScreens.getState().tracks.some((t) => !t.local),
      );
    for (const viewer of [guest, ...viewers])
      await viewer
        .locator(".screen-tile video")
        .first()
        .scrollIntoViewIfNeeded();
    await viewers[0].setViewportSize({ width: 3840, height: 2160 });
    await viewers[0]
      .locator(".screen-tile")
      .first()
      .getByRole("button", { name: "Plein écran" })
      .click();
    await viewers[0].waitForFunction(() => !!document.fullscreenElement);
    await sleep(2000);
    const sfustart = cpu(),
      browserStart = await browserCPU(),
      start = performance.now(),
      pubStart = await bytes(page),
      receiveStart = await Promise.all([guest, ...viewers].map(bytes));
    await sleep(4000);
    const elapsed = (performance.now() - start) / 1000,
      pubEnd = await bytes(page),
      receiveEnd = await Promise.all([guest, ...viewers].map(bytes));
    const received = receiveEnd.map(
      (v, i) => ((v.received - receiveStart[i].received) * 8) / elapsed,
    );
    benchmarks.push({
      requested: { quality, fps },
      sfu_cpu_percent: ((cpu() - sfustart) / elapsed) * 100,
      sfu_rss_bytes: rss(),
      browser_total_cpu_percent:
        (((await browserCPU()) - browserStart) / elapsed) * 100,
      publisher_upload_bps: ((pubEnd.sent - pubStart.sent) * 8) / elapsed,
      publisher_encoding_cpu_percent:
        (100 *
          (pubEnd.tracks
            .flatMap((t) => t.stats)
            .reduce((n, r) => n + (r.totalEncodeTime ?? 0), 0) -
            pubStart.tracks
              .flatMap((t) => t.stats)
              .reduce((n, r) => n + (r.totalEncodeTime ?? 0), 0))) /
        elapsed,
      subscriber_download_bps: received,
      sfu_media_outbound_bps: received.reduce((a, b) => a + b, 0),
      actual: pubEnd.tracks,
      hardware_gpu_utilization: "not observable in headless Chromium",
    });
    await viewers[0].bringToFront();
    await viewers[0].evaluate(() =>
      document.fullscreenElement ? document.exitFullscreen() : undefined,
    );
    console.log("Screen benchmark", quality, fps, {
      received,
      publisherUpload: ((pubEnd.sent - pubStart.sent) * 8) / elapsed,
    });
    assert(received.every((n) => n > 0));
    await page
      .getByRole("button", { name: "Arrêter le partage", exact: true })
      .click();
    await sleep(400);
  }
  writeFileSync(
    join(root, "docs/benchmarks/screen-local.json"),
    JSON.stringify(
      {
        environment:
          "Isolated Linux + headless Chromium; synthetic display capture, real LiveKit SFU, voice enabled; CPU includes three viewers and a publisher",
        viewers: 3,
        single_publisher_tests: benchmarks,
        multiple_publishers: multiBench,
        limitations:
          "Synthetic content; no physical Windows GPU or monitor validation",
      },
      null,
      2,
    ) + "\n",
  );
  // Permissions and channel changes stop real video while voice remains available.
  await page.evaluate(() =>
    window.ui.control.request("UPSERT_ROLE", {
      id: "screen-test",
      name: "Screen test",
      permissions: {},
    }),
  );
  const guestFingerprint = await guest.evaluate(
    () =>
      window.ui.store
        .getState()
        .users.find((u) => u.id === window.ui.store.getState().self_id)
        .fingerprint,
  );
  await page.evaluate(
    (fp) =>
      window.ui.control.request("ASSIGN_ROLE", {
        fingerprint: fp,
        role_id: "screen-test",
        channel_id: "",
      }),
    guestFingerprint,
  );
  await page
    .getByRole("combobox", { name: "Qualité écran" })
    .selectOption("auto");
  await page.getByRole("button", { name: "Partager l’écran" }).click();
  await page.waitForFunction(
    () => window.ui.screen.useScreens.getState().sharing,
  );
  await guest.getByRole("button", { name: "Partager l’écran" }).click();
  await guest.waitForFunction(
    () => window.ui.screen.useScreens.getState().sharing,
  );
  await page.evaluate(
    (id) =>
      window.ui.control.request("SET_OVERRIDE", {
        channel_id: id,
        role_id: "screen-test",
        permission: "screen.share",
        effect: "DENY",
      }),
    channel,
  );
  await guest.waitForFunction(
    () => !window.ui.screen.useScreens.getState().sharing,
  );
  await guest.waitForFunction(async () => {
    const d = await window.ui.voice.voiceDiagnostics();
    return d.connected && d.packets_received > 0;
  });
  await page.evaluate(
    (id) =>
      window.ui.control.request("SET_OVERRIDE", {
        channel_id: id,
        role_id: "screen-test",
        permission: "screen.watch",
        effect: "DENY",
      }),
    channel,
  );
  await guest.waitForFunction(
    () => window.ui.screen.useScreens.getState().tracks.length === 0,
  );
  await assert.rejects(
    guest.evaluate(() => window.ui.control.request("SCREEN_JOIN")),
    /Permission refusée/,
  );
  await page.evaluate(
    (id) =>
      window.ui.control.request("SET_OVERRIDE", {
        channel_id: id,
        role_id: "screen-test",
        permission: "screen.watch",
        effect: "INHERIT",
      }),
    channel,
  );
  await page.evaluate(
    (id) =>
      window.ui.control.request("SET_OVERRIDE", {
        channel_id: id,
        role_id: "screen-test",
        permission: "screen.share",
        effect: "INHERIT",
      }),
    channel,
  );
  await guest.waitForFunction(() =>
    window.ui.screen.useScreens.getState().tracks.some((t) => !t.local),
  );
  console.log("Screen permission restoration PASS");
  await checkYouTube({
    page,
    guest,
    viewers,
    browser,
    channel,
    chill,
    base,
    out,
    root,
  });
  const reconnectViewer = viewers[1];
  viewerNetwork = false;
  await reconnectViewer.context().setOffline(true);
  // Chromium's offline emulation does not close an already established WebSocket.
  await Promise.all([
    viewerTransport.client.close({
      code: 1001,
      reason: "Simulated transport loss",
    }),
    viewerTransport.server.close({
      code: 1001,
      reason: "Simulated transport loss",
    }),
  ]);
  console.log("Network transport interrupted");
  await reconnectViewer.waitForFunction(
    () => window.ui.store.getState().status !== "connected",
    null,
    { timeout: 60000 },
  );
  await page.waitForFunction(
    () => !window.ui.store.getState().users.some((u) => u.nickname === "Dora"),
    null,
    { timeout: 60000 },
  );
  viewerNetwork = true;
  await reconnectViewer.context().setOffline(false);
  console.log("Network restored");
  await reconnectViewer
    .waitForFunction(
      () => window.ui.store.getState().status === "connected",
      null,
      { timeout: 60000 },
    )
    .catch(async (e) => {
      console.error(
        "Reconnect state",
        await reconnectViewer.evaluate(() => ({
          status: window.ui.store.getState().status,
          error: window.ui.store.getState().error,
        })),
      );
      throw e;
    });
  console.log("Control automatically reconnected");
  await reconnectViewer.waitForFunction(
    (id) =>
      window.ui.store
        .getState()
        .users.find((u) => u.id === window.ui.store.getState().self_id)
        ?.channel_id === id,
    channel,
    { timeout: 60000 },
  );
  await reconnectViewer.waitForFunction(
    () =>
      window.ui.youtube.useYouTube.getState().activity?.video_id ===
      "M7lc1UVf-VE",
  );
  await page.evaluate(() => window.ui.youtube.youtubeAction("YOUTUBE_STOP"));
  for (const peer of [page, guest, ...viewers])
    await peer.evaluate(() =>
      window.ui.youtube.useYouTube.setState({ preferred: "screens" }),
    );
  await reconnectViewer.waitForFunction(() =>
    window.ui.screen.useScreens.getState().tracks.some((t) => !t.local),
  );
  await guest.getByRole("button", { name: "Partager l’écran" }).click();
  await guest.waitForFunction(
    () => window.ui.screen.useScreens.getState().sharing,
  );
  const guestScreenId = await guest.evaluate(
    () => window.ui.store.getState().self_id,
  );
  const ownerScreenId = await page.evaluate(
    () => window.ui.store.getState().self_id,
  );
  await assert.rejects(
    guest.evaluate(
      (id) => window.ui.control.request("SCREEN_STOP", { user_id: id }),
      ownerScreenId,
    ),
    /Permission refusée/,
  );
  await page.evaluate(
    (id) => window.ui.control.request("SCREEN_STOP", { user_id: id }),
    guestScreenId,
  );
  await guest.waitForFunction(
    () => !window.ui.screen.useScreens.getState().sharing,
  );
  await guest.waitForFunction(async () => {
    const d = await window.ui.voice.voiceDiagnostics();
    return d.connected && d.packets_received > 0;
  });
  await guest.getByRole("button", { name: "Partager l’écran" }).click();
  await guest.waitForFunction(
    () => window.ui.screen.useScreens.getState().sharing,
  );
  await guest.evaluate(
    (id) =>
      window.ui.control.request("JOIN_CHANNEL", {
        channel_id: id,
        password: "",
      }),
    chill,
  );
  await guest.waitForFunction(
    () =>
      !window.ui.screen.useScreens.getState().sharing &&
      window.ui.screen.useScreens.getState().tracks.length === 0,
  );
  await page
    .getByRole("button", { name: "Arrêter le partage", exact: true })
    .click();
  for (const viewer of viewers) await viewer.close();

  await page.getByRole("button", { name: "Mettre à jour Licra" }).click();
  await page.getByRole("dialog", { name: "Mise à jour de Licra" }).waitFor();
  await page.getByText(/est à jour/).waitFor();
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  assert.equal(await page.locator(".error-banner").count(), 0);
  console.log(
    "Licra UI checks passed: chat, MP, XSS, screen multi-publisher/multi-viewer, screen resolution/FPS benchmarks, drag/drop, channel order, voice statistics, real identity handshake, channel CRUD, roles, favourites, context volume, master volume, activation threshold, guest permissions, updater, 1000/1100/1440/1920/3840 layouts.",
  );
} catch (e) {
  for (const p of children.slice(0, 2))
    console.error(p.spawnfile, p.logs.slice(-7000));
  throw e;
} finally {
  await browser?.close();
  for (const p of children.reverse()) {
    p.kill("SIGTERM");
  }
  await sleep(300);
  rmSync(temp, { recursive: true, force: true });
}
