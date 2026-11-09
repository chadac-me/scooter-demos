import marimo

app = marimo.App(width="medium")


@app.cell
def _():
    import random

    import marimo as mo

    return mo, random


@app.cell
def _(mo):
    mo.md("""# CI run times""")
    return


@app.cell
def _(random):
    random.seed(7)
    base = {"e2e fast": 9.0, "e2e full": 24.0, "unit": 4.0, "lint": 2.0, "images": 13.0}
    workflows = list(base)
    runs = [
        {"workflow": w, "day": d, "minutes": round(base[w] * random.uniform(0.7, 1.4), 1)}
        for d in range(1, 31)
        for w in workflows
    ]
    return runs, workflows


@app.cell
def _(mo, workflows):
    pick = mo.ui.dropdown(workflows, value="e2e full", label="Workflow")
    days = mo.ui.slider(7, 30, value=14, label="Last N days", show_value=True)
    mo.hstack([pick, days], justify="start", gap=2)
    return days, pick


@app.cell
def _(days, mo, pick, runs):
    rows = [r for r in runs if r["workflow"] == pick.value and r["day"] > 30 - days.value]
    peak = max(r["minutes"] for r in rows)
    mean = sum(r["minutes"] for r in rows) / len(rows)
    w, h, gap = 640, 220, 4
    bw = w / len(rows) - gap
    bars = "".join(
        f'<rect x="{i * (bw + gap):.1f}" y="{h - r["minutes"] / peak * h:.1f}" '
        f'width="{bw:.1f}" height="{r["minutes"] / peak * h:.1f}" rx="3" fill="#6366f1"/>'
        for i, r in enumerate(rows)
    )
    mo.vstack([
        mo.md(f"**{pick.value}**: mean {mean:.1f} min over {len(rows)} days, slowest {peak:.1f} min"),
        mo.Html(f'<svg viewBox="0 0 {w} {h}" width="100%" style="max-width:{w}px">{bars}</svg>'),
    ])
    return


if __name__ == "__main__":
    app.run()
