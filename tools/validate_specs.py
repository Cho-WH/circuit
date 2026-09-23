from __future__ import annotations

import json
import re
from pathlib import Path

import yaml
from copy import deepcopy

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]


def load_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def load_yaml(path: Path):
    return yaml.safe_load(path.read_text(encoding='utf-8'))


def validate_requirements() -> list[str]:
    errors: list[str] = []
    data = load_yaml(ROOT / 'requirements/requirements.yaml')
    schema = load_json(ROOT / 'requirements/requirements.schema.json')
    validator = Draft202012Validator(schema)
    for err in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
        errors.append(f'requirements: {list(err.path)}: {err.message}')

    ids = [item['id'] for item in data['requirements']]
    if len(ids) != len(set(ids)):
        errors.append('requirements: duplicate requirement ID')

    physics = load_yaml(ROOT / 'requirements/physics-rules.yaml')
    physics_ids = {item['id'] for item in physics['rules']}
    fixture_ids = {p.name[:6] for p in (ROOT / 'fixtures').glob('FIX-*.json')}

    for item in data['requirements']:
        for rule in item['physics_rules']:
            if rule not in physics_ids:
                errors.append(f"{item['id']}: unknown physics rule {rule}")
        for fixture in item['fixtures']:
            if fixture not in fixture_ids:
                errors.append(f"{item['id']}: unknown fixture {fixture}")
        for doc in item['docs']:
            if not (ROOT / doc).exists():
                errors.append(f"{item['id']}: missing document {doc}")
    return errors


def domain_invariants(document: dict) -> list[str]:
    errors: list[str] = []
    component_ids: set[str] = set()
    terminal_ids: set[str] = set()
    junction_ids: set[str] = set()
    wire_ids: set[str] = set()
    annotation_ids: set[str] = set()

    for component in document['components']:
        if component['id'] in component_ids:
            errors.append(f"duplicate component id {component['id']}")
        component_ids.add(component['id'])
        for terminal in component['terminals']:
            if terminal['id'] in terminal_ids:
                errors.append(f"duplicate terminal id {terminal['id']}")
            terminal_ids.add(terminal['id'])

    for junction in document['junctions']:
        if junction['id'] in junction_ids:
            errors.append(f"duplicate junction id {junction['id']}")
        junction_ids.add(junction['id'])

    def check_endpoint(endpoint: dict, where: str):
        if endpoint['kind'] == 'terminal' and endpoint['id'] not in terminal_ids:
            errors.append(f"{where}: unknown terminal {endpoint['id']}")
        if endpoint['kind'] == 'junction' and endpoint['id'] not in junction_ids:
            errors.append(f"{where}: unknown junction {endpoint['id']}")

    for wire in document['wires']:
        if wire['id'] in wire_ids:
            errors.append(f"duplicate wire id {wire['id']}")
        wire_ids.add(wire['id'])
        check_endpoint(wire['start'], f"wire {wire['id']} start")
        check_endpoint(wire['end'], f"wire {wire['id']} end")

    for annotation in document['annotations']:
        if annotation['id'] in annotation_ids:
            errors.append(f"duplicate annotation id {annotation['id']}")
        annotation_ids.add(annotation['id'])
        check_endpoint(annotation['anchor'], f"annotation {annotation['id']} anchor")

    if document['referenceNode'] is not None:
        check_endpoint(document['referenceNode'], 'referenceNode')

    all_ids = component_ids | terminal_ids | junction_ids | wire_ids | annotation_ids
    count = sum(map(len, [component_ids, terminal_ids, junction_ids, wire_ids, annotation_ids]))
    if len(all_ids) != count:
        errors.append('IDs must be unique across component, terminal, junction, wire, annotation')
    return errors


def validate_fixtures() -> list[str]:
    errors: list[str] = []
    circuit_schema = load_json(ROOT / 'schemas/circuit-document.schema.json')
    fixture_schema = load_json(ROOT / 'schemas/fixture.schema.json')

    validation_schema = deepcopy(fixture_schema)
    validation_schema['properties']['document'] = circuit_schema
    validator = Draft202012Validator(validation_schema)

    seen: set[str] = set()
    for path in sorted((ROOT / 'fixtures').glob('FIX-*.json')):
        data = load_json(path)
        for err in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
            errors.append(f'{path.name}: {list(err.path)}: {err.message}')
        if data['id'] in seen:
            errors.append(f'duplicate fixture id {data["id"]}')
        seen.add(data['id'])
        for err in domain_invariants(data['document']):
            errors.append(f'{path.name}: {err}')
        if not path.name.startswith(data['id']):
            errors.append(f'{path.name}: filename and fixture id differ')
    return errors


def validate_markdown_links() -> list[str]:
    errors: list[str] = []
    link_pattern = re.compile(r'\[[^\]]+\]\(([^)]+)\)')
    for path in ROOT.rglob('*.md'):
        if any(part in {'node_modules', '.git', 'dist', '.venv', '.npm-cli', '.pnpm-store'} for part in path.relative_to(ROOT).parts):
            continue
        text = path.read_text(encoding='utf-8')
        for target in link_pattern.findall(text):
            if '://' in target or target.startswith('#'):
                continue
            target = target.split('#', 1)[0]
            resolved = (path.parent / target).resolve()
            try:
                resolved.relative_to(ROOT.resolve())
            except ValueError:
                errors.append(f'{path.relative_to(ROOT)}: link escapes root: {target}')
                continue
            if not resolved.exists():
                errors.append(f'{path.relative_to(ROOT)}: missing link target {target}')
    return errors


def main() -> int:
    errors = []
    errors.extend(validate_requirements())
    errors.extend(validate_fixtures())
    errors.extend(validate_markdown_links())
    if errors:
        print('Validation failed:')
        for error in errors:
            print(f'- {error}')
        return 1
    print('All specifications are valid.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
