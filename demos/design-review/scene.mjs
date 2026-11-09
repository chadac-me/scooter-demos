import { scene, sel } from "../../lib/director.mjs";

export default scene(async (d) => {
  await d.open();
  const chat = d.page;
  d.mark("begin");
  await d.ask("Design retry handling for the outbox and send it to me", { wait: false, cps: 26 });
  await d.hold(800);
  // Skip the sandbox boot.
  await d.cut(() => chat.getByText("Reasoning").first().waitFor({ state: "visible", timeout: 600_000 }));
  // Show the turn starting, then skip to its reply.
  await d.hold(1500);
  await d.cut(() => d.waitForReply());
  const link = chat.getByRole("link", { name: "outbox-retry.md" }).last();
  await link.waitFor({ state: "visible" });
  await d.scrollToEnd();
  await d.hold(500);

  // A new tab, if any, fills the kiosk screen.
  const popup = chat.context().waitForEvent("page", { timeout: 2000 }).catch(() => null);
  await d.click(link);
  let files = chat;
  const q1 = () => files.locator('[data-question="attempt-limit"]');
  // The video skips the page load.
  await d.cut(async () => {
    files = (await popup) ?? chat;
    // Without a new tab, wait for the in-place navigation.
    if (files === chat) await chat.waitForURL(/\/files(\/|\?|$)/);
    await d.use(files);
    await q1().waitFor({ state: "visible", timeout: 120_000 });
    await d.settle(600);
  });
  await d.hold(600);

  // Answer first, so its wake runs before the comment's.
  await d.focus(q1());
  await d.click(q1().getByText("10 attempts (about 30 min)"));
  await d.click(q1().getByRole("button", { name: "Answer" }));
  await d.hold(300);

  // Select the claim line and comment on it.
  const claim = files.locator("article li").filter({ hasText: "several relays can run at once" });
  await d.focus(claim);
  const [from, to] = await claim.evaluate((li) => {
    const r = document.createRange();
    r.selectNodeContents(li);
    const rects = [...r.getClientRects()].filter((x) => x.width > 0);
    const a = rects[0];
    const b = rects.at(-1);
    return [
      { x: a.left + 1, y: a.top + a.height / 2 },
      { x: b.right - 1, y: b.top + b.height / 2 },
    ];
  });
  await d.glide(from, 450);
  await files.mouse.down();
  await d.glide(to, 800);
  await files.mouse.up();
  await d.hold(250);
  await d.click(files.getByRole("button", { name: "Comment", exact: true }));
  const rail = files.locator("aside[data-comments]");
  await d.typeIn(rail.getByPlaceholder("Leave a comment for the agent…"), "What happens during a rolling deploy?", { cps: 26 });
  await d.click(rail.getByRole("button", { name: "Comment", exact: true }));
  await d.hold(300);

  // Each remark wakes Scooter in the chat.
  if (files === chat) {
    await d.click(files.getByTitle("Back to the conversation"));
    await d.cut(async () => {
      await chat.locator(sel.thread).first().waitFor({ state: "visible" });
      await d.use(chat);
      await d.settle(300);
    });
  } else {
    await d.use(chat);
  }
  await d.scrollToEnd();
  await d.hold(1500);
  await d.cut(() => chat.getByText("nothing is open now").waitFor({ state: "visible", timeout: 120_000 }));
  await d.scrollToEnd();
  await d.hold(700);

  // Back in Files: the revised section, Scooter's reply, nothing open.
  await d.cut(async () => {
    // The doc link is far up; go back instead.
    if (files === chat) await chat.goBack();
    await d.use(files);
    await rail.getByText("1 resolved").waitFor({ state: "visible", timeout: 30_000 });
    await d.settle(300);
  });
  await d.focus(files.getByRole("heading", { name: "Rolling deploys" }));
  await d.hold(700);
  // Resolving folds the thread; unfold it to read Scooter's reply.
  await d.click(rail.getByTitle("Expand thread"));
  await rail.getByText("Scooter").first().waitFor({ state: "visible", timeout: 10_000 });
  await d.park();
  await d.settle(500);
  d.mark("poster");
  await d.hold(1500);
  d.mark("end");
});
