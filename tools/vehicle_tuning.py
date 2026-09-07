"""Read active CON commands without applying commented-out experiments."""
import json
from pathlib import Path
from campaign import parse

ROOT = Path(__file__).resolve().parents[1]


def numeric_tuning(source):
    return {call['op']: float(call['args'][0]) for call in parse(source)
            if len(call['args']) == 1 and isinstance(call['args'][0], (int, float))}


def read_tuning(path):
    return numeric_tuning(path.read_text())


if __name__ == '__main__':
    path = ROOT / 'public/assets/campaign/assets.json'
    data = json.loads(path.read_text())
    cars = ROOT / 'source/game/scripts/cars'
    changed = []
    for name in data['tuning']:
        values = read_tuning(cars / f'{name}.con')
        if values != data['tuning'][name]:
            changed.append(f'car:{name}')
        data['tuning'][name] = values
    for con in cars.rglob('*.con'):
        name = str(con.relative_to(cars)).lower()
        values = read_tuning(con)
        if values != data['missionTuning'].get(name):
            changed.append(name)
        data['missionTuning'][name] = values
    path.write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps({'changedConfigurations': len(changed), 'configurations': changed, 'errors': []}))
