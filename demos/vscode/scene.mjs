import { scene } from "../../lib/director.mjs";

// VS Code's workbench, from code-server 4.141.
const vs = {
  workbench: ".monaco-workbench",
  harness: '[aria-label="Local"]',
  scooter: ".action-widget .title",
  input: ".interactive-input-editor",
  reply: ".interactive-list",
  scm: '.activitybar [aria-label^="Source Control"]',
  change: ".scm-view .resource",
  diff: ".monaco-diff-editor",
  terminal: ".terminal-wrapper",
};

export default scene(async (d) => {
  await d.open();
  d.mark("begin");
  await d.hold(600);
  await d.ask("Open the courier repo in VS Code", { wait: false });
  await d.hold(800);
  // Skip the sandbox boot.
  await d.cut(() => d.page.getByText("Reasoning").first().waitFor({ state: "visible", timeout: 600_000 }));
  await d.hold(1500);
  await d.cut(() => d.waitForReply({ timeout: 600_000 }));
  const link = d.page.getByRole("link", { name: "courier in VS Code" }).last();
  await link.waitFor({ state: "visible" });
  await d.scrollToEnd();
  await d.hold(1200);

  // The link may open a tab; in kiosk mode that fills the recorded screen.
  const popup = d.page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await d.click(link);
  const tab = (await popup) ?? d.page;
  // Skip code-server starting and the workbench loading.
  await d.cut(async () => {
    await d.use(tab);
    await tab.locator(vs.workbench).waitFor({ state: "visible", timeout: 300_000 });
    await d.settle(3000);
  });
  await d.hold(800);

  // The Scooter harness: this conversation, continued from VS Code.
  await d.click(tab.locator(vs.harness).first());
  await d.hold(500);
  await d.click(tab.locator(vs.scooter, { hasText: /^Scooter$/ }).first());
  await d.cut(() => tab.locator(vs.input).getByText("Chat with Scooter").waitFor({ state: "visible", timeout: 60_000 }));
  await d.hold(1200);

  await d.typeIn(tab.locator(vs.input).first(), "withRetry never gives up when a receiver stays down. Cap it at five attempts and add a test.");
  await d.hold(350);
  await tab.keyboard.press("Enter");
  await d.park();
  await tab.locator(vs.reply).getByText("RetryExhaustedError").last()
    .waitFor({ state: "visible", timeout: 180_000 });
  await d.settle(800);
  await d.hold(1500);

  // The edit, as VS Code's own diff.
  await d.click(tab.locator(vs.scm).first());
  const change = tab.locator(vs.change, { hasText: "retry.ts" }).filter({ hasNotText: "test" }).first();
  await change.waitFor({ state: "visible", timeout: 30_000 });
  await d.hold(600);
  await d.click(change);
  await tab.locator(vs.diff).first().waitFor({ state: "visible", timeout: 30_000 });
  await d.settle(1000);
  d.mark("poster");
  await d.hold(3000);

  // The new test, in VS Code's terminal.
  await tab.keyboard.press("Control+Backquote");
  await tab.locator(vs.terminal).first().waitFor({ state: "visible", timeout: 30_000 });
  await d.settle(1500);
  // Tall enough that every test result stays on screen.
  await d.click(tab.locator('[aria-label="Maximize Panel"]').first());
  await d.settle(600);
  for (const ch of "npm test") {
    await tab.keyboard.type(ch);
    await d.hold(70);
  }
  await d.hold(300);
  await tab.keyboard.press("Enter");
  await d.hold(5000);
  d.mark("end");
});
