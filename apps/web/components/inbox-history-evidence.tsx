import { Box, Text } from '@mantine/core';
import { communicationsUi as ui } from '../lib/i18n';
import { inboxHistoryArchive } from '../lib/inbox-history-archive';

export function InboxHistoryEvidence({metadata,outbound=false}:{metadata:unknown;outbound?:boolean}){
  const archive=inboxHistoryArchive(metadata);
  if(!archive)return null;
  return <Box role="note" mt="xs" style={{overflowWrap:'anywhere'}}>
    {archive.originalTime&&<Text size="xs" c={outbound?'white':'dimmed'}>
      {ui.historySourceTime}: {archive.originalTime}{archive.timezone?` · ${archive.timezone}`:''} · {ui.historyMinutePrecision}
    </Text>}
    {archive.missingNames.map((name,index)=><Text size="sm" c={outbound?'white':'dimmed'} key={index}>
      {ui.historyMediaUnavailable}{name?`: ${name}`:''}
    </Text>)}
  </Box>;
}
