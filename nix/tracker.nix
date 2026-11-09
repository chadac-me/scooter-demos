# Tidewater Freight's shipment tracker: a custom web service the webservice demo
# opens. Demo-only, not a Scooter feature: the app, the chat beside it, and pins
# that wake the conversation through self-access.
{ pkgs, ... }:

let
  tracker = ../demos/webservice/tracker;
  seed = ../demos/webservice/app;
  python = "${pkgs.python3}/bin/python3";
  cli = pkgs.writeShellScriptBin "tracker" ''
    exec ${python} ${tracker}/server.py "$@"
  '';
in
{
  environment.systemPackages = [ cli ];

  webServices.tracker = {
    enable = true;
    port = 2730;
    displayName = "Shipment tracker";
    # Every URL the server emits is relative, so it serves at root.
    stripBasePath = true;
    # Root, like the agent's shell, so both edit the same files.
    user = "root";
    workingDirectory = "/workspace";
    environment = {
      TRACKER_APP_DIR = "/workspace/tracker";
      TRACKER_SEED = "${seed}";
    };
    command = "${python} ${tracker}/server.py";
    hint = "Pins arrive as tracker messages; run `tracker resolve <id>` once one is addressed.";
  };
}
