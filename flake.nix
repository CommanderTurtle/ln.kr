{
  description = "A Flake providing the ln.kr text-link codec";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin"; # last branch to suppport Intel macOS
  };

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f {
            pkgs = import nixpkgs { inherit system; };
            system = system;
          }
        );
    in
    {
      packages = forAllSystems (
        {
          pkgs,
          system,
        }:
        {
          lnkr = pkgs.callPackage ./package.nix { };
          default = self.packages.${system}.lnkr;
        }
      );
    };
}
