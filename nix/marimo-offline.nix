# The demo cluster's pods have no internet, so marimo is baked into the image
# instead of fetched by uv at start. Same flags as Scooter's notebook service,
# launch.py and the Agent panel's page head included.
{ scooter }:
{ lib, pkgs, ... }:

let
  python = pkgs.python3.withPackages (p: [ p.marimo ]);
  notebook = "${scooter}/contrib/marimo/notebook";
  settings = (pkgs.formats.toml { }).generate "marimo.toml" {
    runtime.auto_instantiate = true;
    # Follow the browser, so dark renders get a dark notebook.
    display.theme = "system";
    # launch.py's override can't patch nixpkgs' marimo; the user setting does the same.
    experimental.external_agents = true;
  };
in
{
  webServices.notebook.command = lib.mkForce "${pkgs.writeShellScript "marimo-offline" ''
    set -euo pipefail
    prefix="''${SCOOTER_SERVICE_PREFIX-/c/''${CONVERSATION_ID:-unknown}}"
    proxy_args=()
    if [ -n "''${PUBLIC_HOST:-}" ]; then proxy_args+=(--proxy "''${PUBLIC_HOST}"); fi
    # The Agent panel's socket, on this page's origin; agent-host serves it.
    SCOOTER_MARIMO_HEAD="<script>window.SCOOTER_ACP_PATH=\"$prefix/_scooter/acp\";</script><script>$(${pkgs.coreutils}/bin/cat ${notebook}/agent-panel.js)</script>"
    export SCOOTER_MARIMO_HEAD
    # Notebooks open computed, as on a real deployment.
    config="''${XDG_CONFIG_HOME:-$HOME/.config}/marimo"
    mkdir -p "$config"
    [ -s "$config/marimo.toml" ] || install -m 644 ${settings} "$config/marimo.toml"
    exec ${python}/bin/python ${notebook}/launch.py edit --host 0.0.0.0 --port 2718 \
      --base-url "$prefix/notebook" "''${proxy_args[@]}" --headless --no-token
  ''}";
}
