import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
export async function installPlayerFixture(page, blocked = false) {
  await page.evaluate((blocked) => {
    window.ytBlock = blocked;
    window.ytDrift = 0;
    window.ytInstances = [];
    window.YT = {
      Player: class {
        constructor(node, options) {
          this.options = options;
          this.state = -1;
          this.position = 0;
          this.ref = performance.now();
          this.volume = 100;
          this.muted = false;
          this.id = "";
          this.seeks = 0;
          const iframe = document.createElement("iframe");
          iframe.title = "YouTube IFrame API fixture";
          node.replaceWith(iframe);
          this.element = iframe;
          window.ytInstances.push(this);
          queueMicrotask(() => options.events.onReady({ target: this }));
        }
        getCurrentTime() {
          return (
            this.position +
            (this.state === 1 ? (performance.now() - this.ref) / 1000 : 0) +
            window.ytDrift
          );
        }
        getDuration() {
          return 360;
        }
        getPlayerState() {
          return this.state;
        }
        loadVideoById(v) {
          this.id = v.videoId;
          this.position = v.startSeconds;
          this.ref = performance.now();
          this.playVideo();
        }
        cueVideoById(v) {
          this.id = v.videoId;
          this.position = v.startSeconds;
          this.state = 2;
        }
        playVideo() {
          if (window.ytBlock) {
            this.options.events.onAutoplayBlocked({ target: this });
            return;
          }
          if (this.state !== 1) {
            this.ref = performance.now();
            this.state = 1;
            queueMicrotask(() =>
              this.options.events.onStateChange({ target: this, data: 1 }),
            );
          }
        }
        pauseVideo() {
          this.position = this.getCurrentTime() - window.ytDrift;
          this.state = 2;
        }
        seekTo(v) {
          this.position = v;
          this.ref = performance.now();
          this.seeks++;
          window.ytDrift = 0;
        }
        setVolume(v) {
          this.volume = v;
        }
        mute() {
          this.muted = true;
        }
        unMute() {
          this.muted = false;
        }
        destroy() {
          this.destroyed = true;
          this.element.remove();
        }
      },
    };
  }, blocked);
}
export async function checkYouTube({
  page,
  guest,
  viewers,
  browser,
  channel,
  chill,
  base,
  out,
  root,
}) {
  const peers = [page, guest, ...viewers];
  for (const peer of peers)
    await installPlayerFixture(peer, peer === viewers[1]);
  const extraContext = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    permissions: ["microphone"],
  });
  const extra = await extraContext.newPage();
  // Different RTT on the real control WebSocket; all authority remains in the Go server.
  await extra.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    route.onMessage((m) =>
      setTimeout(() => {
        try {
          server.send(m);
        } catch {}
      }, 100),
    );
    server.onMessage((m) =>
      setTimeout(() => {
        try {
          route.send(m);
        } catch {}
      }, 100),
    );
  });
  await extra.goto("http://localhost:1420/tests/ui.html");
  await extra.waitForFunction(() => !!window.ui);
  await installPlayerFixture(extra);
  peers.push(extra);
  await page
    .getByRole("textbox", { name: "Lien YouTube" })
    .fill("https://youtu.be/M7lc1UVf-VE?si=fixture");
  await page
    .getByRole("button", { name: "Regarder ensemble", exact: true })
    .click();
  await extra.evaluate(
    ({ address, nickname }) => window.ui.control.connect(address, nickname),
    { address: `127.0.0.1:${base}`, nickname: "Erin" },
  );
  await extra.evaluate(
    (id) =>
      window.ui.control.request("JOIN_CHANNEL", {
        channel_id: id,
        password: "",
      }),
    channel,
  );
  await extra.evaluate(
    (id) => window.ui.store.getState().set({ selected: id }),
    channel,
  );
  for (const peer of peers)
    await peer.waitForFunction(
      () => window.ui.youtube.useYouTube.getState().activity?.duration === 360,
    );
  await viewers[1]
    .getByRole("button", {
      name: "Cliquez pour démarrer la lecture synchronisée",
    })
    .waitFor();
  await page.evaluate(() =>
    window.ui.youtube.youtubeAction("YOUTUBE_SEEK", { position: 60 }),
  );
  await viewers[1].evaluate(() => {
    window.ytBlock = false;
  });
  await viewers[1]
    .getByRole("button", {
      name: "Cliquez pour démarrer la lecture synchronisée",
    })
    .click();
  await viewers[1].waitForFunction(() => {
    const p = window.ytInstances.at(-1);
    return p?.getCurrentTime() >= 60 && p.state === 1;
  });
  await assert.rejects(
    guest.evaluate(() => window.ui.youtube.youtubeAction("YOUTUBE_PAUSE")),
    /Permission refusée/,
  );
  await page.evaluate(() => window.ui.youtube.youtubeAction("YOUTUBE_PAUSE"));
  for (const peer of peers)
    await peer.waitForFunction(
      () =>
        window.ui.youtube.useYouTube.getState().activity?.state === "PAUSED" &&
        window.ytInstances.at(-1)?.state === 2,
    );
  await page.evaluate(() => window.ui.youtube.youtubeAction("YOUTUBE_PLAY"));
  for (const peer of peers)
    await peer.waitForFunction(() => window.ytInstances.at(-1)?.state === 1);
  await page
    .getByRole("slider", { name: "Volume YouTube", exact: true })
    .fill("23");
  await page.getByRole("button", { name: "Couper YouTube localement" }).click();
  assert.equal(
    await guest.evaluate(() => window.ui.youtube.useYouTube.getState().muted),
    false,
  );
  assert.equal(
    await page.evaluate(
      () => window.ui.youtube.useYouTube.getState().activity.state,
    ),
    "PLAYING",
  );
  await page
    .getByRole("button", { name: "Plein écran YouTube", exact: true })
    .click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page
    .getByRole("button", { name: "Quitter le plein écran", exact: true })
    .click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.evaluate(() =>
    window.ui.youtube.youtubeAction("YOUTUBE_QUEUE_ADD", {
      video: "dQw4w9WgXcQ",
    }),
  );
  await page.evaluate(() =>
    window.ui.youtube.youtubeAction("YOUTUBE_QUEUE_ADD", {
      video: "aqz-KE-bpKQ",
    }),
  );
  await page.evaluate(() =>
    window.ui.youtube.youtubeAction("YOUTUBE_QUEUE_MOVE", { index: 1, to: 0 }),
  );
  assert.deepEqual(
    await guest.evaluate(
      () => window.ui.youtube.useYouTube.getState().activity.queue,
    ),
    ["aqz-KE-bpKQ", "dQw4w9WgXcQ"],
  );
  await page.evaluate(() => window.ui.youtube.youtubeAction("YOUTUBE_NEXT"));
  for (const peer of peers)
    await peer.waitForFunction(
      () =>
        window.ui.youtube.useYouTube.getState().activity.video_id ===
        "aqz-KE-bpKQ",
    );
  await page.evaluate(() =>
    window.ui.youtube.youtubeAction("YOUTUBE_PREVIOUS"),
  );
  for (const peer of peers)
    await peer.waitForFunction(
      () =>
        window.ui.youtube.useYouTube.getState().activity.video_id ===
        "M7lc1UVf-VE",
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
    () => window.ui.youtube.useYouTube.getState().activity === null,
  );
  assert.equal(await guest.locator(".youtube-mount iframe").count(), 0);
  await guest.evaluate(
    (id) =>
      window.ui.control.request("JOIN_CHANNEL", {
        channel_id: id,
        password: "",
      }),
    channel,
  );
  await guest.waitForFunction(
    () =>
      window.ui.youtube.useYouTube.getState().activity?.video_id ===
      "M7lc1UVf-VE",
  );
  await page.evaluate(() =>
    window.ui.youtube.youtubeAction("YOUTUBE_SEEK", { position: 100 }),
  );
  await extra.waitForFunction(
    () =>
      window.ui.youtube.useYouTube.getState().activity.position_reference ===
      100,
  );
  const seeks = await extra.evaluate(() => {
    window.ytDrift = 3;
    return window.ytInstances.at(-1).seeks;
  });
  await extra.waitForFunction(
    (seeks) =>
      window.ytInstances.at(-1).seeks > seeks &&
      Math.abs(window.ui.youtube.useYouTube.getState().drift ?? 9999) < 500,
    seeks,
    { timeout: 20000 },
  );
  await new Promise((r) => setTimeout(r, 400));
  // No video traffic or position tick goes through the application control socket.
  const initial = await Promise.all(
    peers.map((p) => p.evaluate(() => ({ ...window.ui.youtubeBytes }))),
  );
  await new Promise((r) => setTimeout(r, 3000));
  const drift = await Promise.all(
    peers.map((p) =>
      p.evaluate(() => window.ui.youtube.useYouTube.getState().drift),
    ),
  );
  const totals = await Promise.all(
    peers.map((p) => p.evaluate(() => ({ ...window.ui.youtubeBytes }))),
  );
  for (const peer of peers)
    await peer.waitForFunction(async () => {
      const v = await window.ui.voice.voiceDiagnostics();
      return v.connected && v.packets_received > 0;
    });
  await page
    .getByRole("textbox", { name: "Message au salon", exact: true })
    .fill("Chat pendant YouTube synchronisé");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await guest
    .getByText("Chat pendant YouTube synchronisé", { exact: true })
    .waitFor();
  const measurements = {
    environment:
      "Real UI/Go/SQLite/control WebSocket/LiveKit voice; deterministic IFrame API fixture, not a real YouTube decode",
    clients: 5,
    control_delay_client_5_ms: 200,
    drift_ms: drift,
    steady_control_bytes_3s: totals.map((v, i) => ({
      incoming: v.incoming - initial[i].incoming,
      outgoing: v.outgoing - initial[i].outgoing,
    })),
    total_youtube_control_bytes: totals,
    autoplay_blocked_and_current_position_after_activation: true,
    voice_and_chat_continued: true,
    limitations:
      "Physical WebView2 decode, ads and real YouTube CDN latency require separate validation",
  };
  writeFileSync(
    join(root, "docs/benchmarks/youtube-local.json"),
    JSON.stringify(measurements, null, 2) + "\n",
  );
  await page.screenshot({ path: join(out, "youtube-chat-1440.png") });
  await extra.close();
  await extraContext.close();
  console.log(
    "YouTube five clients, clocks, blocked autoplay, queue, authority, channel isolation, voice/chat PASS",
    measurements,
  );
}
