#!/usr/bin/env python3
import json,re,os
from pathlib import Path
root=Path(__file__).resolve().parents[1];v=(root/'CLIENT_VERSION').read_text().strip();assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',v)
assert json.loads((root/'client/package.json').read_text())['version']==v
assert json.loads((root/'client/src-tauri/tauri.conf.json').read_text())['version']==v
assert re.search(r'^version = "'+re.escape(v)+'"', (root/'client/src-tauri/Cargo.toml').read_text(),re.M)
assert (root/'SERVER_VERSION').read_text().strip()==v
ref=os.environ.get('GITHUB_REF','')
if ref.startswith('refs/tags/'):assert ref=='refs/tags/v'+v
print('Versions OK:',v)
