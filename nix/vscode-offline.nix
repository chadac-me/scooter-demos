# Offline cluster: bake code-server, AHP bridge, node and repo in.
{ scooter }:
{ lib, pkgs, ... }:

let
  npmTarball = name: version: hash: pkgs.fetchurl {
    url = "https://registry.npmjs.org/${name}/-/${lib.last (lib.splitString "/" name)}-${version}.tgz";
    inherit hash;
  };
  # Node types, so the editor shows no red squiggles.
  nodeModules = pkgs.runCommand "courier-node-modules" { } ''
    mkdir -p $out/@types/node $out/undici-types
    tar -xzf ${npmTarball "@types/node" "24.19.2" "sha512-93d49wCWJkCyN87MxLpNN6KXPCwFw7bVUg79mGUV1OS40JGWwVCr8n61DXCSqz7CV6/VfPkb7xec7uP2M+QHWQ=="} -C $out/@types/node --strip-components=1
    tar -xzf ${npmTarball "undici-types" "7.24.6" "sha512-WRNW+sJgj5OBN4/0JpHFqtqzhpbnV0GuB+OozA9gCL7a993SmU+1JBZCzLNxYsbMfIeDL+lTsphD5jN5N+n0zg=="} -C $out/undici-types --strip-components=1
  '';
  repo = ../demos/vscode/repo;

  # patchelf corrupts the bundled node; use nixpkgs' same version.
  codeServer = prev: (prev.callPackage "${scooter}/contrib/code-server/code-server-bin" { }).overrideAttrs (o: {
    postInstall = (o.postInstall or "") + ''
      ln -sf ${prev.nodejs_24}/bin/node $out/libexec/code-server/lib/node
    '';
  });

  # Follow the browser theme; skip first-run prompts.
  settings = pkgs.writeText "code-server-settings.json" (builtins.toJSON {
    "window.autoDetectColorScheme" = true;
    "workbench.preferredLightColorTheme" = "Default Light Modern";
    "workbench.preferredDarkColorTheme" = "Default Dark Modern";
    "workbench.startupEditor" = "none";
    "workbench.tips.enabled" = false;
    "security.workspace.trust.enabled" = false;
    "chat.agentHost.allowSignedOutWhenUsable" = true;
    "files.exclude" = { "**/.*" = true; "node_modules" = true; };
    "git.autofetch" = false;
    "editor.minimap.enabled" = false;
    "update.showReleaseNotes" = false;
    "telemetry.telemetryLevel" = "off";
  });
in
{
  # After the stub overlay, so this code-server replaces its shim.
  nixpkgs.overlays = lib.mkAfter [ (final: prev: { code-server = codeServer prev; }) ];

  # The real AHP bridge behind its stub, so first start skips building.
  system.extraDependencies = [ pkgs.scooter-vscode-ahp.real ];

  environment.systemPackages = [ pkgs.nodejs ];

  # code-server runs as root, so settings live under /root.
  systemd.tmpfiles.rules = [
    "d /root/.local/share/code-server/User 0755 root root -"
    "C /root/.local/share/code-server/User/settings.json 0644 root root - ${settings}"
  ];

  # Seed an empty /workspace with the demo repo.
  systemd.services.courier-checkout = {
    description = "check out the vscode demo's repo at /workspace";
    wantedBy = [ "multi-user.target" ];
    after = [ "workspace.mount" "local-fs.target" ];
    path = [ pkgs.git pkgs.coreutils ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
    script = ''
      [ -e /workspace/.git ] && exit 0
      mkdir -p /workspace
      cp -r --no-preserve=mode ${repo}/. /workspace/
      mkdir -p /workspace/node_modules
      cp -r --no-preserve=mode ${nodeModules}/. /workspace/node_modules/
      cd /workspace
      git init -q -b main
      # Platform state under .scooter/ changes as we commit.
      echo .scooter/ >> .git/info/exclude
      git add -- $(ls -A ${repo})
      git -c user.name=Courier -c user.email=dev@courier.test commit -qm "Deliver order webhooks"
    '';
  };
}
