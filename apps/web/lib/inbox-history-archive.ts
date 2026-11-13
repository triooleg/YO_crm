type ArchivePresentation = { originalTime: string | null; timezone: string | null; missingNames: string[] };
const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Inventory is evidence of missing files, never downloadable media. */
export function inboxHistoryArchive(metadata:unknown):ArchivePresentation|null{
  const archive=record(record(metadata)?.historyArchive);
  if(archive?.policy!=='KEYCRM_SOURCE_ARCHIVE_V1')return null;
  const time=record(archive.time),minute=time?.precision==='MINUTE';
  const attachments=Array.isArray(archive.missingAttachments)?archive.missingAttachments:[];
  return {
    originalTime:minute&&typeof time?.original==='string'?time.original:null,
    timezone:minute&&typeof time?.timezone==='string'?time.timezone:null,
    missingNames:attachments.flatMap(value=>{
      const item=record(value);
      return item?.available===false&&item.checksum===null&&item.size===null
        ?[typeof item.name==='string'?item.name:'']:[];
    }),
  };
}
