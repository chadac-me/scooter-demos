# Render demos into out/ (all of them with no arguments).
render *DEMOS:
    node lib/render.mjs {{DEMOS}}

# Render every demo, cluster ones too; run lib/cluster-up.sh first.
render-all:
    node lib/render.mjs --all

# Render one demo fast, headless with Playwright's recorder, to check a scene.
preview DEMO:
    node lib/render.mjs --preview {{DEMO}}

# Build the gallery page from out/.
site:
    node lib/site.mjs

# Move the pinned Scooter to its latest main.
bump:
    nix flake update scooter
