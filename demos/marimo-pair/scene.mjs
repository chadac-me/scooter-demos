import { scene, sel } from "../../lib/director.mjs";

/** Send a prompt from the side chat; return its run status. */
async function askInChat(d, chat, text) {
  await d.typeIn(chat.locator(sel.composer).first(), text);
  await d.hold(350);
  await d.page.keyboard.press("Enter");
  const status = chat.locator(sel.runStatus).first();
  await status.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  return status;
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
  const nb = tab.frameLocator("#app-frame");
  const chat = tab.frameLocator('iframe[title="Scooter chat"]');
  await nb.locator("svg rect").first().waitFor({ state: "visible", timeout: 300_000 });
  await chat.locator(sel.composer).first().waitFor({ state: "visible", timeout: 60_000 });
  await d.settle(1500);

  d.mark("begin");
  await d.hold(800);
  const run = await askInChat(d, chat, "Why did e2e full get slower last week? Dig in here.");
  await d.park();

  // New cells land at the notebook's end; follow them.
  const summary = nb.getByText(/last 7 days against the 7 before/).first();
  await summary.waitFor({ state: "visible", timeout: 300_000 });
  await d.focus(summary);
  const chart = nb.getByText(/p50 and p95 by day/).first();
  await chart.waitFor({ state: "visible", timeout: 120_000 });
  await d.focus(chart);
  await run.waitFor({ state: "detached", timeout: 300_000 });
  await d.settle(800);
  d.mark("poster");
  await d.hold(2500);

  // The user widens the window in Scooter's cell.
  const line = nb.locator(".cm-line", { hasText: /^window = 7$/ }).first();
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
  await nb.getByText(/last 14 days against the 14 before/).first().waitFor({ state: "visible", timeout: 60_000 });
  await d.focus(nb.getByText(/p50 and p95 by day/).first());
  await d.hold(1800);

  const again = await askInChat(d, chat, "I changed the window. Does it still hold?");
  await d.park();
  await again.waitFor({ state: "detached", timeout: 300_000 });
  await d.settle(800);
  await d.hold(3500);
  d.mark("end");
});
