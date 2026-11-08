{
  description = "Reproducible demo videos of Scooter";

  inputs = {
    # The Scooter version every video shows; `nix flake update scooter` moves it.
    scooter.url = "github:chadac/scooter/feat/fake-backend-agent-bin";
    nixpkgs.follows = "scooter/nixpkgs";
  };

  outputs = { self, scooter, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system} system);
    in
    {
      devShells = forAll (pkgs: system: {
        # Scooter's own dev shell (node, postgres, router, chromium) plus capture tools.
        default = pkgs.mkShell {
          inputsFrom = [ scooter.devShells.${system}.default ];
          packages = with pkgs; [ ffmpeg-full xorg.xorgserver ];
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
