import React from 'react';
import { AppThemeMode } from '../types';
import { ErrorBoundary } from './ErrorBoundary';
import { t } from '../i18n';

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
    title={t('viewerError.title')}
    description={t('viewerError.desc')}
    logTag="T-DESK-VIEWER-ERROR"
  >
    {children}
  </ErrorBoundary>
);
