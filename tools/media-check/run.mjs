import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const root = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const temp = mkdtempSync(join(tmpdir(), "licra-media-"));
const children = [];
const pages = [];
let browser;
const nodeIP = Object.values(networkInterfaces())
  .flat()
  .find((x) => x.family === "IPv4" && !x.internal)?.address;
if (!nodeIP) throw new Error("Non-loopback IPv4 required");
const config = join(temp, "config.toml");
const base = Number(process.env.LICRA_TEST_PORT ?? 26438);
writeFileSync(
  config,
  `[server]\nname="Media integration"\nbind="127.0.0.1"\nbase_port=${base}\nmax_clients=20\n[database]\npath="${temp}/test.db"\n[livekit]\ninternal_port=${base + 3}\npublic_ip="${nodeIP}"\n[security]\nhandshake_rate_limit=100\n`,
);
// A known PCM tone verifies actual activation and levels; fake devices alone may be silent.
const tone = Buffer.alloc(44 + 48000 * 2);
tone.write("RIFF", 0);
tone.writeUInt32LE(tone.length - 8, 4);
tone.write("WAVEfmt ", 8);
tone.writeUInt32LE(16, 16);
tone.writeUInt16LE(1, 20);
tone.writeUInt16LE(1, 22);
tone.writeUInt32LE(48000, 24);
tone.writeUInt32LE(96000, 28);
tone.writeUInt16LE(2, 32);
tone.writeUInt16LE(16, 34);
tone.write("data", 36);
tone.writeUInt32LE(tone.length - 44, 40);
for (let i = 0; i < 48000; i++)
  tone.writeInt16LE(
    Math.round(Math.sin((2 * Math.PI * 440 * i) / 48000) * 8000),
    44 + 2 * i,
  );
const tonePath = join(temp, "microphone.wav");
writeFileSync(tonePath, tone);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function child(command, args, cwd = root) {
  const p = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  children.push(p);
  p.stdout.on("data", () => {});
  p.stderr.on("data", () => {});
  return p;
}
async function wait(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error("Startup failed " + url);
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
  await wait(`http://127.0.0.1:${base + 3}`);
  const server = child(join(root, "bin/licra-server"), ["--config", config]);
  await wait(`http://127.0.0.1:${base}/health`);
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
    ],
    join(root, "client"),
  );
  await wait("http://localhost:1420/tests/media.html");
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${tonePath}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  for (const nickname of ["Alice", "Bob", "Charlie"]) {
    const context = await browser.newContext({ permissions: ["microphone"] });
    const p = await context.newPage();
    await p.goto(
      "http://localhost:1420/tests/media.html" +
        (nickname === "Alice" ? "?client-audio" : ""),
    );
    await p.waitForFunction(() => !!window.harness);
    await p.evaluate(
      async ({ address, nickname }) =>
        window.harness.connect(address, nickname),
      { address: `ws://127.0.0.1:${base}`, nickname },
    );
    pages.push(p);
  }
  const [a, b, c] = pages;
  const channels = await a.evaluate(() => window.harness.snapshot.channels);
  const first = channels[0].id,
    second = channels[1].id;
  await a.evaluate(
    (token) => window.harness.send("CLAIM_OWNER", { token }),
    token,
  );
  for (const [p, ch] of [
    [a, first],
    [b, first],
    [c, second],
  ]) {
    await p.evaluate(
      (ch) => window.harness.send("JOIN_CHANNEL", { channel_id: ch }),
      ch,
    );
    await p.waitForFunction((ch) => window.harness.joined === ch, ch);
  }
  let stats;
  for (let i = 0; i < 200; i++) {
    stats = await Promise.all(
      pages.map((p) => p.evaluate(() => window.harness.stats())),
    );
    if (stats[0].received > 1000 && stats[1].received > 1000) break;
    await sleep(100);
  }
  console.log("Media stats:", JSON.stringify(stats));
  assert(stats[0].opus && stats[0].received > 1000);
  assert(stats[1].opus);
  assert.equal(stats[2].remote, 0);
  await a.waitForFunction(
    () => window.harness.store.getState().microphoneLevel > 0.015,
  );
  // Regressions: production capture with no camera permission, threshold and meter after settings.
  await a.evaluate(async () => {
    const h = window.harness;
    await h.audio.startMicrophonePreview();
    const devices = await h.audio.devices();
    if (!devices.some((d) => d.kind === "audioinput"))
      throw new Error("Missing microphone");
    h.store.getState().saveSettings({ mode: "activation", threshold: 1 });
    await h.audio.refreshSettings({ mode: "activation", threshold: 1 });
  });
  const alice = await a.evaluate(() => window.harness.snapshot.self_id);
  await b.waitForFunction(
    (id) =>
      window.harness.room.remoteParticipants
        .get(id)
        ?.getTrackPublication("microphone")?.isMuted,
    alice,
  );
  await a.evaluate(async () => {
    const h = window.harness;
    h.store.getState().saveSettings({ threshold: 0.001 });
    await h.audio.refreshSettings({ threshold: 0.001 });
  });
  await a.waitForFunction(() =>
    window.harness.store
      .getState()
      .talking.includes(window.harness.snapshot.self_id),
  );
  await b.waitForFunction(
    (id) =>
      window.harness.room.remoteParticipants
        .get(id)
        ?.getTrackPublication("microphone")?.isMuted === false,
    alice,
  );
  await a.evaluate(async () => {
    await window.harness.audio.refreshSettings({ noiseSuppression: true });
    window.harness.audio.stopMicrophonePreview();
  });
  await a.waitForFunction(
    () =>
      window.harness.store.getState().microphoneLevel > 0 &&
      window.harness.store
        .getState()
        .talking.includes(window.harness.snapshot.self_id),
  );
  assert.equal(await a.evaluate(() => window.harness.cameraRequests), 0);
  console.log(
    "Production audio: devices, activation threshold, preview and speaking after settings PASS",
  );
  const oldToken = await b.evaluate(() => window.harness.lastToken);
  const bob = await b.evaluate(() => window.harness.snapshot.self_id);
  await a.evaluate(
    ({ user_id, channel_id }) =>
      window.harness.send("MOVE_USER", { user_id, channel_id }),
    { user_id: bob, channel_id: second },
  );
  await b.waitForFunction((ch) => window.harness.joined === ch, second);
  await a.waitForFunction(
    () => window.harness.room.remoteParticipants.size === 0,
  );
  const denied = await fetch(
    `http://127.0.0.1:${base}/livekit/rtc/validate?access_token=${encodeURIComponent(oldToken)}`,
  );
  assert.equal(denied.status, 403);
  const result = {
    result: "PASS",
    opus_received: true,
    isolated_rooms: true,
    admin_move: true,
    client_audio_regressions: true,
    stale_token_status: denied.status,
    stats,
  };
  writeFileSync(
    join(root, "docs/benchmarks/media-local.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e);
  for (const p of pages) {
    try {
      console.error(
        await p.evaluate(() => ({
          error: window.harness.error,
          audio: {
            level: window.harness.store.getState().microphoneLevel,
            talking: window.harness.store.getState().talking,
            error: window.harness.store.getState().error,
            micMuted:
              window.harness.room?.localParticipant.getTrackPublication(
                "microphone",
              )?.isMuted,
          },
          joined: window.harness.joined,
          state: window.harness.room?.state,
          events: window.harness.events.map((e) => e.type),
        })),
      );
    } catch {}
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const p of children.reverse()) p.kill("SIGTERM");
  await sleep(300);
  rmSync(temp, { recursive: true, force: true });
}
