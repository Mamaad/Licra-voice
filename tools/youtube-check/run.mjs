import { chromium } from "@playwright/test";
import { createServer } from "node:http";
const host = createServer((request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(
    '<!doctype html><html lang="fr"><head><title>Licra official YouTube API check</title></head><body></body></html>',
  );
});
await new Promise((r) => host.listen(0, "127.0.0.1", r));
const address = `http://127.0.0.1:${host.address().port}`;
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        referer: "https://org.licra.voice",
      },
    }),
  );
  await page.goto(address);
  const result = await page.evaluate(async () => {
    const output = {
      environment:
        "Real official IFrame API, Linux Chromium; Referer adapter emulates Windows native header",
      ready: false,
      autoplayBlocked: false,
      error: null,
    };
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Official API timeout")),
          15000,
        );
        window.onYouTubeIframeAPIReady = () => {
          clearTimeout(timer);
          resolve();
        };
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Official API unavailable"));
        };
        document.head.appendChild(script);
      });
      const node = document.createElement("div");
      document.body.appendChild(node);
      await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(), 20000);
        window.realYT = new YT.Player(node, {
          width: 640,
          height: 360,
          videoId: "aqz-KE-bpKQ",
          playerVars: {
            origin: window.location.origin,
            widget_referrer: "https://org.licra.voice",
          },
          events: {
            onReady: (e) => {
              output.ready = true;
              e.target.playVideo();
              clearTimeout(timer);
              resolve();
            },
            onAutoplayBlocked: () => {
              output.autoplayBlocked = true;
            },
            onError: (e) => {
              output.error = e.data;
              clearTimeout(timer);
              resolve();
            },
          },
        });
      });
      await new Promise((r) => setTimeout(r, 5000));
      if (output.ready) {
        output.state = window.realYT.getPlayerState();
        output.position = window.realYT.getCurrentTime();
        output.duration = window.realYT.getDuration();
      }
    } catch (e) {
      output.error = String(e);
    }
    output.result =
      output.ready && output.state === 1 && output.position > 0 && !output.error
        ? "PLAYBACK_OBSERVED"
        : output.ready
          ? "PLAYER_READY_PLAYBACK_NOT_VALIDATED"
          : "API_UNAVAILABLE";
    return output;
  });
  console.log(JSON.stringify(result));
  writeFileSync(
    new URL("../../docs/benchmarks/youtube-real-api.json", import.meta.url),
    JSON.stringify(result, null, 2) + "\n",
  );
} finally {
  await browser.close();
  await new Promise((r) => host.close(r));
}
