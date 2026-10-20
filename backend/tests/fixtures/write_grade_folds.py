"""Rewrites grade_folds.json (beside this script) from the backend's fold (app/grading.py), keeping its
cases and adding those of EXTRA and LOOKED not yet in it. Run it when the fold's maths changes, or to
add cases, from backend/:

    PYTHONPATH=$PWD .venv/bin/python tests/fixtures/write_grade_folds.py

A case with a Look gives that Look's Adjust values inline (`look`), so that the fixture doesn't depend
on the catalogue: both suites fold the Grade with them. A case with an Imported Look also names the
tables and matrix fitted to its 3D table (`fit`), kept once at the top (`fits`), and expects the fold's
`lut`: the Look and the intensity it is mixed at (its fit passed through), or null.
"""

import json
from dataclasses import asdict
from pathlib import Path

import numpy as np
from pydantic import TypeAdapter

from app.candidates import Adjust, Grade
from app.grading import fold
from app.looks import Fit, _identity, fit_table

PATH = Path(__file__).parent / "grade_folds.json"

# Grades of their Adjust only.
EXTRA = [
    ("sharpen 100", {"sharpen": 100}),
    ("sharpen 30", {"sharpen": 30}),
    ("vignette 100", {"vignette": 100}),
    ("vignette 45", {"vignette": 45}),
    ("sharpen and vignette", {"sharpen": 60, "vignette": 25}),
    ("effects mixed with the rest", {"temperature": 7200, "contrast": 25, "fade": 20, "sharpen": 40, "vignette": 70}),
]
# Grades with a Look (named "x": the Look's values are `look`), at an intensity.
_FILMIC = {"temperature": 7400, "saturation": -20, "contrast": 20, "fade": 15, "sharpen": 20, "vignette": 30}
_DIALLED = {"exposure": 0.5, "contrast": 10, "temperature": 6000}
LOOKED = [
    ("a Look at 0%", {"adjust": _DIALLED, "look": "x", "intensity": 0}, _FILMIC),
    ("a Look at 50%", {"adjust": _DIALLED, "look": "x", "intensity": 50}, _FILMIC),
    ("a Look at 100%", {"adjust": _DIALLED, "look": "x", "intensity": 100}, _FILMIC),
    ("a Look at 30% over neutral dials", {"look": "x", "intensity": 30}, _FILMIC),
    (
        "a Look held within the dials' ranges",
        {"adjust": {"saturation": -60, "exposure": 2.5, "temperature": 10000, "vignette": 90}, "look": "x", "intensity": 100},
        {"saturation": -100, "exposure": 1, "temperature": 9000, "vignette": 40},
    ),
]

# Imported Looks' fits, by name: each fitted to a 3D table made here.
def _warm_table() -> np.ndarray:
    grid = _identity(9)
    return np.clip(np.stack([grid[..., 0] ** 0.8, grid[..., 1] * 0.95 + 0.02, grid[..., 2] ** 1.25], axis=-1), 0, 1)


FITS = {"warm": _warm_table}
# Grades with an Imported Look (named "x", neutral Adjust values), whose fit is FITS' `fit`.
IMPORTED = [
    ("an Imported Look at 100%", {"look": "x"}, "warm"),
    ("an Imported Look at 40% over dials", {"adjust": _DIALLED, "look": "x", "intensity": 40}, "warm"),
    ("an Imported Look at 0%", {"adjust": _DIALLED, "look": "x", "intensity": 0}, "warm"),
]


def num(x: float) -> str:
    return repr(round(float(x), 6) + 0.0)


def rows(rs) -> str:
    return "[\n" + ",\n".join("    [" + ",".join(num(v) for v in r) + "]" for r in rs) + "\n   ]"


def main() -> None:
    data = json.loads(PATH.read_text())
    about = data["about"]
    if "inline" not in about:
        about = about.replace(
            "then the sharpen and vignette amounts (0..100, 0 for none).",
            "then the sharpen and vignette amounts (0..100, 0 for none). A Grade with a Look gives the Look's Adjust values inline (`look`).",
        )
    if "`fits`" not in about:
        about = about.replace(
            "inline (`look`).",
            "inline (`look`). One with an Imported Look names its fitted tables and matrix (`fit`, in `fits`) and expects `lut`: the Look and its intensity (the fit passed through), or null.",
        )
    fits = {name: asdict(fit_table(table())) for name, table in FITS.items()} | data.get("fits", {})
    names = {case["name"] for case in data["cases"]}
    grades = [(case["name"], case["grade"], case.get("look"), case.get("fit")) for case in data["cases"]]
    grades += [(name, {"adjust": adjust}, None, None) for name, adjust in EXTRA if name not in names]
    grades += [(name, grade, look, None) for name, grade, look in LOOKED if name not in names]
    grades += [(name, grade, {}, fit) for name, grade, fit in IMPORTED if name not in names]
    adapter = TypeAdapter(Grade)
    adjusts = TypeAdapter(Adjust)
    fitted = TypeAdapter(Fit)

    out = ["{", f' "about": {json.dumps(about)},', f' "tolerance": {data["tolerance"]},']
    out.append(' "fits": {\n' + ",\n".join(
        f'  {json.dumps(name)}: {{"tables": {rows(fit["tables"])},\n   "matrix": {rows(fit["matrix"])}}}' for name, fit in fits.items()
    ) + "\n },")
    out.append(' "cases": [')
    cases = []
    for name, grade, look, fit in grades:
        f = fold(
            adapter.validate_python(grade),
            None if look is None else adjusts.validate_python(look),
            None if fit is None else fitted.validate_python(fits[fit]),
        )
        tables = None if f is None else f.tables
        matrix = None if f is None else f.matrix
        sharpen = 0 if f is None else f.sharpen
        vignette = 0 if f is None else f.vignette
        looked = "" if look is None else f', "look": {json.dumps(look)}'
        lut = ""
        if fit is not None:
            given = None if f is None or f.lut is None else {"look": f.lut.look, "intensity": f.lut.intensity}
            lut = f',\n   "fit": {json.dumps(fit)}, "lut": {json.dumps(given)}'
        cases.append(
            f'  {{"name": {json.dumps(name)}, "grade": {json.dumps(grade)}{looked},\n'
            f'   "tables": {"null" if tables is None else rows(tables)},\n'
            f'   "matrix": {"null" if matrix is None else rows(matrix)},\n'
            f'   "sharpen": {num(sharpen)}, "vignette": {num(vignette)}{lut}}}'
        )
    out.append(",\n".join(cases))
    out += [" ]", "}"]
    PATH.write_text("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
