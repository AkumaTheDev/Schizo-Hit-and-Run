import json,struct,unittest,tempfile
from pathlib import Path
from p3d import decompress,chunks
from extract import extract_rcf
class FormatTests(unittest.TestCase):
    def test_lzr_literals_and_overlap(self):
        # Four literal bytes followed by an overlapping eight-byte match.
        encoded=b'\x04abcd'+bytes([0x48,0])
        packed=b'P3DZ'+struct.pack('<III',12,len(encoded),12)+encoded
        self.assertEqual(decompress(packed),b'abcdabcdabcd')
    def test_lzr_extended_literal(self):
        payload=b'1234567890abcdefghijklmnopqrstuv'
        block=bytes([0,len(payload)-15])+payload
        packed=b'P3DZ'+struct.pack('<III',len(payload),len(block),len(payload))+block
        self.assertEqual(decompress(packed),payload)
    def test_chunk_bounds(self):
        with self.assertRaises(ValueError):chunks(struct.pack('<III',0x10000,12,100))
        with self.assertRaises(ValueError):chunks(struct.pack('<III',0x10000,8,8))
    def test_archive_path_traversal(self):
        data=bytearray(512);data[:23]=b'RADCORE CEMENT LIBRARY\0\0';struct.pack_into('<I',data,0x24,64)
        struct.pack_into('<4I',data,64,1,128,0,0);struct.pack_into('<3I',data,80,0,256,4)
        name=b'../escape\0';struct.pack_into('<3I',data,128,1,0,len(name));data[140:140+len(name)]=name
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'bad.rcf';path.write_bytes(data)
            with self.assertRaises(ValueError):extract_rcf(path,Path(directory)/'output')
    @unittest.skipUnless((Path(__file__).resolve().parents[1]/"source/manifest.json").exists(), "requires locally extracted game assets")
    def test_extracted_manifest(self):
        root=Path(__file__).resolve().parents[1];manifest=json.loads((root/'source/manifest.json').read_text())
        self.assertEqual(len(manifest),18754)
        self.assertEqual(sum(item['bytes'] for item in manifest),1624497194)
        self.assertEqual(len({item['archive'] for item in manifest}),11)
if __name__=='__main__':unittest.main()
