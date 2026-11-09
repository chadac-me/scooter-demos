import { scene } from "../../lib/director.mjs";

export default scene(async (d) => {
  await d.open();
  d.mark("begin");
  await d.hold(600);
  // A real sandbox boots and starts marimo, so allow minutes, not seconds.
  await d.ask("Make me a notebook that charts our CI run times by workflow", { timeout: 600_000 });
  const link = d.page.getByRole("link", { name: "ci_trends.py" }).last();
  await link.waitFor({ state: "visible" });
  await d.scrollToEnd();
  await d.hold(1200);

  // The link may open a tab; in kiosk mode that fills the recorded screen.
  const popup = d.page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await d.click(link);
  const tab = (await popup) ?? d.page;
  await d.use(tab);
  const nb = tab.frameLocator("#marimo");
  await nb.locator("svg rect").first().waitFor({ state: "visible", timeout: 300_000 });
  await d.settle(800);
  d.mark("poster");
  await d.hold(1200);

  // Drag the slider to 30 days and watch the chart recompute.
  const thumb = nb.getByRole("slider").first();
  await d.drag(thumb, { dx: 220 });
  await d.hold(1600);

  // Switch workflow from the dropdown.
  await nb.locator("select").first().selectOption("e2e fast");
  await d.hold(2400);
  d.mark("end");
});
