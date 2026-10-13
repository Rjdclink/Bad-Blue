"""Exercise the production extraction protocol using the installed package."""
import json
from pathlib import Path
import subprocess
import sys

worker = Path(__file__).with_name('spectra-crawl4ai.py')
fixture = {"url": "https://example.com/docs/", "html": '<html><body><h1>Public fixture é</h1><script>hidden_fixture()</script><p>Documentation body</p><a href="guide">Guide</a></body></html>'}
result = subprocess.run([sys.executable, str(worker)], input=json.dumps(fixture), capture_output=True, text=True, timeout=4)
assert result.returncode == 0, 'Extractor startup failed'
parsed = json.loads(result.stdout)
assert set(parsed) == {'markdown'}
assert '# Public fixture é' in parsed['markdown']
assert 'Documentation body' in parsed['markdown']
assert 'https://example.com/docs/guide' in parsed['markdown']
assert 'hidden_fixture' not in parsed['markdown']
for bad_input in ['not-json', json.dumps({'html': ['invalid'], 'url': fixture['url']})]:
    bad = subprocess.run([sys.executable, str(worker)], input=bad_input, capture_output=True, text=True, timeout=4)
    assert bad.returncode != 0
    assert not bad.stdout and not bad.stderr, 'Failure output must not disclose source content'
print('PASS real Crawl4AI protocol, Unicode, relative links, script exclusion and malformed input')
