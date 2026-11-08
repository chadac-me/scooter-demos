import { scene } from "../../lib/director.mjs";

export default scene(async (d) => {
  await d.open();
  d.mark("begin");
  await d.hold(600);
  await d.ask("Why does the Gaussian integral come out to √π?");
  await d.focus(".katex-display >> nth=1");
  d.mark("poster");
  await d.hold(3000);
  d.mark("end");
});
