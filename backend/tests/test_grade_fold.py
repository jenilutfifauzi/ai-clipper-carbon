"""The fold of a Grade into tables and a matrix (.scratch/color-adjust/issues/01-segment-grade-adjust-dials.md,
docs/adr/0013), on the cases the frontend's tests read too (fixtures/grade_folds.json). Seam C."""

import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from app.candidates import Adjust, Grade
from app.grading import TABLE_SIZE, fold, grade_filters

FIXTURES = Path(__file__).parent / "fixtures"
CASES = json.loads((FIXTURES / "grade_folds.json").read_text())
CLOSE = CASES["tolerance"]
_GRADE = TypeAdapter(Grade)


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda case: case["name"])
def test_a_grade_folds_into_the_tables_and_matrix_the_shared_cases_say(case):
    folded = fold(_GRADE.validate_python(case["grade"]))
    tables = None if folded is None else folded.tables
    matrix = None if folded is None else folded.matrix
    if case["tables"] is None:
        assert tables is None
    else:
        assert tables is not None and [len(table) for table in tables] == [TABLE_SIZE] * 3
        for table, expected in zip(tables, case["tables"]):
            assert list(table) == pytest.approx(expected, abs=CLOSE)
    if case["matrix"] is None:
        assert matrix is None
    else:
        assert matrix is not None
        for row, expected in zip(matrix, case["matrix"]):
            assert list(row) == pytest.approx(expected, abs=CLOSE)


def test_a_neutral_grade_folds_to_nothing_and_adds_no_filter():
    assert fold(Grade()) is None and grade_filters(Grade()) == ""


def test_the_dials_move_the_picture_the_way_they_say():
    def table(**dials) -> tuple[float, ...]:
        folded = fold(Grade(Adjust(**dials)))
        assert folded is not None and folded.tables is not None
        return folded.tables[0]

    grey = TABLE_SIZE // 2
    assert table(exposure=1)[grey] > grey / 255 > table(exposure=-1)[grey]
    assert table(brightness=50)[grey] > grey / 255 > table(brightness=-50)[grey]
    # Contrast and fade keep the curve rising; fade lifts black into a matte.
    assert table(contrast=60)[64] < 64 / 255 and table(contrast=60)[192] > 192 / 255
    assert table(fade=100)[0] > 0.2 and all(a <= b for a, b in zip(table(fade=100), table(fade=100)[1:]))
    # Warmer: red up, blue down, a grey's luma kept.
    warm = fold(Grade(Adjust(temperature=9000)))
    assert warm is not None and warm.matrix is not None
    [red, green, blue] = [sum(row) for row in warm.matrix]
    assert red > 1 > blue
    assert 0.2126 * red + 0.7152 * green + 0.0722 * blue == pytest.approx(1)
    # Grey at saturation −100: every channel the same mix of the three.
    grey_matrix = fold(Grade(Adjust(saturation=-100)))
    assert grey_matrix is not None and grey_matrix.matrix is not None
    assert grey_matrix.matrix[0] == grey_matrix.matrix[1] == grey_matrix.matrix[2]


@pytest.mark.parametrize(("dial", "value"), [("temperature", 1999), ("temperature", 11001), ("exposure", 3.5), ("tint", -101), ("fade", -1), ("sharpen", 101)])
def test_a_dial_out_of_its_range_is_refused_with_its_name(dial, value):
    with pytest.raises(ValidationError, match=dial):
        _GRADE.validate_python({"adjust": {dial: value}})
