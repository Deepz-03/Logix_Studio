from itertools import combinations
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

VARIABLES = "ABCD"
GRAY_2 = [0, 1]
GRAY_4 = [0, 1, 3, 2]


def bits(number, width):
    return format(number, f"0{width}b")


def combine_patterns(a, b):
    """Combine patterns differing in exactly one non-dash bit."""
    diff = 0
    result = []
    for x, y in zip(a, b):
        if x == y:
            result.append(x)
        elif x != "-" and y != "-":
            diff += 1
            result.append("-")
        else:
            return None
    return "".join(result) if diff == 1 else None


def covered_numbers(pattern):
    """Return all minterms matched by a 0/1/- pattern."""
    values = [""]
    for char in pattern:
        if char == "-":
            values = [v + "0" for v in values] + [v + "1" for v in values]
        else:
            values = [v + char for v in values]
    return {int(v, 2) for v in values}


def implicant_expression(pattern):
    parts = []
    for variable, value in zip(VARIABLES, pattern):
        if value == "1":
            parts.append(variable)
        elif value == "0":
            parts.append(variable + "'")
    return "".join(parts) or "1"


def find_prime_implicants(minterms, width):
    if not minterms:
        return []

    current = {bits(m, width) for m in minterms}
    primes = set()

    while current:
        used = set()
        next_patterns = set()
        current_list = sorted(current)

        for i, first in enumerate(current_list):
            for second in current_list[i + 1:]:
                combined = combine_patterns(first, second)
                if combined is not None:
                    used.add(first)
                    used.add(second)
                    next_patterns.add(combined)

        primes.update(pattern for pattern in current if pattern not in used)
        current = next_patterns

    # Keep only implicants that cover at least one requested minterm.
    return sorted(
        (p for p in primes if covered_numbers(p) & set(minterms)),
        key=lambda p: (p.count("-"), p)
    )


def choose_minimum_cover(minterms, prime_implicants):
    """Find a low-cost cover: fewest groups, then fewest literals."""
    target = set(minterms)
    if not target:
        return []

    candidates = []
    for pattern in prime_implicants:
        cover = covered_numbers(pattern) & target
        if cover:
            candidates.append((pattern, cover, len(pattern) - pattern.count("-")))

    # At most 4 variables are supported, so this exhaustive search is small.
    for count in range(1, len(candidates) + 1):
        best = None
        best_cost = None
        for subset in combinations(candidates, count):
            union = set()
            for _, cover, _ in subset:
                union |= cover
            if union == target:
                literal_cost = sum(item[2] for item in subset)
                cost = (literal_cost, tuple(item[0] for item in subset))
                if best_cost is None or cost < best_cost:
                    best = subset
                    best_cost = cost
        if best is not None:
            return [item[0] for item in best]

    return [p for p, cover, _ in candidates]


def gray_order(width):
    if width == 1:
        return [0, 1]
    return [0, 1, 3, 2]


def make_kmap(variable_count, minterms):
    if variable_count == 2:
        row_width, col_width = 1, 1
    elif variable_count == 3:
        row_width, col_width = 1, 2
    else:
        row_width, col_width = 2, 2

    row_values = gray_order(row_width)
    col_values = gray_order(col_width)
    grid = []

    for row_value in row_values:
        row = []
        for col_value in col_values:
            number = (row_value << col_width) | col_value
            row.append({
                "number": number,
                "value": 1 if number in minterms else 0,
                "groups": []
            })
        grid.append(row)

    return grid, row_values, col_values, row_width, col_width


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/kmap")
def kmap_view():
    return render_template("index.html")


@app.get("/adder-lab")
@app.get("/adder_lab")
def adder_view():
    return render_template("index.html")


@app.post("/solve")
def solve():
    data = request.get_json(silent=True) or {}
    try:
        variable_count = int(data.get("variables", 4))
    except (TypeError, ValueError):
        return jsonify({"error": "Choose 2, 3, or 4 variables."}), 400

    if variable_count not in (2, 3, 4):
        return jsonify({"error": "Choose 2, 3, or 4 variables."}), 400

    raw = data.get("minterms", [])
    try:
        minterms = sorted(set(int(x) for x in raw))
    except (TypeError, ValueError):
        return jsonify({"error": "Minterms must be whole numbers."}), 400

    max_minterm = (2 ** variable_count) - 1
    if any(m < 0 or m > max_minterm for m in minterms):
        return jsonify({"error": f"For {variable_count} variables, minterms must be between 0 and {max_minterm}."}), 400

    width = variable_count
    if not minterms:
        expression = "0"
        chosen = []
    elif len(minterms) == 2 ** variable_count:
        expression = "1"
        chosen = ["-" * width]
    else:
        primes = find_prime_implicants(minterms, width)
        chosen = choose_minimum_cover(minterms, primes)
        expression = " + ".join(implicant_expression(p) for p in chosen) or "0"

    grid, row_values, col_values, row_width, col_width = make_kmap(variable_count, minterms)

    groups = []
    for group_index, pattern in enumerate(chosen):
        covered = sorted(covered_numbers(pattern) & set(minterms))
        groups.append({
            "id": group_index,
            "pattern": pattern,
            "expression": implicant_expression(pattern),
            "minterms": covered,
            "color": group_index % 6
        })
        for row in grid:
            for cell in row:
                if cell["number"] in covered:
                    cell["groups"].append(group_index)

    row_labels = [bits(value, row_width) for value in row_values]
    col_labels = [bits(value, col_width) for value in col_values]
    row_variables = VARIABLES[:row_width]
    col_variables = VARIABLES[row_width:variable_count]

    return jsonify({
        "variables": variable_count,
        "minterms": minterms,
        "expression": expression,
        "groups": groups,
        "grid": grid,
        "row_labels": row_labels,
        "col_labels": col_labels,
        "row_variables": row_variables,
        "col_variables": col_variables,
        "all_ones": len(minterms) == 2 ** variable_count
    })


@app.post("/adder")
def adder():
    data = request.get_json(silent=True) or {}
    kind = data.get("kind", "half")
    try:
        a = int(data.get("a", 0))
        b = int(data.get("b", 0))
        c = int(data.get("c", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Inputs must be 0 or 1."}), 400

    if a not in (0, 1) or b not in (0, 1) or c not in (0, 1):
        return jsonify({"error": "Inputs must be 0 or 1."}), 400

    if kind == "full":
        total = a + b + c
        return jsonify({
            "kind": "full",
            "a": a, "b": b, "c": c,
            "sum": total % 2,
            "carry": total // 2,
            "sum_expression": "A ⊕ B ⊕ C",
            "carry_expression": "AB + AC + BC"
        })

    return jsonify({
        "kind": "half",
        "a": a, "b": b,
        "sum": a ^ b,
        "carry": a & b,
        "sum_expression": "A ⊕ B",
        "carry_expression": "AB"
    })


if __name__ == "__main__":
    app.run(debug=True)
