import { toDataURL } from 'qrcode';

/** Encode the complete link locally, including its fragment. Never send it to a QR service. */
export function measurementLinkQrDataUrl(url: string): Promise<string> {
  return toDataURL(url, { type: 'image/png', width: 320, margin: 4, errorCorrectionLevel: 'M' });
}
