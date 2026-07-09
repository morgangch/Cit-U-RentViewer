/**
 * Injection du panneau "Loyer / Aide / Différence" dans la page
 * "Mon logement actuel".
 */
globalThis.CiteURV = globalThis.CiteURV || {};

globalThis.CiteURV.ui = (() => {
  const euros = (value) =>
    value === null
      ? '—'
      : value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

  function buildRow(label, value, bold = false) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:2px 0;';
    const labelEl = document.createElement('div');
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.textContent = euros(value);
    valueEl.style.fontWeight = bold ? '700' : '600';
    row.append(labelEl, valueEl);
    return row;
  }

  /**
   * Insère (ou remplace) le panneau dans un bloc logement.
   * data : { avisLabel, avisUrl, aide, loyer, resteACharge, solde }
   */
  function renderPanel(blocElement, data) {
    removePanel(blocElement);

    const panel = document.createElement('div');
    panel.className = 'citeurv-panel row-sub-container';
    panel.style.cssText =
      'margin:10px 0;padding:12px 15px;border:1px solid #d5d5d5;border-radius:6px;' +
      'background:#f7f9fb;max-width:500px;font-size:14px;';

    const title = document.createElement('div');
    title.className = 'row-sub-container-title';
    title.textContent = `💶 ${data.avisLabel || 'Dernier avis d’échéance'}`;
    title.style.cssText = 'font-weight:700;margin-bottom:6px;';
    panel.appendChild(title);

    panel.appendChild(buildRow('Montant loyer (Total)', data.loyer));
    panel.appendChild(buildRow('Montant APL/ALS attendu', data.aide));
    panel.appendChild(buildRow('Différence (reste à charge)', data.resteACharge, true));
    if (data.solde !== null && data.solde !== undefined) {
      const soldeLabel = data.solde < 0 ? 'Solde débiteur (dû au CROUS)' : 'Solde créditeur';
      panel.appendChild(buildRow(soldeLabel, data.solde));
    }

    if (data.loyer === null) {
      const note = document.createElement('div');
      note.textContent =
        'Montant du loyer non détecté (format de l’avis non reconnu) — vérifie le PDF ci-dessous.';
      note.style.cssText = 'margin-top:6px;font-size:12px;color:#a33;';
      panel.appendChild(note);
    }

    if (data.avisUrl) {
      const link = document.createElement('a');
      link.href = data.avisUrl;
      link.textContent = 'Voir l’avis d’échéance (PDF)';
      link.style.cssText = 'display:inline-block;margin-top:6px;font-size:13px;';
      panel.appendChild(link);
    }

    insert(blocElement, panel);
  }

  /** Affiche une erreur discrète à la place du panneau. */
  function renderError(blocElement, message) {
    removePanel(blocElement);
    const panel = document.createElement('div');
    panel.className = 'citeurv-panel';
    panel.style.cssText =
      'margin:10px 0;padding:8px 12px;border:1px solid #e8c7c7;border-radius:6px;' +
      'background:#fdf3f3;color:#a33;max-width:500px;font-size:13px;';
    panel.textContent = `CiteU Rent Viewer : ${message}`;
    insert(blocElement, panel);
  }

  function insert(blocElement, panel) {
    // Juste après l'en-tête du bloc (dates / type de logement) si présent,
    // sinon en tête du bloc.
    const header = blocElement.querySelector('.entete-bloc-cite');
    if (header) header.after(panel);
    else blocElement.prepend(panel);
  }

  function removePanel(blocElement) {
    blocElement.querySelectorAll('.citeurv-panel').forEach((el) => el.remove());
  }

  return { renderPanel, renderError };
})();
