const process = require("node:process");

const { chromium } = require("playwright");

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
      () => /State:\s*(Paused|Playing)\s*at\s*\d+s/i.test(document.body?.innerText || ""),
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

async function run() {
  const baseUrl = process.env.BASE_URL || process.argv[2] || "";
  if (!baseUrl) {
    throw new Error('Missing BASE_URL. Example: BASE_URL="https://group-study-prep.vercel.app" node scripts/prod-socket-flow.cjs');
  }

  const launchArgs = [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ];

  // Use separate browser processes for separate "students" to avoid background-tab throttling
  // affecting sync scheduling (which uses setTimeout on each client).
  const browserA = await chromium.launch({
    headless: true,
    args: launchArgs,
  });
  const browserB = await chromium.launch({
    headless: true,
    args: launchArgs,
  });
  const browserC = await chromium.launch({
    headless: true,
    args: launchArgs,
  });

  const contextA = await browserA.newContext({ viewport: { width: 1440, height: 900 } });
  const contextB = await browserB.newContext({ viewport: { width: 1440, height: 900 } });
  const contextC = await browserC.newContext({ viewport: { width: 1440, height: 900 } });
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

  // Wait until controls are enabled (auth + socket join complete).
  try {
    await pageA.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (el) => (el.textContent || "").trim() === "Set Video",
      );
      return Boolean(btn && !btn.hasAttribute("disabled"));
    }, null, { timeout: 120000 });
  } catch (e) {
    const text = await pageA.evaluate(() => document.body?.innerText || "");
    throw new Error(
      `Room controls never enabled (Set Video stayed disabled).\nROOM_URL=${roomUrl}\nPAGE:\n${text.slice(0, 4000)}\nOriginal: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Set video and wait for playing.
  const videoInputA = pageA.getByPlaceholder("YouTube URL or Video ID");
  const setVideoButtonA = pageA.getByRole("button", { name: "Set Video" });
  await videoInputA.fill("dQw4w9WgXcQ");
  await setVideoButtonA.click();
  await waitForPlaybackState(pageA, "Playing", 90000);
  await wait(5000);

  // Late join B.
  let pageB = await contextB.newPage();
  await pageB.goto(roomUrl, { waitUntil: "networkidle", timeout: 120000 });
  await waitForRoomReady(pageB, 120000, true);
  await waitForPlaybackState(pageB, "Playing", 90000);
  await wait(2500);

  const lateJoinA = await readPlaybackSnapshot(pageA);
  const lateJoinB = await readPlaybackSnapshot(pageB);
  assertDrift("late-join playing", [lateJoinA.seconds, lateJoinB.seconds], 2);

  // Same-user second tab join.
  const pageA2 = await contextA.newPage();
  await pageA2.goto(roomUrl, { waitUntil: "networkidle", timeout: 120000 });
  await waitForRoomReady(pageA2, 120000, true);
  await waitForPlaybackState(pageA2, "Playing", 90000);
  await wait(1500);
  const tabJoinA = await readPlaybackSnapshot(pageA);
  const tabJoinA2 = await readPlaybackSnapshot(pageA2);
  assertDrift("cross-tab join", [tabJoinA.seconds, tabJoinA2.seconds], 2);

  // Pause from B -> everyone pauses.
  await pageB.getByRole("button", { name: "Pause" }).click();
  await waitForPlaybackState(pageA, "Paused", 90000);
  await waitForPlaybackState(pageB, "Paused", 90000);
  await waitForPlaybackState(pageA2, "Paused", 90000);

  const pausedA = await readPlaybackSnapshot(pageA);
  const pausedB = await readPlaybackSnapshot(pageB);
  const pausedA2 = await readPlaybackSnapshot(pageA2);
  assertDrift("pause all", [pausedA.seconds, pausedB.seconds, pausedA2.seconds], 1);

  // C joins while paused -> same timestamp.
  const pageC = await contextC.newPage();
  await pageC.goto(roomUrl, { waitUntil: "networkidle", timeout: 120000 });
  await waitForRoomReady(pageC, 120000, true);
  await waitForPlaybackState(pageC, "Paused", 90000);
  const pausedC = await readPlaybackSnapshot(pageC);
  assertDrift("paused late-join", [pausedA.seconds, pausedB.seconds, pausedA2.seconds, pausedC.seconds], 1);

  // Play from C -> everyone plays.
  await pageC.getByRole("button", { name: "Play" }).click();
  await waitForPlaybackState(pageA, "Playing", 90000);
  await waitForPlaybackState(pageB, "Playing", 90000);
  await waitForPlaybackState(pageA2, "Playing", 90000);
  await waitForPlaybackState(pageC, "Playing", 90000);
  await wait(3500);
  const playingA = await readPlaybackSnapshot(pageA);
  const playingB = await readPlaybackSnapshot(pageB);
  const playingA2 = await readPlaybackSnapshot(pageA2);
  const playingC = await readPlaybackSnapshot(pageC);
  assertDrift("play all", [playingA.seconds, playingB.seconds, playingA2.seconds, playingC.seconds], 2);

  // Chat delivery.
  const message = `prod-chat-${Date.now()}`;
  await pageC.getByPlaceholder("Type a message...").fill(message);
  await pageC.getByRole("button", { name: "Send" }).click();
  await pageA.getByText(message).first().waitFor({ timeout: 45000 });
  await pageB.getByText(message).first().waitFor({ timeout: 45000 });
  await pageA2.getByText(message).first().waitFor({ timeout: 45000 });

  // Cross-tab chat.
  const message2 = `prod-cross-tab-${Date.now()}`;
  await pageA2.getByPlaceholder("Type a message...").fill(message2);
  await pageA2.getByRole("button", { name: "Send" }).click();
  await pageA.getByText(message2).first().waitFor({ timeout: 45000 });
  await pageB.getByText(message2).first().waitFor({ timeout: 45000 });
  await pageC.getByText(message2).first().waitFor({ timeout: 45000 });

  // Rejoin from B (simulates a student reloading / returning later) -> synced timestamp.
  await pageB.close();
  pageB = await contextB.newPage();
  await pageB.goto(roomUrl, { waitUntil: "networkidle", timeout: 120000 });
  await waitForRoomReady(pageB, 120000, true);
  await waitForPlaybackState(pageB, "Playing", 90000);
  await wait(2000);
  const rejoinA = await readPlaybackSnapshot(pageA);
  const rejoinB = await readPlaybackSnapshot(pageB);
  assertDrift("rejoin playing", [rejoinA.seconds, rejoinB.seconds], 2);

  // Meet join + toggles (A & B).
  await pageA.getByRole("button", { name: "Join Meet" }).click();
  await pageB.getByRole("button", { name: "Join Meet" }).click();
  await waitForButtonEnabled(pageA, "Camera Off", 120000);
  await waitForButtonEnabled(pageB, "Camera Off", 120000);
  await waitForButtonEnabled(pageA, "Mic Off", 120000);
  await waitForButtonEnabled(pageB, "Mic Off", 120000);

  await pageA.getByRole("button", { name: "Camera Off" }).click();
  await pageA.getByRole("button", { name: "Mic Off" }).click();
  await pageB.getByRole("button", { name: "Camera Off" }).click();
  await pageB.getByRole("button", { name: "Mic Off" }).click();

  await pageA.getByRole("button", { name: "Camera On" }).waitFor({ timeout: 45000 });
  await pageB.getByRole("button", { name: "Camera On" }).waitFor({ timeout: 45000 });
  await pageA.getByRole("button", { name: "Mic On" }).waitFor({ timeout: 45000 });
  await pageB.getByRole("button", { name: "Mic On" }).waitFor({ timeout: 45000 });

  await waitForConnectedCountAtLeast(pageA, 2, 120000);
  await waitForConnectedCountAtLeast(pageB, 2, 120000);

  console.log("PROD_SOCKET_FLOW_OK");
  console.log(`ROOM_URL=${roomUrl}`);

  await contextA.close();
  await contextB.close();
  await contextC.close();
  await browserA.close();
  await browserB.close();
  await browserC.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
