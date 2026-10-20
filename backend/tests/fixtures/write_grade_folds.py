"""Rewrites grade_folds.json (beside this script) from the backend's fold (app/grading.py), keeping its
cases and adding those of EXTRA and LOOKED not yet in it. Run it when the fold's maths changes, or to
add cases, from backend/:

    PYTHONPATH=$PWD .venv/bin/python tests/fixtures/write_grade_folds.py

A case with a Look gives that Look's Adjust values inline (`look`), so that the fixture doesn't depend
on the catalogue: both suites fold the Grade with them.
"""

import json
from pathlib import Path

from pydantic import TypeAdapter

from app.candidates import Adjust, Grade
from app.grading import fold

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
    names = {case["name"] for case in data["cases"]}
    grades = [(case["name"], case["grade"], case.get("look")) for case in data["cases"]]
    grades += [(name, {"adjust": adjust}, None) for name, adjust in EXTRA if name not in names]
    grades += [(name, grade, look) for name, grade, look in LOOKED if name not in names]
    adapter = TypeAdapter(Grade)
    adjusts = TypeAdapter(Adjust)

    out = ["{", f' "about": {json.dumps(about)},', f' "tolerance": {data["tolerance"]},', ' "cases": [']
    cases = []
    for name, grade, look in grades:
        f = fold(adapter.validate_python(grade), None if look is None else adjusts.validate_python(look))
        tables = None if f is None else f.tables
        matrix = None if f is None else f.matrix
        sharpen = 0 if f is None else f.sharpen
        vignette = 0 if f is None else f.vignette
        looked = "" if look is None else f', "look": {json.dumps(look)}'
        cases.append(
            f'  {{"name": {json.dumps(name)}, "grade": {json.dumps(grade)}{looked},\n'
            f'   "tables": {"null" if tables is None else rows(tables)},\n'
            f'   "matrix": {"null" if matrix is None else rows(matrix)},\n'
            f'   "sharpen": {num(sharpen)}, "vignette": {num(vignette)}}}'
        )
    out.append(",\n".join(cases))
    out += [" ]", "}"]
    PATH.write_text("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
