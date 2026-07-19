import { useState, type ChangeEvent } from 'react';
import { downloadBackup, restoreBackup } from './api.ts';

type SettingsProps = {
  onClose: () => void;
  /** Called right after a successful restore, so the caller can refetch the list — the
   * DB changed server-side but React state doesn't know that on its own. */
  onRestored: () => void;
};

export function Settings({ onClose, onRestored }: SettingsProps) {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [summary, setSummary] = useState<{ animeCache: number; userList: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (): Promise<void> => {
    setError(null);
    try {
      await downloadBackup();
    } catch {
      setError('Le téléchargement a échoué.');
    }
  };

  const handleFileChosen = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) {
      setPendingFile(file);
      setSummary(null);
      setError(null);
    }
    event.target.value = ''; // allow re-selecting the same file later
  };

  const cancelRestore = (): void => setPendingFile(null);

  const confirmRestore = async (): Promise<void> => {
    if (!pendingFile) return;
    setRestoring(true);
    setError(null);
    try {
      const result = await restoreBackup(pendingFile);
      setSummary(result.restored);
      setPendingFile(null);
      onRestored();
    } catch {
      setError("La restauration a échoué — la base n'a pas été modifiée.");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="app settings">
      <header className="masthead">
        <div className="wordmark">
          <span className="glyph">◎</span> Réglages
        </div>
        <button className="mini ghost" onClick={onClose}>
          ← Retour
        </button>
      </header>

      <section className="settings-section">
        <h3>Sauvegarde</h3>
        <p className="hint">Télécharge un export JSON complet de ta liste (§8).</p>
        <button className="settings-action" onClick={() => void handleDownload()}>
          Télécharger la sauvegarde
        </button>
      </section>

      <section className="settings-section">
        <h3>Restauration</h3>
        <p className="hint">
          Restaurer un fichier remplace <strong>intégralement</strong> la liste actuelle — cette action ne peut pas
          être annulée.
        </p>
        <input
          type="file"
          accept="application/json"
          onChange={handleFileChosen}
          className="settings-file-input"
          id="restore-file-input"
        />
        <label htmlFor="restore-file-input" className="settings-action settings-file-label">
          Choisir un fichier…
        </label>

        {pendingFile && (
          <div className="restore-confirm" role="alertdialog">
            <p>
              Restaurer <strong>{pendingFile.name}</strong> ? Toute la liste actuelle sera remplacée.
            </p>
            <div className="restore-confirm-actions">
              <button className="mini" onClick={() => void confirmRestore()} disabled={restoring}>
                {restoring ? 'Restauration…' : 'Confirmer la restauration'}
              </button>
              <button className="mini ghost" onClick={cancelRestore} disabled={restoring}>
                Annuler
              </button>
            </div>
          </div>
        )}

        {summary && (
          <div className="restore-summary" role="status">
            Restauré : {summary.animeCache} anime(s) en cache, {summary.userList} entrée(s) de liste.
          </div>
        )}
        {error && (
          <div className="hint err" role="alert">
            {error}
          </div>
        )}
      </section>
    </div>
  );
}
