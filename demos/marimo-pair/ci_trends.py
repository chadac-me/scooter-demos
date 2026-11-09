import marimo

app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import random

    import marimo as mo

    return mo, random


@app.cell(hide_code=True)
def _(mo):
    mo.md("""# CI run times""")
    return


@app.cell(hide_code=True)
def _(random):
    random.seed(7)
    base = {"e2e fast": 9.0, "e2e full": 24.0, "unit": 4.0, "lint": 2.0, "images": 13.0}
    workflows = list(base)
    runs = []
    for _d in range(1, 31):
        for _w in workflows:
            for _ in range(8):
                _m = base[_w] * random.uniform(0.85, 1.2)
                # From day 24 a flaky suite retries some runs.
                if _w == "e2e full" and _d >= 24 and random.random() < 0.3:
                    _m += random.uniform(9, 14)
                runs.append({"workflow": _w, "day": _d, "minutes": round(_m, 1)})
    return runs, workflows


@app.cell(hide_code=True)
def _(mo, workflows):
    pick = mo.ui.dropdown(workflows, value="e2e full", label="Workflow")
    days = mo.ui.slider(7, 30, value=30, label="Last N days", show_value=True)
    mo.hstack([pick, days], justify="start", gap=2)
    return days, pick


@app.cell(hide_code=True)
def _(days, mo, pick, runs):
    _by_day = {}
    for _r in runs:
        if _r["workflow"] == pick.value and _r["day"] > 30 - days.value:
            _by_day.setdefault(_r["day"], []).append(_r["minutes"])
    _mean = {_d: sum(_m) / len(_m) for _d, _m in _by_day.items()}
    _peak = max(_mean.values())
    _w, _h, _gap = 640, 160, 4
    _bw = _w / len(_mean) - _gap
    _bars = "".join(
        f'<rect x="{_i * (_bw + _gap):.1f}" y="{_h - _v / _peak * _h:.1f}" '
        f'width="{_bw:.1f}" height="{_v / _peak * _h:.1f}" rx="3" fill="#6366f1"/>'
        for _i, _v in enumerate(_mean.values())
    )
    mo.vstack([
        mo.md(f"**{pick.value}**: daily mean over the last {len(_mean)} days, slowest {_peak:.1f} min"),
        mo.Html(f'<svg viewBox="0 0 {_w} {_h}" width="100%" style="max-width:{_w}px">{_bars}</svg>'),
    ])
    return


if __name__ == "__main__":
    app.run()
