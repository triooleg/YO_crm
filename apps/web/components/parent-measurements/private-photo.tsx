"use client";

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, FileInput, Stack } from '@mantine/core';
import type { createParentMeasurementsApi } from '../../lib/parent-measurements-api';
import type { Locale } from '../../lib/parent-measurements-model';
import { parentMeasurementsPhotoCopy } from '../../lib/parent-measurements-i18n';


export function PrivatePhoto({ childId, api, locale, disabled }: { childId: string; api: ReturnType<typeof createParentMeasurementsApi>; locale: Locale; disabled: boolean }) {
  const ui = parentMeasurementsPhotoCopy[locale];
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  async function open(file?: File | null) {
    if (busy || disabled) return;
    setBusy(true); setError('');
    try {
      if (file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { setError(ui.invalid); return; }
        const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = reject; reader.readAsDataURL(file); });
        await api.uploadPhoto(childId, file.type, base64);
      }
      const blob = await api.photo(childId);
      if (mounted.current) setPreview(URL.createObjectURL(blob));
    } catch { if (mounted.current) setError(ui.error); } finally { if (mounted.current) setBusy(false); }
  }
  return <Stack gap="sm"><FileInput label={ui.title} description={ui.hint} accept="image/jpeg,image/png,image/webp" value={null} disabled={disabled || busy} onChange={file => { if (file) void open(file); }} /><Button variant="subtle" loading={busy} disabled={disabled} onClick={() => void open()}>{ui.open}</Button>{error && <Alert color="red" role="alert">{error}</Alert>}{preview && <img className="pm-private-photo" src={preview} alt={ui.title} />}</Stack>;
}
