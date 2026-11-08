import { scene } from "../../lib/director.mjs";

export default scene(async (d) => {
  await d.open();
  d.mark("begin");
  await d.hold(600);
  await d.ask("Build me a dashboard of last week's CI runs and show it here");
  await d.page.locator('[data-testid="share-embed"] iframe').waitFor({ state: "visible" });
  await d.scrollToEnd();
  // Let the embedded page paint and its charts animate in.
  await d.hold(1800);
  d.mark("poster");
  // Hover a bar, so the tooltip shows the chart is live.
  const bar = d.page.frameLocator('[data-testid="share-embed"] iframe').locator("rect.bar").first();
  await d.moveTo(bar);
  await d.hold(3000);
  d.mark("end");
});
