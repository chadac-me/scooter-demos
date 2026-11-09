{
  description = "Reproducible demo videos of Scooter";

  inputs = {
    # The Scooter version every video shows; `nix flake update scooter` moves it.
    scooter.url = "github:chadac-me/scooter";
    nixpkgs.follows = "scooter/nixpkgs";
  };

  outputs = { self, scooter, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system} system);

      # k3d's registry: `.localhost` resolves on the host and in the cluster.
      registry = "k3d-scooter-reg.localhost:5800/";

      # The replay agent with its node_modules and every demo's script baked in.
      replayAgent = pkgs: pkgs.buildNpmPackage {
        pname = "replay-agent";
        version = "0";
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions [ ./package.json ./package-lock.json ./lib/replay-agent ./demos ];
        };
        npmDeps = pkgs.importNpmLock { npmRoot = ./.; };
        npmConfigHook = pkgs.importNpmLock.npmConfigHook;
        dontNpmBuild = true;
        # Browsers are the renderer's business, not the agent's.
        env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
        nativeBuildInputs = [ pkgs.makeWrapper ];
        installPhase = ''
          mkdir -p $out/lib/replay-agent $out/share
          npm prune --omit=dev --no-audit --no-fund
          rm -rf node_modules/playwright-core node_modules/.bin
          cp -r node_modules lib/replay-agent/agent.mjs $out/lib/replay-agent/
          cp -r demos $out/share/demos
          makeWrapper ${pkgs.nodejs}/bin/node $out/bin/replay-agent \
            --add-flags $out/lib/replay-agent/agent.mjs \
            --set-default DEMO_SCRIPTS $out/share/demos
        '';
        meta.mainProgram = "replay-agent";
      };

      # Scooter's own e2e cluster config, with the replay agent in place of goose.
      clusterPlatform = pkgs: system: scooter.lib.evalPlatform {
        inherit system;
        buildSystem = system;
        module = { config, lib, ... }: let
          test = import "${scooter}/.github/deployment/test-platform.nix" {
            inherit lib;
            scooterSkills = scooter.lib.scooterSkills;
            # The sandbox services cluster demos open: notebook, files viewer, VS Code.
            testContribs = {
              marimo.enable = true;
              files.enable = true;
              "code-server".enable = true;
            };
          } registry;
        in {
          imports = [
            "${scooter}/modules/testing.nix"
            {
              # `contribs` sits at the module root, not under `scooter`.
              contribs = test.contribs;
              scooter = builtins.removeAttrs test [ "contribs" ];
            }
          ];
          scooter = {
            testing.fakeAgent = false;
            # Self-access, so Files remarks and app pins wake the agent.
            conversationController.selfAccess.enable = true;
            agent.command.program = replayAgent pkgs;
            # One plain model, so the picker shows no provider groups.
            agent.availableModels = lib.mkForce { goose."claude-opus".default = true; };
            # Above testing.nix's mkForce: code-server outgrows 1Gi.
            sandboxResources = lib.mkOverride 40 {
              requests = { cpu = "250m"; memory = "256Mi"; };
              limits = { cpu = "2"; memory = "3Gi"; };
            };
            # Gives sandboxes a CONVERSATION_URL, so the notebook page shows the chat.
            ingress.host = "scooter.e2e.test";
            # Pods have no internet, so demo tools ship in the image.
            images.agent-sandbox-os.package = let c = config.scooter.config; in (import "${scooter}/pkgs/sandbox-os/image.nix" {
              inherit lib;
              inherit (c) n2c nixStubs deploymentModules;
              pkgs = c.sandboxPkgs;
              extraModules = [
                ./nix/marimo-offline.nix
                (import ./nix/vscode-offline.nix { inherit scooter; })
                ./nix/tracker.nix
              ];
            }).image;
          };
        };
      };
    in
    {
      packages = forAll (pkgs: system:
        let
          cfg = (clusterPlatform pkgs system).config;
          images = nixpkgs.lib.filterAttrs (_: i: i.package != null && i.attr != null) cfg.scooter.images;
        in
        {
          replay-agent = replayAgent pkgs;
          # Manifests plus a script that pushes every image they name to the k3d registry.
          cluster = pkgs.runCommand "scooter-demos-cluster" { } ''
            mkdir -p $out/bin
            cp ${cfg.kubernetes.resultYAML} $out/platform.yaml
            cat > $out/bin/push-images <<'SH'
            #!${pkgs.runtimeShell}
            set -euo pipefail
            ${nixpkgs.lib.concatMapStrings (i: ''
              echo "push ${i.ref.fullUrl}"
              ${i.package.copyTo}/bin/copy-to "docker://localhost:5800/${nixpkgs.lib.removePrefix registry i.ref.fullUrl}" --dest-tls-verify=false
            '') (builtins.attrValues images)}
            SH
            chmod +x $out/bin/push-images
          '';
        });

      devShells = forAll (pkgs: system: {
        # Scooter's own dev shell (node, postgres, router, chromium) plus capture tools.
        default = pkgs.mkShell {
          inputsFrom = [ scooter.devShells.${system}.default ];
          packages = with pkgs; [ ffmpeg-full xorg.xorgserver kubectl openssl ];
          # Fixed fonts, so text metrics match on every machine.
          FONTCONFIG_FILE = pkgs.makeFontsConf {
            fontDirectories = with pkgs; [ inter noto-fonts noto-fonts-color-emoji jetbrains-mono ];
          };
          SCOOTER_SRC = "${scooter}";
          SCOOTER_REV = scooter.rev or "dirty";
        };
      });
    };
}
