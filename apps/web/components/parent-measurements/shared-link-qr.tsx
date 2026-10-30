"use client";

import { useEffect, useState } from 'react';
import { Alert, Button, Stack } from '@mantine/core';
import { measurementLinkQrDataUrl } from '../../lib/parent-measurements-qr';
import type { ParentMeasurementsCopy } from '../../lib/parent-measurements-i18n';

/** QR contains the shared invitation only. Private recovery links never reach this component. */
export function SharedLinkQr({ url, ui }: { url: string; ui: ParentMeasurementsCopy }) {
  const [data, setData] = useState(''), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setData(''); setError(false);
    void measurementLinkQrDataUrl(url).then(value => { if (current) setData(value); }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [url, retry]);
  return <Stack align="center">{data && <img className="pm-shared-qr" src={data} alt={`QR · ${ui.share}`} />}{error && <Alert color="orange">{ui.error}<Button variant="light" onClick={() => setRetry(value => value + 1)}>{ui.retry}</Button></Alert>}</Stack>;
}
