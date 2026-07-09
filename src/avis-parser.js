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
  const AMOUNT_SOURCE =
    '-?\\s*\\d[\\d\\u00a0\\u202f]*[.,]\\d{1,2}' + // avec décimales
    '|-?\\s*\\d[\\d\\u00a0\\u202f]*(?=\\s*\\u20ac)'; // entier suivi de €
  const AMOUNT_RE = new RegExp(AMOUNT_SOURCE);
  const AMOUNT_RE_GLOBAL = new RegExp(AMOUNT_SOURCE, 'g');

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

  /** Isole le texte entre deux libellés. Retourne null si `startPattern` est absent. */
  function extractSection(text, startPattern, endPattern) {
    const startMatch = text.match(startPattern);
    if (!startMatch) return null;
    const sectionStart = startMatch.index + startMatch[0].length;
    const rest = text.slice(sectionStart);
    const endMatch = rest.match(endPattern);
    return endMatch ? rest.slice(0, endMatch.index) : rest;
  }

  /** Somme tous les montants d'un texte. Retourne null s'il n'y en a aucun. */
  function sumAmounts(text) {
    const amounts = [...text.matchAll(AMOUNT_RE_GLOBAL)]
      .map((m) => parseAmount(m[0]))
      .filter((v) => v !== null);
    if (amounts.length === 0) return null;
    return Math.round(amounts.reduce((sum, v) => sum + v, 0) * 100) / 100;
  }

  /**
   * Montant du loyer du mois : cherché dans la section "DROITS CONSTATES
   * ... SITUATION DE VOTRE COMPTE". Si la section contient un "Total"
   * explicite, on lui fait confiance (c'est déjà la somme des lignes) —
   * sinon (ex. une seule ligne de charge, cas où le CROUS n'affiche même
   * pas le mot "Total"), on additionne tous les montants de la section.
   * Repli final : chercher un "Total" dans tout le document, si la section
   * elle-même est introuvable (format de CROUS totalement différent).
   */
  function findLoyer(text) {
    const section = extractSection(
      text,
      config.droitsConstatesSection.start,
      config.droitsConstatesSection.end
    );
    if (section !== null) {
      const total = findLabeledAmount(section, config.pdfLabels.loyer);
      if (total !== null) return total;
      const sum = sumAmounts(section);
      if (sum !== null) return sum;
      // Section trouvée mais vide : rien à facturer ce mois-ci (ex. avis
      // suivant un mois déjà payé d'avance). Ce n'est pas une erreur.
      if (section.trim() === '') return 0;
    }
    return findLabeledAmount(text, config.pdfLabels.loyer);
  }

  /**
   * Cherche "Solde débiteur/créditeur au <date>" et retourne le montant
   * signé : négatif si débiteur (tu dois de l'argent au CROUS), positif si
   * créditeur. Repli sur "Solde au <date>" (sans qualificatif — le CROUS
   * omet "débiteur"/"créditeur" quand le solde est à 0). Retourne null si
   * absent du texte.
   */
  function findSolde(text) {
    const labelMatch = text.match(config.soldePattern);
    const match = labelMatch || text.match(config.soldeNeutralPattern);
    if (!match) return null;

    const windowStart = match.index + match[0].length;
    const searchWindow = text.slice(windowStart, windowStart + config.amountSearchWindow);
    const amountMatch = searchWindow.match(AMOUNT_RE);
    if (!amountMatch) return null;
    const value = parseAmount(amountMatch[0]);
    if (value === null) return null;

    if (!labelMatch) return value; // "Solde au ..." neutre (sans qualificatif), non signé
    const isDebiteur = /débiteur/i.test(labelMatch[1]);
    return isDebiteur ? -Math.abs(value) : Math.abs(value);
  }

  /**
   * Parse un avis d'échéance.
   * Retourne { aide, loyer, resteACharge, solde } (euros).
   * - aide  : "Montant ALS/APL attendu" (l'aide est parfois notée en négatif
   *           sur l'avis car déduite ; on la remet en positif). null si
   *           l'avis ne mentionne aucune aide (traité comme 0 dans le
   *           calcul de resteACharge).
   * - loyer : somme des lignes "DROITS CONSTATES" du mois (loyer, charges,
   *           compl. mobilier, ...), avec repli sur le libellé "Total" si
   *           la section n'est pas trouvée.
   * - solde : solde du compte locataire à la date de l'avis, signé
   *           (négatif = débiteur, positif = créditeur), ou null si absent
   */
  function parse(pdfBytes) {
    const text = globalThis.CiteURV.pdfText.extractText(pdfBytes);

    const aideRaw = findLabeledAmount(text, config.pdfLabels.aide);
    const aide = aideRaw === null ? null : Math.abs(aideRaw);

    const loyerRaw = findLoyer(text);
    const loyer = loyerRaw === null ? null : Math.abs(loyerRaw);

    return {
      aide,
      loyer,
      resteACharge: loyer !== null ? Math.round((loyer - (aide ?? 0)) * 100) / 100 : null,
      solde: findSolde(text)
    };
  }

  return { parse, findLabeledAmount, parseAmount, findSolde, findLoyer, sumAmounts, extractSection };
})();
