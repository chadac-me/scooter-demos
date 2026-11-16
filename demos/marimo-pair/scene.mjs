import { scene } from "../../lib/director.mjs";

// The prompt box of marimo's Agent panel, which Scooter opens on this conversation.
const composer = ".mo-agent-panel .cm-content";

/** Send a prompt from the Agent panel; return its working indicator. */
async function askInPanel(d, text) {
  await d.typeIn(d.page.locator(composer).last(), text);
  await d.hold(350);
  await d.page.keyboard.press("Enter");
  const working = d.page.getByText("Agent is working").first();
  await working.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  return working;
}

export default scene(async (d) => {
  // Off camera: the user already has the notebook open.
  await d.open();
  await d.ask("Open ci_trends.py in a notebook", { timeout: 600_000 });
  const link = d.page.getByRole("link", { name: "ci_trends.py" }).last();
  await link.waitFor({ state: "visible" });
  const popup = d.page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await link.click();
  const tab = (await popup) ?? d.page;
  await d.use(tab);
  // Notebook cells only: the panel shows the same code in its tool calls.
  const cells = tab.locator(".marimo-cell");
  await cells.locator(`rect[fill="#6366f1"]`).first().waitFor({ state: "visible", timeout: 300_000 });
  await tab.locator(composer).last().waitFor({ state: "visible", timeout: 60_000 });
  await d.settle(1500);

  d.mark("begin");
  await d.hold(800);
  const run = await askInPanel(d, "Why did e2e full get slower last week? Dig in here.");
  await d.park();

  // New cells land at the notebook's end; follow them.
  const summary = cells.getByText(/last 7 days against the 7 before/).first();
  await summary.waitFor({ state: "visible", timeout: 300_000 });
  await d.focus(summary);
  const chart = cells.getByText(/p50 and p95 by day/).first();
  await chart.waitFor({ state: "visible", timeout: 120_000 });
  await d.focus(chart);
  await run.waitFor({ state: "detached", timeout: 300_000 });
  await d.settle(800);
  d.mark("poster");
  await d.hold(2500);

  // The user widens the window in Scooter's cell.
  const line = cells.locator(".cm-line", { hasText: /^window = 7$/ }).first();
  await d.focus(line);
  await d.click(line);
  await tab.keyboard.press("End");
  await d.hold(300);
  await tab.keyboard.press("Backspace");
  await d.hold(250);
  for (const ch of "14") {
    await tab.keyboard.type(ch);
    await d.hold(180);
  }
  await d.hold(500);
  await tab.keyboard.press("Control+Enter");
  await cells.getByText(/last 14 days against the 14 before/).first().waitFor({ state: "visible", timeout: 60_000 });
  await d.focus(cells.getByText(/p50 and p95 by day/).first());
  await d.hold(1800);

  const again = await askInPanel(d, "I changed the window. Does it still hold?");
  await d.park();
  await again.waitFor({ state: "detached", timeout: 300_000 });
  // The panel doesn't scroll its last reply into view.
  await d.focus(tab.locator(".mo-agent-panel").getByText(/The slow tail started that day/).last());
  await d.settle(800);
  await d.hold(3500);
  d.mark("end");
});
