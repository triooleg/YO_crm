"""Known YO CRM local-file references. Reports hashes, never customer filenames."""
import hashlib
import json
from pathlib import PurePosixPath
import re
from urllib.parse import unquote, urlsplit
from backup_archive import safe_name

MAPPINGS = [('Order','modelImagePath','order-models'), ('OrderItem','modelImagePath','order-models'),
            ('OrderFile','path','order-files'), ('ClientFile','path','client-files'),
            ('TaskAttachment','path','task-images'), ('CommunicationAttachment','path','communication-files'),
            ('MeasurementDraftAsset','storageKey','private-parent-measurements')]


def local_path(value, prefix=None):
    if not isinstance(value,str) or not value:
        return None
    # Absolute provider URLs remain external even if their path resembles a local route.
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return None
    value = unquote(parsed.path)
    match = re.fullmatch(r'/(?:api/)?communications/(?:files|meta-files|attachments)/([^/]+)', value)
    if match:
        return 'communication-files/'+safe_name(match.group(1))
    if value.startswith('/uploads/') or value.startswith('uploads/'):
        return safe_name(value.lstrip('/').removeprefix('uploads/'))
    if prefix:
        value = value.removeprefix(prefix+'/')
        return safe_name(prefix+'/'+value)
    return None


def check(execute, file_paths):
    available = set(file_paths)
    columns = set()
    for line in execute("SELECT json_build_array(table_name,column_name) FROM information_schema.columns WHERE table_schema='public';").splitlines():
        columns.add(tuple(json.loads(line)))
    checked, missing, external, scopes = set(), set(), 0, {}
    def add(value, scope, prefix=None):
        nonlocal external
        try:
            path = local_path(value,prefix)
        except ValueError:
            missing.add(hashlib.sha256((scope+':unsafe:'+str(value)).encode()).hexdigest())
            return
        if path is None:
            if isinstance(value,str) and value.startswith(('http://','https://')):
                external += 1
            return
        checked.add(path)
        scopes[scope] = scopes.get(scope,0)+1
        if path not in available:
            missing.add(hashlib.sha256(path.encode()).hexdigest())
    for table,column,prefix in MAPPINGS:
        if (table,column) not in columns:
            continue
        where = ' WHERE "'+column+'" IS NOT NULL'
        if table == 'MeasurementDraftAsset' and (table,'archivedAt') in columns:
            where += ' AND ("archivedAt" IS NULL'
            if ('MeasurementSubmission','payload') in columns:
                where += ' OR EXISTS (SELECT 1 FROM "MeasurementSubmission" s WHERE s."childId"="MeasurementDraftAsset"."childId" AND s.payload->>\'photoAssetId\'="MeasurementDraftAsset".id)'
            where += ')'
        for line in execute('SELECT to_json("'+column+'") FROM "'+table+'"'+where+';').splitlines():
            add(json.loads(line),table+'.'+column,prefix)
    # Explicit JSON media contracts; never interpret arbitrary customer text as paths.
    for table in ('Message','MessageAttachment'):
        if (table,'metadata') in columns:
            for line in execute('SELECT metadata FROM "'+table+'" WHERE metadata IS NOT NULL;').splitlines():
                value = json.loads(line)
                if not isinstance(value,dict):
                    continue
                if table == 'Message' and isinstance(value.get('rawPath'),str):
                    add(value['rawPath'],'Message.metadata.rawPath','communication-files')
                attachments = value.get('attachments',[])
                if isinstance(attachments,list):
                    for item in attachments:
                        if isinstance(item,dict):
                            add(item.get('url'),table+'.metadata.attachments.url')
    if ('MessageAttachment','externalUrl') in columns:
        for line in execute('SELECT to_json("externalUrl") FROM "MessageAttachment" WHERE "externalUrl" IS NOT NULL;').splitlines():
            add(json.loads(line),'MessageAttachment.externalUrl')
    if all(('AppSetting', c) in columns for c in ('value', 'section', 'key')):
        for line in execute("SELECT value FROM \"AppSetting\" WHERE section='interface' AND key='branding';").splitlines():
            branding = json.loads(line)
            if isinstance(branding, dict):
                add(branding.get('logoPath'), 'AppSetting.interface.branding.logoPath', 'branding')
    return dict(status='PASS' if not missing else 'FAILED', checked=len(checked), missing=sorted(missing),
                scopes=scopes, externalPointers=external,
                limitations=['Original provider history and remote bytes not captured', 'Invoice PDF/HTML in AppSetting covered by database fingerprints', 'Unknown future JSON file contracts not asserted'])
