const http = require("node:http");
const { spawn } = require("node:child_process");
const process = require("node:process");

const { chromium } = require("playwright");
const { RedisMemoryServer } = require("redis-memory-server");

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error(`Server did not become ready: ${url}`));
          return;
        }
        setTimeout(tick, 1000);
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`Server did not become ready: ${url}`));
          return;
        }
        setTimeout(tick, 1000);
      });
    };
    tick();
  });
}

function spawnCommand(command, envOverrides = {}) {
  return process.platform === "win32"
    ? spawn("cmd.exe", ["/c", command], {
        cwd: process.cwd(),
        env: { ...process.env, ...envOverrides },
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawn("sh", ["-lc", command], {
        cwd: process.cwd(),
        env: { ...process.env, ...envOverrides },
        stdio: ["ignore", "pipe", "pipe"],
      });
}

function createLogBuffer(label) {
  const lines = [];
  return {
    push(chunk) {
      const text = String(chunk ?? "").trim();
      if (!text) return;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lines.push(`[${label}] ${trimmed}`);
        if (lines.length > 200) lines.shift();
      }
    },
    dump() {
      return lines.join("\n");
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPlaybackState(page, state, timeout = 45000) {
  await page.waitForFunction(
    (expected) => {
      const text = document.body?.innerText || "";
      const re = new RegExp(`State:\\s*${expected}\\s*at\\s*\\d+s`, "i");
      return re.test(text);
    },
    state,
    { timeout },
  );
}

async function readPlaybackSnapshot(page) {
  const match = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const m = text.match(/State:\s*(Paused|Playing)\s*at\s*(\d+)s/i);
    if (!m) return null;
    return { state: m[1], seconds: Number(m[2]) };
  });
  if (!match) throw new Error("Could not read playback state text");
  return { state: String(match.state), seconds: Number(match.seconds) };
}

async function waitForRoomReady(page, timeout = 120000, requirePlaybackState = false) {
  await page.getByText("Sync v2 (Socket)", { exact: true }).waitFor({ timeout });
  if (requirePlaybackState) {
    await page.waitForFunction(
      () => {
        const hasState = /State:\s*(Paused|Playing)\s*at\s*\d+s/i.test(
          document.body?.innerText || "",
        );
        return hasState;
      },
      { timeout },
    );
  }
}

function maxDriftSeconds(values) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return max - min;
}

function assertDrift(label, values, maxAllowed) {
  const drift = maxDriftSeconds(values);
  if (drift > maxAllowed) {
    throw new Error(`${label} drift too high: [${values.join(", ")}], drift=${drift}s`);
  }
}

async function getConnectedCount(page) {
  const value = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const m = text.match(/Connected\s*\((\d+)\)/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  });
  return value == null ? null : Number(value);
}

async function waitForConnectedCountAtLeast(page, minCount, timeout = 90000) {
  await page.waitForFunction(
    (min) => {
      const text = document.body?.innerText || "";
      const m = text.match(/Connected\s*\((\d+)\)/i);
      if (!m) return false;
      const n = Number(m[1]);
      return Number.isFinite(n) && n >= min;
    },
    minCount,
    { timeout },
  );
}

async function waitForButtonEnabled(page, label, timeout = 90000) {
  await page.waitForFunction(
    (name) => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (el) => (el.textContent || "").trim() === name,
      );
      return Boolean(btn && !btn.hasAttribute("disabled"));
    },
    label,
    { timeout },
  );
}

async function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }
}

