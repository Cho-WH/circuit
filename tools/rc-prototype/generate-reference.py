"""Independent 90-digit nodal RC oracle, stdlib only; no modal eigensolver.

Generate committed reference fixtures with Decimal Taylor scaling/squaring.
This script is an offline verification tool, not a product dependency.
"""
from decimal import Decimal, localcontext
import json
from pathlib import Path

D = Decimal


def identity(n):
    return [[D(int(i == j)) for j in range(n)] for i in range(n)]


def mm(a, b):
    return [[sum((a[i][k] * b[k][j] for k in range(len(b))), D(0))
             for j in range(len(b[0]))] for i in range(len(a))]


def inverse(a):
    n = len(a)
    aug = [row[:] + eye for row, eye in zip(a, identity(n))]
    for col in range(n):
        pivot = max(range(col, n), key=lambda i: abs(aug[i][col]))
        aug[col], aug[pivot] = aug[pivot], aug[col]
        value = aug[col][col]
        aug[col] = [x / value for x in aug[col]]
        for i in range(n):
            if i != col:
                factor = aug[i][col]
                aug[i] = [x - factor * y for x, y in zip(aug[i], aug[col])]
    return [row[n:] for row in aug]


def expm(a):
    n = len(a)
    norm = max(sum(abs(x) for x in row) for row in a)
    squares = 0
    while norm > D('0.125'):
        norm /= 2
        squares += 1
    b = [[x / (D(2) ** squares) for x in row] for row in a]
    result = identity(n)
    term = identity(n)
    for k in range(1, 1000):
        term = [[x / k for x in row] for row in mm(term, b)]
        result = [[x + y for x, y in zip(r, t)] for r, t in zip(result, term)]
        if max(abs(x) for row in term for x in row) < D('1e-85'):
            break
    else:
        raise ArithmeticError('Taylor budget exceeded')
    for _ in range(squares):
        result = mm(result, result)
    return result


def make_case(name, resistances, capacitances, initial, times, cross_caps=()):
    n = len(capacitances)
    # Independent nodal stamp: node 0 is held at 10 V; n dynamic nodes follow it.
    g = [[D(0) for _ in range(n)] for _ in range(n)]
    c = [[D(0) for _ in range(n)] for _ in range(n)]
    f = [[D(0)] for _ in range(n)]
    elements = [{'id': 'V', 'kind': 'voltage', 'a': 's', 'b': 'g', 'value': '10'}]
    init = {}
    for i, resistance in enumerate(resistances):
        weight = 1 / D(resistance)
        g[i][i] += weight
        if i == 0:
            f[i][0] += weight * 10
        else:
            g[i - 1][i - 1] += weight
            g[i - 1][i] -= weight
            g[i][i - 1] -= weight
        elements.append({'id': f'R{i}', 'kind': 'resistor', 'a': 's' if i == 0 else f'n{i-1}',
                         'b': f'n{i}', 'value': resistance})
    for i, capacitance in enumerate(capacitances):
        c[i][i] += D(capacitance)
        elements.append({'id': f'C{i}', 'kind': 'capacitor', 'a': f'n{i}', 'b': 'g', 'value': capacitance})
        init[f'C{i}'] = initial[i]
    for k, (a, b, cap) in enumerate(cross_caps):
        c[a][a] += D(cap)
        c[b][b] += D(cap)
        c[a][b] -= D(cap)
        c[b][a] -= D(cap)
        elements.append({'id': f'X{k}', 'kind': 'capacitor', 'a': f'n{a}', 'b': f'n{b}', 'value': cap})
        init[f'X{k}'] = str(D(initial[a]) - D(initial[b]))
    a = mm(inverse(c), g)
    equilibrium = mm(inverse(g), f)
    delta = [[D(v) - eq[0]] for v, eq in zip(initial, equilibrium)]
    samples = []
    for t in times:
        error = mm(expm([[-x * D(t) for x in row] for row in a]), delta)
        v = [[x[0] + eq[0]] for x, eq in zip(error, equilibrium)]
        derivative = [[-x[0]] for x in mm(a, error)]
        currents = {f'C{i}': str(D(capacitances[i]) * derivative[i][0]) for i in range(n)}
        for k, (left, right, cap) in enumerate(cross_caps):
            currents[f'X{k}'] = str(D(cap) * (derivative[left][0] - derivative[right][0]))
        for i, resistance in enumerate(resistances):
            currents[f'R{i}'] = str(((D(10) if i == 0 else v[i-1][0]) - v[i][0]) / D(resistance))
        currents['V'] = str(-D(currents['R0']))
        samples.append({'time': t, 'nodeVoltages': {f'n{i}': str(v[i][0]) for i in range(n)}, 'currents': currents})
    return {'name': name, 'circuit': {'nodes': ['g', 's'] + [f'n{i}' for i in range(n)],
                                     'elements': elements, 'initialVoltages': init, 'reference': 'g'}, 'samples': samples}


with localcontext() as ctx:
    ctx.prec = 90
    cases = [
        make_case('cancellation-at-initial-crossing', ['1', '1'], ['1', '1'], ['10', '0'], ['0', '0.01', '0.1', '1', '3', '10', '100']),
        make_case('unequal-two-stage', ['1700', '3300'], ['0.000047', '0.00022'], ['1.25', '-0.75'], ['0', '0.001', '0.03', '0.2', '1', '10', '100']),
        make_case('coupled-capacitor-mesh', ['1200', '4700', '2200'], ['0.00001', '0.000047', '0.000022'], ['2', '-1', '3'], ['0', '0.00001', '0.001', '0.03', '0.3', '3', '30'], [(0, 2, '0.000033')]),
        make_case('six-stage', ['10', '30', '100', '300', '1000', '3000'], ['0.01', '0.003', '0.001', '0.0003', '0.0001', '0.00003'], ['0', '1', '2', '-1', '0.5', '3'], ['0', '0.0001', '0.01', '0.1', '1', '10', '100']),
        make_case('stiff-eight-orders', ['1', '100000000'], ['1', '1'], ['0', '0'], ['0', '0.001', '1', '1000', '10000000', '100000000', '1000000000']),
    ]
    data = {'method': 'Decimal(90), direct nodal C^-1 G, Taylor scaling/squaring; no eigenvectors', 'cases': cases}
    target = Path(__file__).resolve().parents[2] / 'tests' / 'fixtures' / 'rc-prototype-reference.json'
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(cases)} cases, {sum(len(c["samples"]) for c in cases)} reference frames: {target}')
