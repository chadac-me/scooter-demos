import { scene, sel } from "../../lib/director.mjs";

const card = '[data-testid="aws-permissions-card"]';
const detail = '[data-testid="approval-detail"]';

export default scene(async (d) => {
  await d.open();
  d.mark("begin");
  await d.hold(600);
  await d.ask("Delete last quarter's CI artifacts from the dev artifacts bucket");
  await d.focus(card);
  await d.hold(1800);
  await d.click('[data-testid="interrupt-open-detail"]');
  await d.focus(detail);
  await d.hold(1200);
  d.mark("poster");
  await d.hold(2500);
  await d.click(`${detail} [data-testid="interrupt-option"][data-option-id="approve"]`);
  // The broker's answer wakes a fresh run.
  await d.page.locator(sel.runStatus).first().waitFor({ state: "visible", timeout: 30_000 });
  await d.waitForReply();
  await d.scrollToEnd();
  await d.hold(3500);
  d.mark("end");
});
