import { scene, sel } from "../../lib/director.mjs";

export default scene(async (d) => {
  await d.open();
  d.mark("begin");
  await d.hold(600);
  // The reply keeps driving GPlates after the link.
  await d.ask("Open GPlates and show me the plate reconstruction at 120 Ma with the coastlines.", { wait: false });
  await d.hold(800);
  const link = d.page.getByRole("link", { name: "Desktop" }).last();
  // Skip the sandbox boot and the desktop starting.
  await d.cut(() => link.waitFor({ state: "visible", timeout: 600_000 }));
  await d.scrollToEnd();
  await d.hold(800);

  const popup = d.page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await d.click(link);
  const tab = (await popup) ?? d.page;
  const screen = tab.locator("#screen canvas").first();
  const chat = tab.frameLocator("#scooter");
  await d.cut(async () => {
    await d.use(tab);
    await screen.waitFor({ state: "visible", timeout: 60_000 });
    await chat.locator(sel.composer).waitFor({ timeout: 60_000 });
  });

  // Scooter loads coastlines and sets 120 Ma; the user watches.
  await chat.getByText("Drag the globe to look around").waitFor({ timeout: 300_000 });
  await d.hold(1500);

  // Bring the South Atlantic to the middle.
  await d.dragOn(screen, [560, 470], [470, 390], { duration: 1400 });
  await d.hold(1000);

  await d.typeIn(chat.locator(sel.composer), "Export that as a PNG for my slides");
  await d.hold(350);
  await tab.keyboard.press("Enter");
  await d.park();
  await chat.getByText("It's saved as").waitFor({ timeout: 180_000 });
  await chat.locator(sel.thread).first().evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
  await d.settle(900);
  d.mark("poster");
  await d.hold(3000);
  d.mark("end");
});
