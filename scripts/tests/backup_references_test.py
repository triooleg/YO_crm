import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backup_references import check,local_path


class ReferenceTests(unittest.TestCase):
    def test_branding_app_setting_logo_is_a_required_upload(self):
        def sql(query):
            if 'information_schema' in query:
                return '\n'.join(json.dumps(x) for x in [('AppSetting','value'),('AppSetting','section'),('AppSetting','key')])
            self.assertIn("section='interface'", query)
            self.assertIn("key='branding'", query)
            return '{"logoPath":"logo.webp"}'
        result = check(sql, set())
        self.assertEqual(result['status'], 'FAILED')
        self.assertEqual(result['checked'], 1)
        self.assertEqual(check(sql, {'branding/logo.webp'})['status'], 'PASS')

    def test_known_bare_paths_local_urls_and_provider_boundary(self):
        self.assertEqual(local_path('a.jpg','order-models'),'order-models/a.jpg')
        self.assertEqual(local_path('/api/communications/files/mail.pdf'),'communication-files/mail.pdf')
        self.assertIsNone(local_path('https://provider.test/api/communications/files/mail.pdf'))
        with self.assertRaises(ValueError):
            local_path('../secret','order-files')

    def test_report_checks_domains_and_redacts_missing_names(self):
        def sql(query):
            if 'information_schema' in query:
                return '\n'.join(json.dumps(x) for x in [('Order','modelImagePath'),('Message','metadata')])
            if '"Order"' in query:
                return '"private-order.jpg"'
            return '{"rawPath":"mail.eml","attachments":[{"url":"/api/communications/files/a.pdf"}]}'
        result=check(sql,{'communication-files/mail.eml','communication-files/a.pdf'})
        self.assertEqual(result['checked'],3)
        self.assertEqual(result['status'],'FAILED')
        self.assertEqual(len(result['missing']),1)
        self.assertNotIn('private-order.jpg',json.dumps(result))


if __name__=='__main__':
    unittest.main()
