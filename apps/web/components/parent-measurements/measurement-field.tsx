"use client";

import { useEffect, useId, useState, type CSSProperties } from 'react';
import { Alert, Button, Group, Modal, SegmentedControl, Slider, Stack, Text, TextInput } from '@mantine/core';
import { displayMeasurement, measurementDiagram, measurementSliderBounds, parseMeasurement, type Locale, type Units } from '../../lib/parent-measurements-model';
import type { ParentMeasurementsCopy } from '../../lib/parent-measurements-i18n';

type ApprovedRange = { lowerCm: number; upperCm: number };
type Props = { number?: number; label?: string; compact?: boolean; value?: number; units: Units; locale: Locale; ui: ParentMeasurementsCopy; required?: boolean; disabled?: boolean; error?: boolean; range?: ApprovedRange; acknowledged?: boolean; onAcknowledge?: (checked: boolean) => void; onChange: (cm: number | undefined) => void; onValidity?: (valid: boolean) => void };

export function MeasurementField({ number, label, compact, value, units, locale, ui, required, disabled, error, range, acknowledged, onAcknowledge, onChange, onValidity }: Props) {
  const fieldId = useId();
  const [input, setInput] = useState(() => displayMeasurement(value, units, locale));
  const [invalid, setInvalid] = useState(false);
  const [rounding, setRounding] = useState<number | null>(null);
  const [view, setView] = useState('photo');
  const [zoom, setZoom] = useState(false);
  useEffect(() => { setInput(displayMeasurement(value, units, locale)); setInvalid(false); setRounding(null); onValidity?.(true); }, [value, units, locale]); // display only; never parse a unit switch
  const caption = label ?? ui.fields[number! - 1]!;
  const photo = number && [1, 2, 3, 15].includes(number) ? `/parent-measurements/reference-${number}.jpg` : undefined;
  const image = view === 'photo' && photo ? photo : measurementDiagram(locale);
  const hint = number === 15 ? ui.torso : number === 6 ? ui.sleeve : number === 1 ? ui.chestHint : number === 2 ? ui.waistHint : number === 3 ? ui.hipsHint : ui.guideHint;
  const outside = range && value !== undefined && (value < range.lowerCm || value > range.upperCm);
  const { min, max } = measurementSliderBounds(range, value);
  const accessibleCaption = number ? `№${number} · ${caption}` : caption;
  function inputValue(text: string) {
    setInput(text);
    const parsed = parseMeasurement(text, units);
    setInvalid(parsed.kind === 'invalid'); setRounding(parsed.kind === 'round' ? parsed.cm : null);
    onValidity?.(parsed.kind === 'valid' || parsed.kind === 'empty');
    if (parsed.kind === 'valid') onChange(parsed.cm);
    if (parsed.kind === 'empty') onChange(undefined);
  }
  function slide(cm: number) {
    setInput(displayMeasurement(cm, units, locale)); setInvalid(false); setRounding(null);
    onValidity?.(true); onChange(cm);
  }
  return <Stack gap={compact ? 'xs' : 'md'} className="pm-measurement-field">
    <div>
      {!compact && <Text component="label" htmlFor={fieldId} fw={600}>{accessibleCaption}</Text>}
      {number && <Text size="xs" c="dimmed">{required ? ui.required : ui.optional}</Text>}
      <Group className="pm-value-controls" wrap="nowrap" gap="sm" mt="xs" style={{ '--pm-value-characters': Math.max(4, Math.min(12, (input.length || 3) * 2)) } as CSSProperties}>
        <TextInput id={fieldId} className="pm-value-input" size="md" aria-label={accessibleCaption} value={input} inputMode="decimal" autoComplete="off" disabled={disabled} onChange={event => inputValue(event.currentTarget.value)} error={Boolean(invalid || error || outside)} />
        <Text size="sm" className="pm-value-unit">{units === 'cm' ? ui.cm : 'in'}</Text>
        <Slider className="pm-value-slider" min={min} max={max} step={0.5} value={value ?? min} disabled={disabled} label={cm => `${displayMeasurement(cm, units, locale)} ${units === 'cm' ? ui.cm : 'in'}`} thumbLabel={`${ui.slider}: ${caption}`} onChange={slide} />
      </Group>
      {(invalid || error) && <Text size="xs" c="red" role="alert">{ui.invalidNumber}</Text>}
    </div>
    {rounding !== null && <Alert color="orange" role="alert"><Stack gap="sm"><Text>{ui.round} <strong>{displayMeasurement(rounding, 'cm', locale)} {ui.cm}</strong></Text><Group><Button disabled={disabled} onClick={() => { onChange(rounding); setInput(displayMeasurement(rounding, units, locale)); setRounding(null); setInvalid(false); onValidity?.(true); }}>{ui.acceptRound}</Button><Button variant="default" onClick={() => { setRounding(null); setInput(displayMeasurement(value, units, locale)); onValidity?.(true); }}>{ui.rejectRound}</Button></Group></Stack></Alert>}
    {outside && <Alert color="red" role="alert"><Text>{ui.warning} {displayMeasurement(range!.lowerCm, units, locale)}–{displayMeasurement(range!.upperCm, units, locale)} {units === 'cm' ? ui.cm : 'in'}</Text><Button disabled={disabled} variant={acknowledged ? 'filled' : 'light'} aria-pressed={Boolean(acknowledged)} onClick={() => onAcknowledge?.(!acknowledged)}>{ui.checked}{acknowledged ? ' ✓' : ''}</Button></Alert>}
    {number && <>
      {photo && <SegmentedControl fullWidth value={view} onChange={setView} data={[{ value: 'photo', label: ui.photo }, { value: 'diagram', label: ui.diagram }]} />}
      <Button variant="transparent" className="pm-photo-button" onClick={() => setZoom(true)} aria-label={`${ui.zoom}: ${caption}`}><img src={image} alt={view === 'photo' && photo ? caption : ui.diagram} loading="lazy" /></Button>
      <Alert color="violet"><Text size="sm">{hint}</Text></Alert>
      {!range && <Text size="xs" c="dimmed">{ui.noNorms}</Text>}
      <Modal opened={zoom} onClose={() => setZoom(false)} title={caption} size="lg" closeButtonProps={{ 'aria-label': ui.close }}><img className="pm-zoom-image" src={image} alt={caption} /></Modal>
    </>}
  </Stack>;
}
