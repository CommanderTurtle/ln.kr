{
  lib,
  stdenvNoCC,
  makeWrapper,
  nodejs,
}:
stdenvNoCC.mkDerivation {
  name = "lnkr";

  src = ./.;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin $out/lib/docs
    cp docs/alphabets.js docs/compress.js docs/text-compress.js $out/lib/docs
    cp standalone.js package.json $out/lib
    makeWrapper ${lib.getExe nodejs} $out/bin/lnkr \
      --add-flags "$out/lib/standalone.js"
    runHook postInstall
  '';

  meta = {
    description = "Lossless text and code carried entirely in a link";
    homepage = "https://a.shel.sh";
    mainProgram = "lnkr";
    license = lib.licenses.mit;
  };
}
