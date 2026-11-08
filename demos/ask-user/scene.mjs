import { scene } from "../../lib/director.mjs";

const card = '[data-testid="question-request"]';

export default scene(async (d) => {
  await d.open();
  d.mark("begin");
  await d.hold(600);
  await d.ask("Add persistent storage to the bookmarks API", { wait: false });
  await d.focus(card);
  await d.hold(1500);
  d.mark("poster");
  await d.click(d.page.locator('[data-testid="question-option"]').filter({ hasText: "SQLite" }));
  await d.hold(500);
  await d.submitCard(card, '[data-testid="question-submit"]');
  await d.waitForReply();
  await d.hold(3000);
  d.mark("end");
});
