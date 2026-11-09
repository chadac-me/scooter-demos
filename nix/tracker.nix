# Demo-only tracker service: app, chat and pins that wake Scooter.
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
    # The server emits only relative URLs, so it serves at root.
    stripBasePath = true;
    # Root, so it and the agent's shell share the files.
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
