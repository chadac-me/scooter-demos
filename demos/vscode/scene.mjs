import { scene } from "../../lib/director.mjs";

export default scene(async (d) => {
  await d.open();
  d.mark("begin");
  await d.hold(600);
  await d.ask("Open the courier repo in VS Code", { timeout: 600_000 });
  const link = d.page.getByRole("link", { name: "courier in VS Code" }).last();
  await link.waitFor({ state: "visible" });
  await d.scrollToEnd();
  await d.hold(1200);

  const popup = d.page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await d.click(link);
  const tab = (await popup) ?? d.page;
  await d.use(tab);
  await tab.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 300_000 });
  await d.settle(4000);
  await tab.screenshot({ path: "/tmp/vs-1.png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/vs-1.html", await tab.content());
  d.mark("end");
});
