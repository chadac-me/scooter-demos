import { scene } from "../../lib/director.mjs";

// Each pin: where it goes on the app, and the note left there.
const PINS = [
  { target: 'tr[data-id="TW-48207"] .badge', note: "Statuses all look the same. Make Delayed stand out." },
  { target: 'th[data-col="eta"]', note: "Dispatch reads ETA first, put it next to Shipment." },
  { target: ".brand .name", note: "Use our logo here, not just the name." },
];

export default scene(async (d) => {
  // Off camera: start the tracker and open it, as if it were already running.
  await d.open();
  await d.ask("Open our shipment tracker", { timeout: 600_000 });
  const link = d.page.getByRole("link", { name: "Shipment tracker" }).last();
  await link.waitFor({ state: "visible" });
  const popup = d.page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await link.click();
  const tab = (await popup) ?? d.page;
  await d.use(tab);
  const app = tab.frameLocator("#app iframe, iframe#app").first();
  await app.locator("#shipments tbody tr").first().waitFor({ state: "visible", timeout: 300_000 });
  await tab.frameLocator("#chat iframe, iframe#chat").first().locator('[aria-label="Message input"]').waitFor({ timeout: 60_000 });
  await d.settle(1000);

  d.mark("begin");
  await d.hold(1200);
  await d.click(app.locator("#tw-toggle"));
  for (const [i, pin] of PINS.entries()) {
    await d.click(app.locator(pin.target));
    await d.typeIn(app.locator("#tw-note"), pin.note, { cps: 22 });
    await d.hold(300);
    await tab.keyboard.press("Enter");
    await d.hold(400);
    // Scooter is woken by the pin, edits the app, and resolves it.
    await app.locator(`.tw-pin.resolved[data-pin="${i + 1}"]`).waitFor({ timeout: 120_000 });
    await app.locator("#shipments tbody tr").first().waitFor({ state: "visible" });
    await d.hold(1500);
  }
  await d.click(app.locator("#tw-toggle"));
  await d.park();
  await d.settle(600);
  d.mark("poster");
  await d.hold(2500);
  d.mark("end");
});
