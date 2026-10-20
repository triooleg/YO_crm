import type { Metadata } from 'next';
import './parent-measurements.css';
import { ParentMeasurementsProvider } from '../../components/parent-measurements/provider';

export const metadata: Metadata = {
  title: 'Yoleotard · Measurements',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function ParentMeasurementsLayout({ children }: { children: React.ReactNode }) {
  return <ParentMeasurementsProvider>{children}</ParentMeasurementsProvider>;
}
