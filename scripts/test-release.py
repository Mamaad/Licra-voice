#!/usr/bin/env python3
"""Exercise manifest generation with French notes and unsigned installers."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path
script = Path(__file__).with_name('generate-latest.py')
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / 'Licra_0.1.0_x64-setup.exe').write_bytes(b'fixture')
    (root / 'notes.md').write_text('Première identité chiffrée', encoding='utf-8')
    args = [sys.executable, str(script), '--version', '0.1.0', '--bundle', str(root),
            '--notes', str(root / 'notes.md'), '--output', str(root / 'latest.json')]
    assert subprocess.run(args, capture_output=True).returncode != 0
    (root / 'Licra_0.1.0_x64-setup.exe.sig').write_text('signature', encoding='utf-8')
    subprocess.run(args, check=True)
    data = json.loads((root / 'latest.json').read_text(encoding='utf-8'))
    assert data['notes'] == 'Première identité chiffrée'
    assert data['platforms']['windows-x86_64']['signature'] == 'signature'
print('UTF-8 notes and unsigned artifact rejection PASS')
