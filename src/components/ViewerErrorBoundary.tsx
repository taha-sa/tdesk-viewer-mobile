import React from 'react';
import { AppThemeMode } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

interface Props {
  children: React.ReactNode;
  appTheme: AppThemeMode;
  onBack: () => void;
}

/** Görüntüleyici alanı için hata sınırı: mantık ErrorBoundary'dedir, yalnız metinler farklıdır. */
export const ViewerErrorBoundary: React.FC<Props> = ({ children, appTheme, onBack }) => (
  <ErrorBoundary
    appTheme={appTheme}
    onBack={onBack}
    title="Bu dosya görüntülenemedi"
    description="Dosya bozuk, desteklenmiyor veya cihaz belleği yetersiz olabilir. Geri dönüp başka bir dosya deneyebilirsiniz."
    logTag="T-DESK-VIEWER-ERROR"
  >
    {children}
  </ErrorBoundary>
);
