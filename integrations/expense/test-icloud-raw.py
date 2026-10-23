"""Offline tests; never load credentials or contact IMAP."""
import base64
import importlib.machinery
import importlib.util
from pathlib import Path
import unittest
loader = importlib.machinery.SourceFileLoader('icloud_mail', str(Path.home()/'.local/bin/icloud-mail'))
spec = importlib.util.spec_from_loader(loader.name, loader)
m = importlib.util.module_from_spec(spec)
loader.exec_module(m)
RAW = b'From: test@example.com\r\nSubject: fixture\r\nContent-Type: text/plain\r\n\r\nfixture\r\n'
class Client:
    def select(self, folder, readonly=False):
        assert readonly
        return 'OK', []
    def response(self, key): return 'OK', [b'1']
    def uid(self, command, uid, request):
        assert 'BODY.PEEK[]' in request
        return 'OK', [(b'1 (UID 2 FLAGS ())', RAW)]
class RawTests(unittest.TestCase):
    def test_raw_is_byte_exact_and_unread(self):
        args=m.parser().parse_args(['read','--uid','2','--raw','--uidvalidity','1'])
        self.assertEqual(m.execute(args,Client()),RAW)
    def test_base64_roundtrip(self):
        args=m.parser().parse_args(['read','--uid','2','--raw-base64'])
        self.assertEqual(base64.b64decode(m.execute(args,Client())['raw_base64']),RAW)
    def test_default_unchanged(self):
        args=m.parser().parse_args(['read','--uid','2'])
        self.assertEqual(m.execute(args,Client())['message']['body'],'fixture\r\n')
if __name__=='__main__': unittest.main()