async function run() {
  const webPort = 3104;
  const baseUrl = `http://127.0.0.1:${webPort}`;
  const redisServer = new RedisMemoryServer();
  await redisServer.start();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;

  const realtime = spawnCommand("npm run dev:realtime", {
    REDIS_URL: redisUrl,
  });
  const web = spawnCommand(`npx next dev -p ${webPort}`);
  const realtimeLogs = createLogBuffer("realtime");
  const webLogs = createLogBuffer("web");
  let realtimeExit = null;
  let webExit = null;
  let succeeded = false;

  realtime.stdout.on("data", (d) => realtimeLogs.push(d));
  realtime.stderr.on("data", (d) => realtimeLogs.push(d));
  web.stdout.on("data", (d) => webLogs.push(d));
  web.stderr.on("data", (d) => webLogs.push(d));
  realtime.on("close", (code, signal) => {
    realtimeExit = { code, signal };
  });
  web.on("close", (code, signal) => {
    webExit = { code, signal };
  });

  try {
    await waitForServer("http://127.0.0.1:4000/healthz", 180000);
    await waitForServer(baseUrl, 180000);

    const browser = await chromium.launch({
      headless: true,
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
    const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const contextC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await contextA.grantPermissions(["camera", "microphone"], { origin: baseUrl });
    await contextB.grantPermissions(["camera", "microphone"], { origin: baseUrl });
    await contextC.grantPermissions(["camera", "microphone"], { origin: baseUrl });

    const pageA = await contextA.newPage();
    await pageA.goto(baseUrl, { waitUntil: "networkidle", timeout: 120000 });

    const createButton = pageA.getByRole("button", { name: "Create Room" });
    await createButton.waitFor({ state: "visible", timeout: 120000 });
    await pageA.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((el) =>
        /Create Room/i.test(el.textContent || ""),
      );
      return Boolean(btn && !btn.disabled);
    });

    await createButton.click({ timeout: 30000 });
    await pageA.waitForURL(/\/room\/[0-9a-f-]{36}$/i, { timeout: 120000 });
    const roomUrl = pageA.url();
    await waitForRoomReady(pageA, 120000, false);

    await pageA.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (el) => (el.textContent || "").trim() === "Set Video",
      );
      return Boolean(btn && !btn.hasAttribute("disabled"));
    }, { timeout: 120000 });

    const videoInputA = pageA.getByPlaceholder("YouTube URL or Video ID");
    const setVideoButtonA = pageA.getByRole("button", { name: "Set Video" });
    await videoInputA.fill("dQw4w9WgXcQ");
    await setVideoButtonA.click();

    try {
      await waitForPlaybackState(pageA, "Playing", 90000);
    } catch (err) {
      const text1 = await pageA.evaluate(() => document.body?.innerText || "");
      throw new Error(
        `Did not reach playing state after set video.\nPAGE A:\n${text1.slice(0, 2000)}\nOriginal: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await wait(5000);

    // Student B joins late and should be in sync with active playback.
    const pageB = await contextB.newPage();
    await pageB.goto(roomUrl, { waitUntil: "networkidle", timeout: 120000 });
    await waitForRoomReady(pageB, 120000, true);
    await waitForPlaybackState(pageB, "Playing", 90000);
    await wait(2500);

    const lateJoinA = await readPlaybackSnapshot(pageA);
    const lateJoinB = await readPlaybackSnapshot(pageB);
    assertDrift("late-join playing", [lateJoinA.seconds, lateJoinB.seconds], 2);

    // Student B pauses; must pause for everyone.
    const pauseButtonB = pageB.getByRole("button", { name: "Pause" });
    await pauseButtonB.click();
    await waitForPlaybackState(pageA, "Paused", 90000);
    await waitForPlaybackState(pageB, "Paused", 90000);

    const pausedA = await readPlaybackSnapshot(pageA);
    const pausedB = await readPlaybackSnapshot(pageB);
    assertDrift("pause all", [pausedA.seconds, pausedB.seconds], 1);

    // Student C joins while paused and should land at same paused timestamp.
    const pageC = await contextC.newPage();
    await pageC.goto(roomUrl, { waitUntil: "networkidle", timeout: 120000 });
    await waitForRoomReady(pageC, 120000, true);
    await waitForPlaybackState(pageC, "Paused", 90000);

    const pausedC = await readPlaybackSnapshot(pageC);
    assertDrift("paused late-join", [pausedA.seconds, pausedB.seconds, pausedC.seconds], 1);

    // Student C plays; must play for everyone.
    const playButtonC = pageC.getByRole("button", { name: "Play" });
    await playButtonC.click();
    await waitForPlaybackState(pageA, "Playing", 90000);
    await waitForPlaybackState(pageB, "Playing", 90000);
    await waitForPlaybackState(pageC, "Playing", 90000);
    await wait(3500);

    const playingA = await readPlaybackSnapshot(pageA);
    const playingB = await readPlaybackSnapshot(pageB);
    const playingC = await readPlaybackSnapshot(pageC);
    assertDrift("play all", [playingA.seconds, playingB.seconds, playingC.seconds], 2);

    // Student B re-joins (reload) and must stay synced.
    await pageB.reload({ waitUntil: "networkidle", timeout: 120000 });
    await waitForRoomReady(pageB, 120000, true);
    await waitForPlaybackState(pageB, "Playing", 90000);
    await wait(2000);
    const rejoinA = await readPlaybackSnapshot(pageA);
    const rejoinB = await readPlaybackSnapshot(pageB);
    assertDrift("rejoin sync", [rejoinA.seconds, rejoinB.seconds], 2);

    // Student B (rejoined) pauses again; all must pause.
    await pageB.getByRole("button", { name: "Pause" }).click();
    await waitForPlaybackState(pageA, "Paused", 90000);
    await waitForPlaybackState(pageB, "Paused", 90000);
    await waitForPlaybackState(pageC, "Paused", 90000);
    const pause2A = await readPlaybackSnapshot(pageA);
    const pause2B = await readPlaybackSnapshot(pageB);
    const pause2C = await readPlaybackSnapshot(pageC);
    assertDrift("rejoin control pause", [pause2A.seconds, pause2B.seconds, pause2C.seconds], 1);

    // Cross-student chat delivery.
    const message = `socket-chat-${Date.now()}`;
    const chatInputC = pageC.getByPlaceholder("Type a message...");
    const sendButtonC = pageC.getByRole("button", { name: "Send" });
    await chatInputC.waitFor({ state: "visible", timeout: 45000 });
    await chatInputC.fill(message);
    await sendButtonC.click();

    await pageA.getByText(message).first().waitFor({ timeout: 45000 });
    await pageB.getByText(message).first().waitFor({ timeout: 45000 });

    // Camera/mic interaction validation (students A & B).
    const joinMeetA = pageA.getByRole("button", { name: "Join Meet" });
    const joinMeetB = pageB.getByRole("button", { name: "Join Meet" });
    await joinMeetA.waitFor({ state: "visible", timeout: 90000 });
    await joinMeetB.waitFor({ state: "visible", timeout: 90000 });
    await joinMeetA.click();
    await joinMeetB.click();

    try {
      await waitForButtonEnabled(pageA, "Camera Off", 120000);
      await waitForButtonEnabled(pageB, "Camera Off", 120000);
      await waitForButtonEnabled(pageA, "Mic Off", 120000);
      await waitForButtonEnabled(pageB, "Mic Off", 120000);
    } catch (e) {
      const aText = await pageA.evaluate(() => document.body?.innerText || "");
      const bText = await pageB.evaluate(() => document.body?.innerText || "");
      throw new Error(
        `Call controls never enabled.\nPAGE A:\n${aText.slice(0, 3000)}\nPAGE B:\n${bText.slice(0, 3000)}\nOriginal: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const camBtnA = pageA.getByRole("button", { name: "Camera Off" });
    const camBtnB = pageB.getByRole("button", { name: "Camera Off" });
    const micBtnA = pageA.getByRole("button", { name: "Mic Off" });
    const micBtnB = pageB.getByRole("button", { name: "Mic Off" });
    await camBtnA.waitFor({ state: "visible", timeout: 120000 });
    await camBtnB.waitFor({ state: "visible", timeout: 120000 });
    await micBtnA.waitFor({ state: "visible", timeout: 120000 });
    await micBtnB.waitFor({ state: "visible", timeout: 120000 });

    await camBtnA.click();
    await micBtnA.click();
    await camBtnB.click();
    await micBtnB.click();

    await pageA.getByRole("button", { name: "Camera On" }).waitFor({ timeout: 45000 });
    await pageB.getByRole("button", { name: "Camera On" }).waitFor({ timeout: 45000 });
    await pageA.getByRole("button", { name: "Mic On" }).waitFor({ timeout: 45000 });
    await pageB.getByRole("button", { name: "Mic On" }).waitFor({ timeout: 45000 });

    await waitForConnectedCountAtLeast(pageA, 2, 120000);
    await waitForConnectedCountAtLeast(pageB, 2, 120000);
    await pageA.getByText("No one else has joined yet.").waitFor({ state: "hidden", timeout: 120000 });
    await pageB.getByText("No one else has joined yet.").waitFor({ state: "hidden", timeout: 120000 });

    console.log("SOCKET_FLOW_OK");
    console.log(`ROOM_URL=${roomUrl}`);
    console.log(`LATE_JOIN_SYNC=${lateJoinA.seconds}:${lateJoinB.seconds}`);
    console.log(`PAUSE_SYNC=${pausedA.seconds}:${pausedB.seconds}:${pausedC.seconds}`);
    console.log(`PLAY_SYNC=${playingA.seconds}:${playingB.seconds}:${playingC.seconds}`);
    console.log(`REJOIN_SYNC=${rejoinA.seconds}:${rejoinB.seconds}`);
    console.log(`REJOIN_CONTROL_PAUSE=${pause2A.seconds}:${pause2B.seconds}:${pause2C.seconds}`);
    console.log(`CHAT_MESSAGE=${message}`);
    console.log(`CALL_CONNECTED_COUNTS=${await getConnectedCount(pageA)}:${await getConnectedCount(pageB)}`);
    succeeded = true;

    await contextA.close();
    await contextB.close();
    await contextC.close();
    await browser.close();
  } finally {
    if (!succeeded) {
      console.log("REALTIME_EXIT", JSON.stringify(realtimeExit));
      const realtimeDump = realtimeLogs.dump();
      if (realtimeDump) console.log(realtimeDump);
      const webDump = webLogs.dump();
      if (webDump) console.log(webDump);
    }
    await killTree(web.pid);
    await killTree(realtime.pid);
    await redisServer.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
