# The demo cluster's pods have no internet, so marimo is baked into the image
# instead of fetched by uv at start. Same flags as Scooter's marimo service.
{ lib, pkgs, ... }:

let
  python = pkgs.python3.withPackages (p: [ p.marimo ]);
  settings = (pkgs.formats.toml { }).generate "marimo.toml" { runtime.auto_instantiate = true; };
in
{
  webServices.marimo.command = lib.mkForce "${pkgs.writeShellScript "marimo-offline" ''
    set -euo pipefail
    base="''${SCOOTER_SERVICE_PREFIX-/c/''${CONVERSATION_ID:-unknown}}/marimo"
    proxy_args=()
    if [ -n "''${PUBLIC_HOST:-}" ]; then proxy_args+=(--proxy "''${PUBLIC_HOST}"); fi
    # Notebooks open computed, as on a real deployment.
    mkdir -p "$XDG_CONFIG_HOME/marimo"
    [ -s "$XDG_CONFIG_HOME/marimo/marimo.toml" ] || install -m 644 ${settings} "$XDG_CONFIG_HOME/marimo/marimo.toml"
    exec ${python}/bin/marimo edit --host 0.0.0.0 --port 2718 \
      --base-url "$base" "''${proxy_args[@]}" --headless --no-token
  ''}";
}
