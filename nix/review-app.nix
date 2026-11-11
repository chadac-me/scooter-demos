# The web-review demo's app: Tidewater's tracker, under Review.
{ pkgs, ... }:

let
  demo = ../demos/web-review;
  dir = "/workspace/tracker";
in
{
  # What `review target --run … --port 5173 --cwd /workspace/tracker` writes.
  webReview.target = {
    port = 5173;
    run = ''${pkgs.python3}/bin/python3 ${demo}/serve.py --port 5173 --base "$REVIEW_BASE"'';
    cwd = dir;
  };
  # Headless snaps are unused, and the image stays offline.
  webReview.chromium = null;

  # Seeds the app's source before the dev server enters it.
  systemd.services.tracker-seed = {
    unitConfig.ConditionPathExists = "!${dir}";
    serviceConfig.Type = "oneshot";
    script = ''
      cp -r ${demo}/app ${dir}
      chmod -R u+w ${dir}
    '';
  };
  systemd.services.webservice-review-dev = {
    requires = [ "tracker-seed.service" ];
    after = [ "tracker-seed.service" ];
  };
}
