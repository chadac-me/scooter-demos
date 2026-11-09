# Xvfb, openbox and GPlates, shown via noVNC beside the chat.
{ pkgs, ... }:

let
  width = 1000;
  height = 900;

  # The pod has no GPU, so GL is Mesa's llvmpipe.
  gl = ''
    export LD_LIBRARY_PATH=${pkgs.mesa}/lib:${pkgs.libglvnd}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
    export LIBGL_DRIVERS_PATH=${pkgs.mesa}/lib/dri
    export __EGL_VENDOR_LIBRARY_DIRS=${pkgs.mesa}/share/glvnd/egl_vendor.d
  '';

  gplates = pkgs.writeShellScriptBin "gplates" ''
    ${gl}
    export DISPLAY=''${DISPLAY:-:1}
    exec ${pkgs.gplates}/bin/gplates "$@"
  '';

  # Only the sample rotations and coastlines from the bundle.
  geodata = pkgs.runCommand "gplates-geodata" {
    nativeBuildInputs = [ pkgs.unzip ];
    src = pkgs.fetchurl {
      url = "https://zenodo.org/records/14194897/files/gplates_2.5.0_geodata.zip";
      hash = "sha256-OHqRLPVgZXx+S2PZqNZgVegfIVkDpk91XqIH1QDIBRs=";
    };
  } ''
    unzip -q $src 'GeoData/FeatureCollections/Rotations/*.rot' \
      'GeoData/FeatureCollections/Coastlines/*.gpmlz'
    mkdir -p $out
    mv GeoData/FeatureCollections/Rotations GeoData/FeatureCollections/Coastlines $out/
  '';

  openboxRc = pkgs.writeText "rc.xml" ''
    <?xml version="1.0" encoding="UTF-8"?>
    <openbox_config xmlns="http://openbox.org/3.4/rc">
      <desktops><number>1</number></desktops>
      <applications>
        <application class="*"><decor>no</decor></application>
        <application title="GPlates (*" type="normal"><maximized>yes</maximized></application>
      </applications>
    </openbox_config>
  '';

  # The desktop on the left, this conversation's chat on the right.
  page = pkgs.writeText "index.html" ''
    <!doctype html>
    <html lang="en">
    <head>
    <meta charset="utf-8">
    <title>Desktop</title>
    <style>
      :root { color-scheme: light dark; --line: #d4d4d8; }
      @media (prefers-color-scheme: dark) { :root { --line: #3f3f46; } }
      html, body { margin: 0; height: 100%; overflow: hidden; background: #2b2b2b; }
      #layout { display: flex; height: 100%; }
      #screen { flex: 1; min-width: 0; }
      #chat { flex: none; width: 440px; border-left: 1px solid var(--line); background: Canvas; }
      iframe { display: block; width: 100%; height: 100%; border: 0; }
    </style>
    </head>
    <body>
    <div id="layout"><div id="screen"></div><div id="chat"></div></div>
    <script type="module">
      import RFB from "./novnc/core/rfb.js";
      const CHAT_URL = "@CHAT_URL@";
      if (CHAT_URL) {
        const f = document.createElement("iframe");
        f.id = "scooter";
        f.title = "Scooter chat";
        f.src = CHAT_URL;
        document.getElementById("chat").append(f);
      }
      // Relative, so it works under any service prefix.
      const ws = new URL("websockify", location.href);
      ws.protocol = ws.protocol === "https:" ? "wss:" : "ws:";
      function connect() {
        const rfb = new RFB(document.getElementById("screen"), ws.href);
        rfb.scaleViewport = true;
        rfb.addEventListener("disconnect", () => setTimeout(connect, 1000));
      }
      connect();
    </script>
    </body>
    </html>
  '';

  start = pkgs.writeShellScript "desktop" ''
    set -eu
    run=''${RUNTIME_DIRECTORY%%:*}
    ${pkgs.xorg-server}/bin/Xvfb :1 -screen 0 ${toString width}x${toString height}x24 \
      -nolisten tcp +extension GLX &
    for _ in $(seq 50); do [ -e /tmp/.X11-unix/X1 ] && break; sleep 0.1; done
    export DISPLAY=:1
    ${pkgs.openbox}/bin/openbox --config-file ${openboxRc} &
    ${pkgs.x11vnc}/bin/x11vnc -display :1 -forever -shared -nopw -localhost \
      -rfbport 5901 -quiet &

    # The chat lives on the main UI origin, at /chat/<id>.
    chat=""
    if [ -n "''${CONVERSATION_URL:-}" ]; then
      chat="$(printf %s "$CONVERSATION_URL" | sed -E 's#^(https?://[^/]+).*#\1#')/chat/$CONVERSATION_ID"
    fi
    mkdir -p "$run/web"
    ln -sfn ${pkgs.novnc}/share/webapps/novnc "$run/web/novnc"
    sed "s#@CHAT_URL@#$chat#" ${page} > "$run/web/index.html"
    exec ${pkgs.python3Packages.websockify}/bin/websockify --web "$run/web" 6080 localhost:5901
  '';
in
{
  environment.systemPackages = [ gplates pkgs.xdotool ];
  environment.variables.DISPLAY = ":1";
  environment.etc."gplates".source = geodata;

  webServices.desktop = {
    enable = true;
    port = 6080;
    displayName = "Desktop";
    # noVNC's paths are relative, so it serves at root.
    stripBasePath = true;
    # Root, so the X socket in /tmp is the agent's too.
    user = "root";
    command = "${start}";
    hint = "Display :1. Launch GUI apps there and drive them with xdotool.";
  };
}
