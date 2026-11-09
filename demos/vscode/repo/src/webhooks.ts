import { withRetry } from "./retry.ts";

export interface Delivery {
  url: string;
  event: string;
  payload: unknown;
}

/** POST one webhook, retrying on network errors and 5xx. */
export async function deliver(d: Delivery, post = fetch): Promise<void> {
  await withRetry(async () => {
    const res = await post(d.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-courier-event": d.event },
      body: JSON.stringify(d.payload),
    });
    if (res.status >= 500) throw new Error(`${d.url}: ${res.status}`);
  });
}
