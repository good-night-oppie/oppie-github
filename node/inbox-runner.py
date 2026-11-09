"""Dedicated read-only Inbox preview; stdin EOF is the parent lifetime lease."""
import json
import os
import sys
import threading
from pathlib import Path


def main():
    request = json.loads(sys.stdin.readline())
    # This runner never starts the upstream pipeline or permits action POSTs.
    if request.get('mode') != 'preview':
        raise ValueError('PREVIEW_REQUIRED')
    def lease():
        sys.stdin.read()
        os._exit(0)
    threading.Thread(target=lease, daemon=True).start()
    # OS-held per-data-directory lock; released even on abrupt worker loss.
    lock = open(Path(request['dataDir']) / '.preview.lock', 'a+b')
    if lock.seek(0, 2) == 0:
        lock.write(b'0')
        lock.flush()
    lock.seek(0)
    if os.name == 'nt':
        import msvcrt
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    root = Path(sys.argv[1]).resolve(strict=True)
    sys.path.insert(0, str(root))
    import server
    from inbox import config
    cfg = {
        'github_login': 'reviewinbox-preview', 'repos': [], 'mode': 'shadow',
        'data_dir': request['dataDir'],
        'server': {'host': '127.0.0.1', 'port': request['port'], 'tailnet': {}},
        'sources': {key: {'enabled': False} for key in config.DEFAULTS['sources']},
        'agent': {'daily_review_limit': 0, 'codex_homes': []},
        'policy': {key: False for key, value in config.DEFAULTS['policy'].items() if isinstance(value, bool)},
    }
    cfg_path = Path(request['dataDir']) / 'preview-config.json'
    cfg_path.write_text(json.dumps(cfg), encoding='utf-8')
    original = server.Handler.do_GET
    def read_only_get(self):
        if self.path == '/_oppie_health':
            if not self._host_ok():
                return self._send(403, {'error': 'HOST_DENIED'})
            return self._send(200, {'instance': request['instance'], 'mode': 'preview'})
        return original(self)
    server.Handler.do_GET = read_only_get
    server.Handler.do_POST = lambda self: self._send(403, {'error': 'READ_ONLY_PREVIEW'})
    sys.argv = ['server.py', '--config', str(cfg_path), '--no-pipeline']
    server.main()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # No raw exception/config/token output crosses the worker boundary.
        sys.stderr.write('INBOX_PREVIEW_START_FAILED\n')
        sys.stderr.flush()
        os._exit(1)
