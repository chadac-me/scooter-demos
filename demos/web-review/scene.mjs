import { scene } from "../../lib/director.mjs";

// Each note: where it goes on the app, and what it says.
const NOTES = [
  { target: 'tr[data-id="TW-48207"] .badge', note: "Statuses all look the same. Make Delayed stand out." },
  { target: 'th[data-col="eta"]', note: "Dispatch reads ETA first, put it next to Shipment." },
  { target: ".brand .name", note: "Use our logo here, not just the name." },
];

export default scene(async (d) => {
  // Off camera: start Review and open it, so it opens running.
  await d.open();
  await d.ask("Open our shipment tracker", { timeout: 600_000 });
  const link = d.page.getByRole("link", { name: "Shipment tracker" }).last();
  await link.waitFor({ state: "visible" });
  const popup = d.page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await link.click();
  const tab = (await popup) ?? d.page;
  await d.use(tab);
  const app = tab.frameLocator("iframe#frame");
  await app.locator("#shipments tbody tr").first().waitFor({ state: "visible", timeout: 300_000 });
  await tab.frameLocator('iframe[title="Scooter chat"]').locator('[aria-label="Message input"]').waitFor({ timeout: 60_000 });
  await d.settle(1000);

  d.mark("begin");
  await d.hold(1200);
  for (const [i, { target, note }] of NOTES.entries()) {
    await d.click("#point");
    // Point mode reaches the app by postMessage; wait for it.
    await app.locator(".catcher:not([hidden])").waitFor();
    await d.click(app.locator(target));
    await d.typeIn(app.locator(".pop textarea"), note, { cps: 22 });
    await d.hold(300);
    await d.click(app.locator(".pop .save"));
    await d.hold(400);
    // The note wakes Scooter, which edits the app and resolves it.
    await app.locator(".pin.resolved").nth(i).waitFor({ timeout: 120_000 });
    await app.locator("#shipments tbody tr").first().waitFor({ state: "visible" });
    await d.hold(1500);
  }
  await d.click("#pins");
  await d.click('#filter [data-filter="all"]');
  await tab.locator("#list li.resolved").nth(NOTES.length - 1).waitFor();
  await d.park();
  await d.settle(600);
  d.mark("poster");
  await d.hold(2500);
  d.mark("end");
});
