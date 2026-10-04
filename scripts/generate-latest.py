#!/usr/bin/env python3
"""Build a Tauri v2 manifest from the signed Windows installer."""
import argparse,json,re
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import quote
p=argparse.ArgumentParser();p.add_argument('--version',required=True);p.add_argument('--repository',default='Mamaad/Licra-voice');p.add_argument('--bundle',type=Path,required=True);p.add_argument('--notes',type=Path);p.add_argument('--output',type=Path,default=Path('latest.json'));a=p.parse_args()
if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',a.version):p.error('SemVer required')
installers=list(a.bundle.glob('*-setup.exe'))
if len(installers)!=1:p.error('Exactly one signed NSIS setup required')
installer=installers[0];signature=Path(str(installer)+'.sig')
if not signature.exists():p.error('Unsigned artifacts cannot be released')
data={'version':a.version,'notes':a.notes.read_text(encoding="utf-8") if a.notes else 'Licra '+a.version,'pub_date':datetime.now(timezone.utc).isoformat(),'platforms':{'windows-x86_64':{'signature':signature.read_text(encoding="utf-8").strip(),'url':f'https://github.com/{a.repository}/releases/download/v{a.version}/{quote(installer.name)}'}}}
a.output.write_text(json.dumps(data,indent=2)+'\n', encoding='utf-8')
