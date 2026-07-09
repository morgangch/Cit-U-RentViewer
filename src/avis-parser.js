/**
 * Parsing des montants ("Montant ALS attendu", "Total", ...) dans le texte
 * du PDF d'avis d'échéance (extrait par pdf-text.js).
 */
globalThis.CiteURV = globalThis.CiteURV || {};

globalThis.CiteURV.avisParser = (() => {
  const config = globalThis.CiteURV.config;

  // Un montant français : "257,05", "1 234,56", "-187,00", "187.00", "250 €".
  // On exige des décimales ou un "€" qui suit, pour ne pas confondre le
  // montant avec une date ou un numéro de dossier situé après le libellé.
  // (  /   : espaces insécables en séparateur de milliers)
  const AMOUNT_RE = new RegExp(
    '-?\\s*\\d[\\d\\s\\u00a0\\u202f]*[.,]\\d{1,2}' + // avec décimales
      '|-?\\s*\\d[\\d\\s\\u00a0\\u202f]*(?=\\s*\\u20ac)' // entier suivi de €
  );

  /** "1 234,56" -> 1234.56 (gère espaces normales/insécables et virgule). */
  function parseAmount(raw) {
    const normalized = raw.replace(/\s/g, '').replace(',', '.');
    const value = Number.parseFloat(normalized);
    return Number.isNaN(value) ? null : value;
  }

  /**
   * Cherche un libellé (liste de regex, 1re qui matche gagne) puis le premier
   * montant dans la fenêtre de texte qui suit. Retourne un nombre ou null.
   */
  function findLabeledAmount(text, labelPatterns) {
    for (const pattern of labelPatterns) {
      const labelMatch = text.match(pattern);
      if (!labelMatch) continue;
      const windowStart = labelMatch.index + labelMatch[0].length;
      const searchWindow = text.slice(windowStart, windowStart + config.amountSearchWindow);
      const amountMatch = searchWindow.match(AMOUNT_RE);
      if (amountMatch) {
        const value = parseAmount(amountMatch[0]);
        if (value !== null) return value;
      }
    }
    return null;
  }

  /**
   * Cherche "Solde débiteur/créditeur au <date>" et retourne le montant
   * signé : négatif si débiteur (tu dois de l'argent au CROUS), positif si
   * créditeur. Retourne null si absent du texte.
   */
  function findSolde(text) {
    const labelMatch = text.match(config.soldePattern);
    if (!labelMatch) return null;
    const windowStart = labelMatch.index + labelMatch[0].length;
    const searchWindow = text.slice(windowStart, windowStart + config.amountSearchWindow);
    const amountMatch = searchWindow.match(AMOUNT_RE);
    if (!amountMatch) return null;
    const value = parseAmount(amountMatch[0]);
    if (value === null) return null;
    const isDebiteur = /débiteur/i.test(labelMatch[1]);
    return isDebiteur ? -Math.abs(value) : Math.abs(value);
  }

  /**
   * Parse un avis d'échéance.
   * Retourne { aide, loyer, resteACharge, solde } (euros).
   * - aide  : "Montant ALS/APL attendu" (l'aide est parfois notée en négatif
   *           sur l'avis car déduite ; on la remet en positif)
   * - loyer : ligne "Total" des droits constatés du mois
   * - solde : solde du compte locataire à la date de l'avis, signé
   *           (négatif = débiteur, positif = créditeur), ou null si absent
   */
  function parse(pdfBytes) {
    const text = globalThis.CiteURV.pdfText.extractText(pdfBytes);

    const aideRaw = findLabeledAmount(text, config.pdfLabels.aide);
    const loyerRaw = findLabeledAmount(text, config.pdfLabels.loyer);

    const aide = aideRaw === null ? null : Math.abs(aideRaw);
    const loyer = loyerRaw === null ? null : Math.abs(loyerRaw);

    return {
      aide,
      loyer,
      resteACharge:
        aide !== null && loyer !== null ? Math.round((loyer - aide) * 100) / 100 : null,
      solde: findSolde(text)
    };
  }

  return { parse, findLabeledAmount, parseAmount, findSolde };
})();
