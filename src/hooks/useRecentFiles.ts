// Ana ekran ve Dosyalar ekranının ortak "son dosyalar" mantığı: yükleme, yenileme, favori, detay modalı, eksik dosya uyarısı.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { FileInfo } from '../types';
import { FileService } from '../services/fileService';
import { t } from '../i18n';

export function useRecentFiles(onOpenFile: (file: FileInfo) => void) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [detailFile, setDetailFile] = useState<FileInfo | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async (): Promise<FileInfo[]> => {
    const list = await FileService.getRecentFiles();
    if (mounted.current) {
      setFiles(list);
      setLoading(false);
    }
    return list;
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [reload]);

  const openFile = useCallback(
    (file: FileInfo) => {
      if (file.missing) {
        Alert.alert(
          t('common.fileNotFound'),
          t('recent.missingBody', { name: file.name }),
          [
            { text: t('common.close'), style: 'cancel' },
            {
              text: t('common.removeFromList'),
              style: 'destructive',
              onPress: () => {
                void FileService.removeRecentFile(file.id).then(() => reload());
              },
            },
          ]
        );
        return;
      }
      onOpenFile(file);
    },
    [onOpenFile, reload]
  );

  const toggleFavorite = useCallback(
    async (file: FileInfo) => {
      await FileService.toggleFavorite(file.id);
      await reload();
    },
    [reload]
  );

  /** Detay modalında favori/etiket/ad/silme değişince çağrılır: listeyi yeniler, açık kaydı güncel haline eşler. */
  const handleChanged = useCallback(async () => {
    const list = await reload();
    if (mounted.current) {
      setDetailFile((prev) => (prev ? list.find((f) => f.id === prev.id) ?? null : null));
    }
  }, [reload]);

  return { files, loading, refreshing, refresh, reload, openFile, toggleFavorite, detailFile, setDetailFile, handleChanged };
}
